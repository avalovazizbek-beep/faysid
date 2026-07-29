import { Router } from "express";
import { UserRole } from "@prisma/client";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { requireTenant } from "../../middlewares/tenant-resolver";
import { validate } from "../../middlewares/validate";
import { checkInSchema, checkOutSchema, listAttendanceQuerySchema } from "./attendance.dto";
import { checkInHandler, checkOutHandler, listAttendanceHandler } from "./attendance.controller";

const router = Router();

// Not gated by blockIfReadOnly — the license Read-Only Mode spec explicitly
// keeps Attendance working even when the organization's license has expired.
router.use(authenticate, requireTenant, authorize(UserRole.ORG_ADMIN, UserRole.STAFF));

/**
 * @openapi
 * /attendance:
 *   get:
 *     summary: Attendance history for the caller's organization (filter/paginate)
 *     tags: [Attendance]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Paginated attendance history }
 */
router.get("/", validate({ query: listAttendanceQuerySchema }), listAttendanceHandler);

/**
 * @openapi
 * /attendance/check-in:
 *   post:
 *     summary: Record an employee's check-in for today
 *     tags: [Attendance]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Attendance record created/updated }
 */
router.post("/check-in", validate({ body: checkInSchema }), checkInHandler);

/**
 * @openapi
 * /attendance/check-out:
 *   post:
 *     summary: Record an employee's check-out for today
 *     tags: [Attendance]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Attendance record updated }
 */
router.post("/check-out", validate({ body: checkOutSchema }), checkOutHandler);

export default router;
