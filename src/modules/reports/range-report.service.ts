import { prisma } from "../../config/prisma";

/**
 * Per-employee attendance summary over an arbitrary date range (haftalik/
 * oylik Telegram bot reports) — reuses payroll.service.ts#generatePayroll's
 * workedDays/lateDays aggregation logic, minus the salary/bonus/penalty
 * calculation that report doesn't need.
 */
export interface RangeReportRow {
  employeeCode: string;
  fullName: string;
  workedDays: number;
  lateDays: number;
  absentDays: number;
  workedHours: number;
}

export async function getRangeAttendanceReport(
  organizationId: string,
  startDate: Date,
  endDate: Date,
  deviceId?: string,
): Promise<RangeReportRow[]> {
  const employees = await prisma.employee.findMany({
    where: {
      organizationId,
      deletedAt: null,
      status: "ACTIVE",
      ...(deviceId ? { deviceSyncs: { some: { deviceId, status: "SYNCED" } } } : {}),
    },
    orderBy: { fullName: "asc" },
  });
  if (employees.length === 0) return [];

  const totalDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000));

  const attendanceRows = await prisma.attendance.findMany({
    where: { employeeId: { in: employees.map((e) => e.id) }, date: { gte: startDate, lt: endDate }, deletedAt: null },
  });
  const rowsByEmployee = new Map<string, typeof attendanceRows>();
  for (const row of attendanceRows) {
    const list = rowsByEmployee.get(row.employeeId) ?? [];
    list.push(row);
    rowsByEmployee.set(row.employeeId, list);
  }

  return employees.map((employee) => {
    const rows = rowsByEmployee.get(employee.id) ?? [];
    const workedDays = rows.filter((r) => r.checkInAt !== null).length;
    const lateDays = rows.filter((r) => r.isLate).length;
    const workedMinutes = rows.reduce((sum, r) => sum + (r.workedMinutes ?? 0), 0);

    return {
      employeeCode: employee.employeeCode,
      fullName: employee.fullName,
      workedDays,
      lateDays,
      absentDays: Math.max(0, totalDays - workedDays),
      workedHours: Math.round((workedMinutes / 60) * 100) / 100,
    };
  });
}

const REPORT_HEADER = ["Xodim ID", "Xodim", "Ishlagan kun", "Kechikkan kun", "Kelmagan kun", "Jami soat"];

function rowToCells(row: RangeReportRow): (string | number)[] {
  return [row.employeeCode, row.fullName, row.workedDays, row.lateDays, row.absentDays, row.workedHours];
}

export async function rangeReportToExcel(rows: RangeReportRow[], sheetTitle: string): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetTitle);

  sheet.addRow(REPORT_HEADER);
  sheet.getRow(1).font = { bold: true };
  rows.forEach((row) => sheet.addRow(rowToCells(row)));
  sheet.columns.forEach((col) => {
    col.width = 16;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function rangeReportToPdf(rows: RangeReportRow[], title: string): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 30, size: "A4", layout: "landscape" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(14).text(title, { align: "center" });
    doc.moveDown();

    const colWidths = [70, 160, 70, 80, 80, 70];
    const startX = doc.x;
    let y = doc.y;

    doc.fontSize(9).font("Helvetica-Bold");
    REPORT_HEADER.forEach((header, i) => {
      doc.text(header, startX + colWidths.slice(0, i).reduce((a, b) => a + b, 0), y, { width: colWidths[i] });
    });
    y += 18;

    doc.font("Helvetica");
    rows.forEach((row) => {
      const cells = rowToCells(row).map(String);
      cells.forEach((cell, i) => {
        doc.text(cell, startX + colWidths.slice(0, i).reduce((a, b) => a + b, 0), y, { width: colWidths[i] });
      });
      y += 16;
      if (y > 520) {
        doc.addPage();
        y = doc.y;
      }
    });

    doc.end();
  });
}
