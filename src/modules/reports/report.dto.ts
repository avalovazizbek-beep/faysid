import { z } from "zod";

export const attendanceReportQuerySchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  groupBy: z.enum(["employee", "department"]).default("employee"),
  format: z.enum(["json", "csv", "excel", "pdf"]).default("json"),
});
export type AttendanceReportQuery = z.infer<typeof attendanceReportQuerySchema>;

export const dailyReportQuerySchema = z.object({
  date: z.string().min(1, "Sana kerak"),
  format: z.enum(["json", "csv", "excel", "pdf"]).default("json"),
});
export type DailyReportQuery = z.infer<typeof dailyReportQuerySchema>;
