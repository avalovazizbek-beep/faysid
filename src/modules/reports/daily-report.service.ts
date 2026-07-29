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
}

function formatTime(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString().slice(11, 16);
}

export async function getDailyAttendanceReport(organizationId: string, date: Date): Promise<DailyReportRow[]> {
  const nextDate = new Date(date.getTime() + 86_400_000);

  const [employees, attendanceRows, onLeaveIds] = await Promise.all([
    prisma.employee.findMany({
      where: { organizationId, deletedAt: null, status: "ACTIVE" },
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

export async function dailyReportToExcel(rows: DailyReportRow[]): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Davomat");

  sheet.addRow(REPORT_HEADER);
  sheet.getRow(1).font = { bold: true };
  rows.forEach((row) => sheet.addRow(rowToCells(row)));
  sheet.columns.forEach((col) => {
    col.width = 16;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function dailyReportToPdf(rows: DailyReportRow[], date: Date): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 30, size: "A4", layout: "landscape" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(14).text(`Davomat hisoboti — ${date.toISOString().slice(0, 10)}`, { align: "center" });
    doc.moveDown();

    const colWidths = [55, 60, 110, 45, 45, 55, 50, 55, 60, 70];
    const startX = doc.x;
    let y = doc.y;

    doc.fontSize(8).font("Helvetica-Bold");
    REPORT_HEADER.forEach((header, i) => {
      doc.text(header, startX + colWidths.slice(0, i).reduce((a, b) => a + b, 0), y, { width: colWidths[i] });
    });
    y += 16;

    doc.font("Helvetica");
    rows.forEach((row) => {
      const cells = rowToCells(row).map(String);
      cells.forEach((cell, i) => {
        doc.text(cell, startX + colWidths.slice(0, i).reduce((a, b) => a + b, 0), y, { width: colWidths[i] });
      });
      y += 14;
      if (y > 520) {
        doc.addPage();
        y = doc.y;
      }
    });

    doc.end();
  });
}
