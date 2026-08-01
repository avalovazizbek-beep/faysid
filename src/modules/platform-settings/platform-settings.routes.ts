import { Router } from "express";
import { UserRole } from "@prisma/client";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { validate } from "../../middlewares/validate";
import { updatePlatformSettingsSchema } from "./platform-settings.dto";
import {
  getPlatformSettingsHandler,
  testHikConnectHandler,
  updatePlatformSettingsHandler,
} from "./platform-settings.controller";

const router = Router();

router.use(authenticate, authorize(UserRole.SUPER_ADMIN));

/**
 * @openapi
 * /admin/settings:
 *   get:
 *     summary: Platform-wide settings (e.g. the operator's own Hik-Connect credentials)
 *     tags: [Platform Settings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Platform settings }
 *   patch:
 *     summary: Update platform-wide settings
 *     tags: [Platform Settings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Updated platform settings }
 */
router.get("/", getPlatformSettingsHandler);
router.patch("/", validate({ body: updatePlatformSettingsSchema }), updatePlatformSettingsHandler);

/**
 * @openapi
 * /admin/settings/hikconnect/test:
 *   post:
 *     summary: Test the configured Hik-Connect credentials with a real API call
 *     tags: [Platform Settings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Real connection test result (ok + raw response detail) }
 */
router.post("/hikconnect/test", testHikConnectHandler);

export default router;
