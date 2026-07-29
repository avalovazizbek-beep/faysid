import { Router } from "express";
import { UserRole } from "@prisma/client";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { validate } from "../../middlewares/validate";
import { listAuditLogsQuerySchema } from "./audit-log.dto";
import { listAuditLogsHandler } from "./audit-log.controller";

const router = Router();

router.use(authenticate, authorize(UserRole.SUPER_ADMIN));

/**
 * @openapi
 * /audit-logs:
 *   get:
 *     summary: Platform-wide audit trail (Super Admin) — login/logout/CRUD/license actions
 *     tags: [Audit Log]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Paginated audit log entries }
 */
router.get("/", validate({ query: listAuditLogsQuerySchema }), listAuditLogsHandler);

export default router;
