import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes";
import organizationRoutes from "../modules/organization/organization.routes";
import departmentRoutes from "../modules/department/department.routes";
import employeeRoutes from "../modules/employee/employee.routes";
import shiftRoutes from "../modules/shift/shift.routes";
import attendanceRoutes from "../modules/attendance/attendance.routes";
import orgDashboardRoutes from "../modules/org-dashboard/org-dashboard.routes";
import licenseRoutes from "../modules/license/license.routes";
import orgLicenseRoutes from "../modules/license/org-license.routes";
import auditLogRoutes from "../modules/audit-log/audit-log.routes";
import superAdminDashboardRoutes from "../modules/super-admin-dashboard/super-admin-dashboard.routes";
import deviceRoutes from "../modules/device/device.routes";
import leaveRoutes from "../modules/leave/leave.routes";
import payrollRoutes from "../modules/payroll/payroll.routes";
import reportRoutes from "../modules/reports/report.routes";
import holidayRoutes from "../modules/holiday/holiday.routes";
import calendarRoutes from "../modules/calendar/calendar.routes";
import orgSettingsRoutes from "../modules/org-settings/org-settings.routes";

const router = Router();

router.get("/health", (_req, res) => {
  res.json({ success: true, data: { status: "ok", timestamp: new Date().toISOString() } });
});

router.use("/auth", authRoutes);
router.use("/organizations", organizationRoutes);
router.use("/departments", departmentRoutes);
router.use("/employees", employeeRoutes);
router.use("/shifts", shiftRoutes);
router.use("/attendance", attendanceRoutes);
router.use("/org/dashboard", orgDashboardRoutes);
router.use("/licenses", licenseRoutes);
router.use("/org/license", orgLicenseRoutes);
router.use("/audit-logs", auditLogRoutes);
router.use("/admin/dashboard", superAdminDashboardRoutes);
router.use("/devices", deviceRoutes);
router.use("/leaves", leaveRoutes);
router.use("/payroll", payrollRoutes);
router.use("/reports", reportRoutes);
router.use("/holidays", holidayRoutes);
router.use("/calendar", calendarRoutes);
router.use("/org/settings", orgSettingsRoutes);

export default router;
