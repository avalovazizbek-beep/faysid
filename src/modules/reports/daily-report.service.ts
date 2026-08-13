import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../../config/prisma";
import { toCsv } from "../../common/csv";
import { getEmployeeIdsOnApprovedLeave } from "../leave/leave.service";

const STANDARD_WORKING_DAYS_PER_MONTH = 22;
const DEFAULT_DAILY_HOURS = 8;

export interface DailyReportRow {
  date: string;
  employeeCode: string;
  fullName: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  breakMinutes: number;
  workedHours: number;
  hourlyRate: number;
  totalPay: number;
  note: string;
  /** Local /uploads/attendance/ copy of the device's live verification snapshot — visual proof of who actually badged in/out. */
  checkInPhotoUrl: string | null;
  checkOutPhotoUrl: string | null;
}

// .toISOString() renders UTC — the stored instant is correct, but this report
// displays it raw instead of converting to the org's local (Asia/Tashkent,
// UTC+5, no DST) wall-clock time, showing e.g. "11:06" for what was actually
// "16:06" locally.
function formatTime(value: Date | null | undefined): string | null {
  if (!value) return null;
  const tashkent = new Date(value.getTime() + 5 * 60 * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(tashkent.getUTCHours())}:${pad(tashkent.getUTCMinutes())}`;
}

export async function getDailyAttendanceReport(organizationId: string, date: Date, deviceId?: string): Promise<DailyReportRow[]> {
  const nextDate = new Date(date.getTime() + 86_400_000);

  const [employees, attendanceRows, onLeaveIds] = await Promise.all([
    prisma.employee.findMany({
      where: {
        organizationId,
        deletedAt: null,
        status: "ACTIVE",
        ...(deviceId ? { deviceSyncs: { some: { deviceId, status: "SYNCED" } } } : {}),
      },
      include: { shift: { select: { workingHoursPerDay: true } } },
      orderBy: { fullName: "asc" },
    }),
    prisma.attendance.findMany({
      where: { organizationId, date: { gte: date, lt: nextDate }, deletedAt: null },
    }),
    getEmployeeIdsOnApprovedLeave(organizationId, date),
  ]);

  const attendanceByEmployeeId = new Map(attendanceRows.map((a) => [a.employeeId, a]));
  const dateLabel = date.toISOString().slice(0, 10);

  return employees.map((employee) => {
    const record = attendanceByEmployeeId.get(employee.id);
    const dailyHours = employee.shift?.workingHoursPerDay ?? DEFAULT_DAILY_HOURS;
    const baseSalary = employee.salary ? Number(employee.salary) : null;
    const hourlyRate = baseSalary ? baseSalary / (STANDARD_WORKING_DAYS_PER_MONTH * dailyHours) : 0;
    const workedHours = record?.workedMinutes ? Math.round((record.workedMinutes / 60) * 100) / 100 : 0;
    const totalPay = Math.round(hourlyRate * workedHours * 100) / 100;

    let note = "";
    if (onLeaveIds.has(employee.id)) note = "Ta'tilda";
    else if (!record?.checkInAt) note = "Kelmagan";
    else if (record.isLate) note = "Kechikdi";

    return {
      date: dateLabel,
      employeeCode: employee.employeeCode,
      fullName: employee.fullName,
      checkInAt: formatTime(record?.checkInAt),
      checkOutAt: formatTime(record?.checkOutAt),
      breakMinutes: record?.breakMinutes ?? 0,
      workedHours,
      hourlyRate: Math.round(hourlyRate * 100) / 100,
      totalPay,
      note,
      checkInPhotoUrl: record?.checkInPhotoUrl ?? null,
      checkOutPhotoUrl: record?.checkOutPhotoUrl ?? null,
    };
  });
}

const REPORT_HEADER = [
  "Sana",
  "Xodim ID",
  "Xodim",
  "Kirish",
  "Chiqish",
  "Tanaffus (daq)",
  "Ish vaqti",
  "Soatlik narx",
  "Jami summa",
  "Izoh",
];

const PHOTO_HEADER = ["Kirish rasmi", "Chiqish rasmi"];

function rowToCells(row: DailyReportRow): (string | number)[] {
  return [
    row.date,
    row.employeeCode,
    row.fullName,
    row.checkInAt ?? "-",
    row.checkOutAt ?? "-",
    row.breakMinutes,
    row.workedHours,
    row.hourlyRate,
    row.totalPay,
    row.note,
  ];
}

export function dailyReportToCsv(rows: DailyReportRow[]): string {
  return toCsv([REPORT_HEADER, ...rows.map(rowToCells)]);
}

/** Reads back a locally-stored /uploads/... file (see attendance-recorder.ts's downloadAndSaveSnapshot) as a buffer, for embedding in a report. */
async function readLocalUpload(url: string): Promise<Buffer | null> {
  try {
    const relative = url.replace(/^\/uploads\//, "");
    const absolute = path.join(__dirname, "..", "..", "..", "uploads", relative);
    return await readFile(absolute);
  } catch {
    return null;
  }
}

const PHOTO_CELL_SIZE = 60; // pixels, both Excel and PDF thumbnails

export async function dailyReportToExcel(rows: DailyReportRow[]): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Davomat");

  sheet.addRow([...REPORT_HEADER, ...PHOTO_HEADER]);
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    const excelRow = sheet.addRow(rowToCells(row));
    if (row.checkInPhotoUrl || row.checkOutPhotoUrl) {
      excelRow.height = PHOTO_CELL_SIZE * 0.75; // px -> points
    }
    const rowIndex = excelRow.number - 1; // addImage anchors are 0-indexed

    if (row.checkInPhotoUrl) {
      const buffer = await readLocalUpload(row.checkInPhotoUrl);
      if (buffer) {
        // exceljs's own bundled @types/node (nested in its node_modules)
        // predates Node's generic Buffer<T>, so its Buffer is a structurally
        // different type from this project's — a real Buffer at runtime,
        // just an unresolvable nominal mismatch at the type level.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const imageId = workbook.addImage({ buffer, extension: "jpeg" } as any);
        sheet.addImage(imageId, { tl: { col: REPORT_HEADER.length, row: rowIndex }, ext: { width: PHOTO_CELL_SIZE, height: PHOTO_CELL_SIZE } });
      }
    }
    if (row.checkOutPhotoUrl) {
      const buffer = await readLocalUpload(row.checkOutPhotoUrl);
      if (buffer) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const imageId = workbook.addImage({ buffer, extension: "jpeg" } as any);
        sheet.addImage(imageId, {
          tl: { col: REPORT_HEADER.length + 1, row: rowIndex },
          ext: { width: PHOTO_CELL_SIZE, height: PHOTO_CELL_SIZE },
        });
      }
    }
  }

  sheet.columns.forEach((col, i) => {
    col.width = i >= REPORT_HEADER.length ? 10 : 16;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function dailyReportToPdf(rows: DailyReportRow[], date: Date): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;

  // Photos are read up front (async) so the PDFKit document itself can stay
  // fully synchronous below — pdfkit streams as it draws, so interleaving
  // async file reads into that flow is unreliable.
  const photosByRow = await Promise.all(
    rows.map(async (row) => ({
      checkIn: row.checkInPhotoUrl ? await readLocalUpload(row.checkInPhotoUrl) : null,
      checkOut: row.checkOutPhotoUrl ? await readLocalUpload(row.checkOutPhotoUrl) : null,
    })),
  );

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 30, size: "A4", layout: "landscape" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(14).text(`Davomat hisoboti — ${date.toISOString().slice(0, 10)}`, { align: "center" });
    doc.moveDown();

    const header = [...REPORT_HEADER, ...PHOTO_HEADER];
    const colWidths = [48, 50, 90, 38, 38, 48, 42, 46, 52, 55, 46, 46];
    const startX = doc.x;
    let y = doc.y;

    const drawHeader = () => {
      doc.fontSize(8).font("Helvetica-Bold");
      header.forEach((h, i) => {
        doc.text(h, startX + colWidths.slice(0, i).reduce((a, b) => a + b, 0), y, { width: colWidths[i] });
      });
      y += 16;
      doc.font("Helvetica");
    };
    drawHeader();

    const photoSize = 36;
    rows.forEach((row, index) => {
      const photos = photosByRow[index];
      const rowHeight = photos.checkIn || photos.checkOut ? photoSize + 6 : 14;

      if (y + rowHeight > 520) {
        doc.addPage();
        y = doc.y;
        drawHeader();
      }

      const cells = rowToCells(row).map(String);
      cells.forEach((cell, i) => {
        doc.text(cell, startX + colWidths.slice(0, i).reduce((a, b) => a + b, 0), y, { width: colWidths[i] });
      });

      const checkInX = startX + colWidths.slice(0, REPORT_HEADER.length).reduce((a, b) => a + b, 0);
      const checkOutX = checkInX + colWidths[REPORT_HEADER.length];
      if (photos.checkIn) {
        try {
          doc.image(photos.checkIn, checkInX, y, { width: photoSize, height: photoSize });
        } catch {
          // Corrupt/unreadable image — skip it, the rest of the row's data still renders.
        }
      }
      if (photos.checkOut) {
        try {
          doc.image(photos.checkOut, checkOutX, y, { width: photoSize, height: photoSize });
        } catch {
          // Corrupt/unreadable image — skip it, the rest of the row's data still renders.
        }
      }

      y += rowHeight;
    });

    doc.end();
  });
}
