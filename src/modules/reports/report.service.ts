import { prisma } from "../../config/prisma";
import { toCsv } from "../../common/csv";
import { AttendanceReportQuery } from "./report.dto";

export interface AttendanceReportRow {
  label: string;
  workedDays: number;
  lateDays: number;
  overtimeMinutes: number;
  workedMinutes: number;
}

function resolveDateRange(query: AttendanceReportQuery): { start: Date; end: Date } {
  const now = new Date();
  const start = query.dateFrom
    ? new Date(query.dateFrom)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = query.dateTo
    ? new Date(new Date(query.dateTo).getTime() + 86_400_000)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

export async function getAttendanceReport(organizationId: string, query: AttendanceReportQuery): Promise<AttendanceReportRow[]> {
  const { start, end } = resolveDateRange(query);

  const records = await prisma.attendance.findMany({
    where: { organizationId, date: { gte: start, lt: end }, deletedAt: null },
    include: {
      employee: {
        select: {
          fullName: true,
          department: { select: { name: true } },
          shift: { select: { workingHoursPerDay: true } },
        },
      },
    },
  });

  const buckets = new Map<string, AttendanceReportRow>();

  for (const record of records) {
    const label =
      query.groupBy === "department"
        ? (record.employee.department?.name ?? "Belgilanmagan")
        : record.employee.fullName;

    const row = buckets.get(label) ?? { label, workedDays: 0, lateDays: 0, overtimeMinutes: 0, workedMinutes: 0 };

    if (record.checkInAt) row.workedDays += 1;
    if (record.isLate) row.lateDays += 1;
    if (record.workedMinutes) {
      row.workedMinutes += record.workedMinutes;
      const dailyHours = record.employee.shift?.workingHoursPerDay ?? 8;
      row.overtimeMinutes += Math.max(0, record.workedMinutes - dailyHours * 60);
    }

    buckets.set(label, row);
  }

  return Array.from(buckets.values()).sort((a, b) => a.label.localeCompare(b.label));
}

const REPORT_HEADER = ["Nomi", "Ishlagan kunlar", "Kechikkan kunlar", "Overtime (daqiqa)", "Ishlagan (daqiqa)"];

export function attendanceReportToCsv(rows: AttendanceReportRow[]): string {
  return toCsv([REPORT_HEADER, ...rows.map((r) => [r.label, r.workedDays, r.lateDays, r.overtimeMinutes, r.workedMinutes])]);
}

export async function attendanceReportToExcel(rows: AttendanceReportRow[]): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Attendance Report");

  sheet.addRow(REPORT_HEADER);
  sheet.getRow(1).font = { bold: true };
  rows.forEach((r) => sheet.addRow([r.label, r.workedDays, r.lateDays, r.overtimeMinutes, r.workedMinutes]));
  sheet.columns.forEach((col) => {
    col.width = 22;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function attendanceReportToPdf(rows: AttendanceReportRow[]): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).text("Attendance Report", { align: "center" });
    doc.moveDown();

    const colWidths = [180, 90, 100, 90, 90];
    const startX = doc.x;
    let y = doc.y;

    doc.fontSize(10).font("Helvetica-Bold");
    REPORT_HEADER.forEach((header, i) => {
      doc.text(header, startX + colWidths.slice(0, i).reduce((a, b) => a + b, 0), y, { width: colWidths[i] });
    });
    y += 20;

    doc.font("Helvetica");
    rows.forEach((row) => {
      const cells = [row.label, String(row.workedDays), String(row.lateDays), String(row.overtimeMinutes), String(row.workedMinutes)];
      cells.forEach((cell, i) => {
        doc.text(cell, startX + colWidths.slice(0, i).reduce((a, b) => a + b, 0), y, { width: colWidths[i] });
      });
      y += 18;
      if (y > 750) {
        doc.addPage();
        y = doc.y;
      }
    });

    doc.end();
  });
}
