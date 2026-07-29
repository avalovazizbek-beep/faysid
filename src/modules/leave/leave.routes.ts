import { Router } from "express";
import { UserRole } from "@prisma/client";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { requireTenant } from "../../middlewares/tenant-resolver";
import { validate } from "../../middlewares/validate";
import { createLeaveSchema, leaveIdParamSchema, listLeavesQuerySchema } from "./leave.dto";
import {
  approveLeaveHandler,
  createLeaveHandler,
  deleteLeaveHandler,
  listLeavesHandler,
  rejectLeaveHandler,
} from "./leave.controller";

const router = Router();

router.use(authenticate, requireTenant, authorize(UserRole.ORG_ADMIN, UserRole.STAFF));

/**
 * @openapi
 * /leaves:
 *   get:
 *     summary: List leave requests for the caller's organization
 *     tags: [Leave]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Paginated list of leave requests }
 *   post:
 *     summary: Submit a leave request for an employee
 *     tags: [Leave]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Leave request created (PENDING) }
 */
router.get("/", validate({ query: listLeavesQuerySchema }), listLeavesHandler);
router.post("/", validate({ body: createLeaveSchema }), createLeaveHandler);
router.delete("/:id", validate({ params: leaveIdParamSchema }), deleteLeaveHandler);

/**
 * @openapi
 * /leaves/{id}/approve:
 *   post:
 *     summary: Approve a pending leave request (Organization Admin only)
 *     tags: [Leave]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Leave approved }
 */
router.post("/:id/approve", authorize(UserRole.ORG_ADMIN), validate({ params: leaveIdParamSchema }), approveLeaveHandler);

/**
 * @openapi
 * /leaves/{id}/reject:
 *   post:
 *     summary: Reject a pending leave request (Organization Admin only)
 *     tags: [Leave]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Leave rejected }
 */
router.post("/:id/reject", authorize(UserRole.ORG_ADMIN), validate({ params: leaveIdParamSchema }), rejectLeaveHandler);

export default router;
