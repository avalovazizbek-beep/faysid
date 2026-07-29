import { Router } from "express";
import { UserRole } from "@prisma/client";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { requireTenant } from "../../middlewares/tenant-resolver";
import { validate } from "../../middlewares/validate";
import { attendanceReportQuerySchema, dailyReportQuerySchema } from "./report.dto";
import { getAttendanceReportHandler, getDailyReportHandler } from "./report.controller";

const router = Router();

router.use(authenticate, requireTenant, authorize(UserRole.ORG_ADMIN, UserRole.STAFF));

/**
 * @openapi
 * /reports/attendance:
 *   get:
 *     summary: Attendance report grouped by employee or department, exportable as JSON/CSV/Excel/PDF
 *     tags: [Reports]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Report data or file }
 */
router.get("/attendance", validate({ query: attendanceReportQuerySchema }), getAttendanceReportHandler);

/**
 * @openapi
 * /reports/daily:
 *   get:
 *     summary: Per-employee daily attendance sheet (Kirish/Chiqish/Tanaffus/Ish vaqti/Jami summa) for one date
 *     tags: [Reports]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Report data or file }
 */
router.get("/daily", validate({ query: dailyReportQuerySchema }), getDailyReportHandler);

export default router;
