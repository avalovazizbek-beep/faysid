import { Router } from "express";
import { UserRole } from "@prisma/client";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { requireTenant } from "../../middlewares/tenant-resolver";
import { getOrgDashboardStatsHandler } from "./org-dashboard.controller";

const router = Router();

router.use(authenticate, requireTenant, authorize(UserRole.ORG_ADMIN, UserRole.STAFF));

/**
 * @openapi
 * /org/dashboard/stats:
 *   get:
 *     summary: Real-time counts for the Organization Panel dashboard
 *     tags: [Organization Dashboard]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Dashboard stats }
 */
router.get("/stats", getOrgDashboardStatsHandler);

export default router;
