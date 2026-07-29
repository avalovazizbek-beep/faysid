import { Router } from "express";
import { UserRole } from "@prisma/client";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { requireTenant } from "../../middlewares/tenant-resolver";
import { blockIfReadOnly } from "../../middlewares/enforce-read-only";
import { validate } from "../../middlewares/validate";
import { createDeviceSchema, deviceIdParamSchema, updateDeviceSchema } from "./device.dto";
import {
  createDeviceHandler,
  deleteDeviceHandler,
  getDeviceHandler,
  heartbeatDeviceHandler,
  listDeviceSyncsHandler,
  listDevicesHandler,
  reconnectDeviceHandler,
  restartDeviceHandler,
  syncDeviceHandler,
  updateDeviceHandler,
} from "./device.controller";

const router = Router();

router.use(authenticate, requireTenant, authorize(UserRole.ORG_ADMIN, UserRole.STAFF));

/**
 * @openapi
 * /devices:
 *   get:
 *     summary: List devices for the caller's organization
 *     tags: [Devices]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: List of devices }
 *   post:
 *     summary: Register a device
 *     tags: [Devices]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Device created }
 */
router.get("/", listDevicesHandler);
router.post("/", blockIfReadOnly, validate({ body: createDeviceSchema }), createDeviceHandler);

router.get("/:id", validate({ params: deviceIdParamSchema }), getDeviceHandler);
router.patch("/:id", validate({ params: deviceIdParamSchema, body: updateDeviceSchema }), updateDeviceHandler);
router.delete("/:id", validate({ params: deviceIdParamSchema }), deleteDeviceHandler);

/**
 * @openapi
 * /devices/{id}/heartbeat:
 *   post:
 *     summary: Report the device alive (real — used by the device or the desktop agent)
 *     tags: [Devices]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Device marked ONLINE }
 */
router.post("/:id/heartbeat", validate({ params: deviceIdParamSchema }), heartbeatDeviceHandler);

/**
 * @openapi
 * /devices/{id}/reconnect:
 *   post:
 *     summary: Real TCP reachability check against the device's ip:port
 *     tags: [Devices]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Device status updated based on actual reachability }
 */
router.post("/:id/reconnect", validate({ params: deviceIdParamSchema }), reconnectDeviceHandler);

/**
 * @openapi
 * /devices/{id}/restart:
 *   post:
 *     summary: Restart the device (simulated — no vendor SDK available)
 *     tags: [Devices]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Simulated restart acknowledged }
 */
router.post("/:id/restart", validate({ params: deviceIdParamSchema }), restartDeviceHandler);

/**
 * @openapi
 * /devices/{id}/sync:
 *   post:
 *     summary: Push employee Face/Card/PIN credentials to the device (simulated — no vendor SDK available)
 *     tags: [Devices]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Simulated sync report }
 */
router.post("/:id/sync", validate({ params: deviceIdParamSchema }), syncDeviceHandler);
router.get("/:id/syncs", validate({ params: deviceIdParamSchema }), listDeviceSyncsHandler);

export default router;
