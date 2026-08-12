import { Router } from "express";
import { UserRole } from "@prisma/client";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { validate } from "../../middlewares/validate";
import { assignHikConnectDeviceSchema, hikConnectDeviceParamSchema, updatePlatformSettingsSchema } from "./platform-settings.dto";
import {
  assignHikConnectDeviceHandler,
  getPlatformSettingsHandler,
  listHikConnectDevicesHandler,
  testHikConnectHandler,
  unassignHikConnectDeviceHandler,
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

/**
 * @openapi
 * /admin/settings/hikconnect/devices:
 *   get:
 *     summary: Every terminal in the platform-wide Hik-Connect account, with which Organization (if any) it's assigned to
 *     tags: [Platform Settings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Hik-Connect devices with assignment status }
 */
router.get("/hikconnect/devices", listHikConnectDevicesHandler);

/**
 * @openapi
 * /admin/settings/hikconnect/devices/{hikConnectDeviceId}/assign:
 *   post:
 *     summary: Assign (or move) a raw Hik-Connect device to an Organization — creates its Device row if needed
 *     tags: [Platform Settings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: The organization's Device row for this Hik-Connect device }
 */
router.post(
  "/hikconnect/devices/:hikConnectDeviceId/assign",
  validate({ params: hikConnectDeviceParamSchema, body: assignHikConnectDeviceSchema }),
  assignHikConnectDeviceHandler,
);

/**
 * @openapi
 * /admin/settings/hikconnect/devices/{hikConnectDeviceId}/unassign:
 *   post:
 *     summary: Unbind a Hik-Connect device from whichever organization currently holds it
 *     tags: [Platform Settings]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Unassigned }
 */
router.post(
  "/hikconnect/devices/:hikConnectDeviceId/unassign",
  validate({ params: hikConnectDeviceParamSchema }),
  unassignHikConnectDeviceHandler,
);

export default router;
