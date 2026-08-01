import { Router } from "express";
import { UserRole } from "@prisma/client";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { requireTenant } from "../../middlewares/tenant-resolver";
import { validate } from "../../middlewares/validate";
import { updateOrgSettingsSchema } from "./org-settings.dto";
import { getOrgSettingsHandler, testHikConnectHandler, updateOrgSettingsHandler } from "./org-settings.controller";

const router = Router();

router.use(authenticate, requireTenant, authorize(UserRole.ORG_ADMIN, UserRole.STAFF));

/**
 * @openapi
 * /org/settings:
 *   get:
 *     summary: Current organization settings (e.g. Telegram chat id for the daily report)
 *     tags: [Organization Settings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Organization settings }
 *   patch:
 *     summary: Update organization settings (Organization Admin only)
 *     tags: [Organization Settings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Updated organization settings }
 */
router.get("/", getOrgSettingsHandler);
router.patch("/", authorize(UserRole.ORG_ADMIN), validate({ body: updateOrgSettingsSchema }), updateOrgSettingsHandler);

/**
 * @openapi
 * /org/settings/hikconnect/test:
 *   post:
 *     summary: Test the configured Hik-Connect credentials with a real API call
 *     tags: [Organization Settings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Real connection test result (ok + raw response detail) }
 */
router.post("/hikconnect/test", testHikConnectHandler);

export default router;
