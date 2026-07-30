import { Router } from "express";
import { UserRole } from "@prisma/client";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { requireTenant } from "../../middlewares/tenant-resolver";
import { blockIfReadOnly } from "../../middlewares/enforce-read-only";
import { validate } from "../../middlewares/validate";
import {
  ackEmployeeSyncSchema,
  createDeviceSchema,
  deviceEmployeeSyncParamSchema,
  deviceIdParamSchema,
  deviceUserParamSchema,
  importDeviceUserSchema,
  updateDeviceSchema,
} from "./device.dto";
import {
  ackEmployeeSyncHandler,
  createDeviceHandler,
  deleteDeviceHandler,
  getDeviceHandler,
  heartbeatDeviceHandler,
  importDeviceUserHandler,
  listDeviceSyncsHandler,
  listDevicesHandler,
  listDeviceUsersHandler,
  listEmployeesToSyncHandler,
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

/**
 * @openapi
 * /devices/{id}/employees-to-sync:
 *   get:
 *     summary: Real list of employees eligible to be pushed to the device (used by the desktop bridge)
 *     tags: [Devices]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Employees with photo/card/pin credentials to enroll }
 */
router.get("/:id/employees-to-sync", validate({ params: deviceIdParamSchema }), listEmployeesToSyncHandler);

/**
 * @openapi
 * /devices/{id}/device-users:
 *   get:
 *     summary: Real list of the device's own enrolled people (ISAPI), reconciled against employeeCode
 *     tags: [Devices]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Device Person IDs with matched employee (if any) }
 */
router.get("/:id/device-users", validate({ params: deviceIdParamSchema }), listDeviceUsersHandler);

/**
 * @openapi
 * /devices/{id}/device-users/{personId}/import:
 *   post:
 *     summary: Create a bare FaceHub employee (employeeCode = personId) for a device person with no matching site record
 *     tags: [Devices]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Employee created }
 */
router.post(
  "/:id/device-users/:personId/import",
  validate({ params: deviceUserParamSchema, body: importDeviceUserSchema }),
  importDeviceUserHandler,
);

/**
 * @openapi
 * /devices/{id}/syncs/{employeeId}/ack:
 *   post:
 *     summary: Report the real outcome of pushing one employee to the device (called by the desktop bridge)
 *     tags: [Devices]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: DeviceEmployeeSync row updated with the real result }
 */
router.post(
  "/:id/syncs/:employeeId/ack",
  validate({ params: deviceEmployeeSyncParamSchema, body: ackEmployeeSyncSchema }),
  ackEmployeeSyncHandler,
);

export default router;
