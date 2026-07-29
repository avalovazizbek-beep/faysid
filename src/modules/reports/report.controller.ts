import { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler";
import { sendSuccess } from "../../common/api-response";
import * as reportService from "./report.service";
import * as dailyReportService from "./daily-report.service";
import { AttendanceReportQuery, DailyReportQuery } from "./report.dto";

export const getAttendanceReportHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as AttendanceReportQuery;
  const rows = await reportService.getAttendanceReport(req.tenantId!, query);

  if (query.format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="attendance-report-${Date.now()}.csv"`);
    res.send(reportService.attendanceReportToCsv(rows));
    return;
  }

  if (query.format === "excel") {
    const buffer = await reportService.attendanceReportToExcel(rows);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="attendance-report-${Date.now()}.xlsx"`);
    res.send(buffer);
    return;
  }

  if (query.format === "pdf") {
    const buffer = await reportService.attendanceReportToPdf(rows);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="attendance-report-${Date.now()}.pdf"`);
    res.send(buffer);
    return;
  }

  sendSuccess(res, rows);
});

export const getDailyReportHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as DailyReportQuery;
  const date = new Date(query.date);
  const rows = await dailyReportService.getDailyAttendanceReport(req.tenantId!, date);

  if (query.format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="Davomat_${query.date}.csv"`);
    res.send(dailyReportService.dailyReportToCsv(rows));
    return;
  }

  if (query.format === "excel") {
    const buffer = await dailyReportService.dailyReportToExcel(rows);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Davomat_${query.date}.xlsx"`);
    res.send(buffer);
    return;
  }

  if (query.format === "pdf") {
    const buffer = await dailyReportService.dailyReportToPdf(rows, date);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Davomat_${query.date}.pdf"`);
    res.send(buffer);
    return;
  }

  sendSuccess(res, rows);
});
