import { Router } from "express";
import { UserRole } from "@prisma/client";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { requireTenant } from "../../middlewares/tenant-resolver";
import { blockIfReadOnly } from "../../middlewares/enforce-read-only";
import { validate } from "../../middlewares/validate";
import { applicationIdParamSchema, approveApplicationSchema, listApplicationsQuerySchema } from "./employee-application.dto";
import { approveApplicationHandler, listApplicationsHandler, rejectApplicationHandler } from "./employee-application.controller";

const router = Router();

router.use(authenticate, requireTenant, authorize(UserRole.ORG_ADMIN, UserRole.STAFF));

/**
 * @openapi
 * /employee-applications:
 *   get:
 *     summary: List employee self-registration applications submitted via the Telegram bot
 *     tags: [Employee Applications]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: List of applications }
 */
router.get("/", validate({ query: listApplicationsQuerySchema }), listApplicationsHandler);

/**
 * @openapi
 * /employee-applications/{id}/approve:
 *   post:
 *     summary: Approve an application — creates a real Employee with the given employeeCode
 *     tags: [Employee Applications]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Employee created }
 */
router.post(
  "/:id/approve",
  blockIfReadOnly,
  validate({ params: applicationIdParamSchema, body: approveApplicationSchema }),
  approveApplicationHandler,
);

/**
 * @openapi
 * /employee-applications/{id}/reject:
 *   post:
 *     summary: Reject an application
 *     tags: [Employee Applications]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Application rejected }
 */
router.post("/:id/reject", blockIfReadOnly, validate({ params: applicationIdParamSchema }), rejectApplicationHandler);

export default router;
