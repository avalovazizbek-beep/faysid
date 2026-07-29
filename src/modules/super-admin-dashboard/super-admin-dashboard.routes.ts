import { Router } from "express";
import { UserRole } from "@prisma/client";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { getSuperAdminDashboardStatsHandler } from "./super-admin-dashboard.controller";

const router = Router();

router.use(authenticate, authorize(UserRole.SUPER_ADMIN));

/**
 * @openapi
 * /admin/dashboard/stats:
 *   get:
 *     summary: Real-time platform-wide stats for the Super Admin dashboard
 *     tags: [Super Admin Dashboard]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Dashboard stats }
 */
router.get("/stats", getSuperAdminDashboardStatsHandler);

export default router;
