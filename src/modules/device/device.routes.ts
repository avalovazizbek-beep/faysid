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
  listDeviceAttendanceHandler,
  listDeviceSyncsHandler,
  listDevicesHandler,
  listDeviceUsersHandler,
  listEmployeesToSyncHandler,
  pushEmployeeToDeviceHandler,
  reconnectDeviceHandler,
  restartDeviceHandler,
  syncDeviceHandler,
  updateDeviceHandler,
} from "./device.controller";
import { cloudDeviceParamSchema, connectCloudDeviceSchema, updateHikConnectSettingsSchema } from "./device-hikconnect.dto";
import {
  connectCloudDeviceHandler,
  getHikConnectSettingsHandler,
  listCloudDevicesHandler,
  testHikConnectHandler,
  updateHikConnectSettingsHandler,
} from "./device-hikconnect.controller";

const router = Router();

router.use(authenticate, requireTenant, authorize(UserRole.ORG_ADMIN, UserRole.STAFF));

/**
 * @openapi
 * /devices/hikconnect/settings:
 *   get:
 *     summary: This organization's own Hik-Connect for Teams credentials
 *     tags: [Devices]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Hik-Connect settings (secret masked) }
 *   patch:
 *     summary: Update this organization's own Hik-Connect credentials (Organization Admin only)
 *     tags: [Devices]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Updated Hik-Connect settings }
 */
router.get("/hikconnect/settings", getHikConnectSettingsHandler);
router.patch(
  "/hikconnect/settings",
  authorize(UserRole.ORG_ADMIN),
  blockIfReadOnly,
  validate({ body: updateHikConnectSettingsSchema }),
  updateHikConnectSettingsHandler,
);

/**
 * @openapi
 * /devices/hikconnect/test:
 *   post:
 *     summary: Test this organization's configured Hik-Connect credentials with a real API call
 *     tags: [Devices]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Real connection test result }
 */
router.post("/hikconnect/test", testHikConnectHandler);

/**
 * @openapi
 * /devices/hikconnect/cloud-devices:
 *   get:
 *     summary: Every terminal in this organization's own Hik-Connect account, flagged with local connection status
 *     tags: [Devices]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Hik-Connect cloud devices }
 */
router.get("/hikconnect/cloud-devices", listCloudDevicesHandler);

/**
 * @openapi
 * /devices/hikconnect/cloud-devices/{hikConnectDeviceId}/connect:
 *   post:
 *     summary: Connect one of this organization's own Hik-Connect devices into a local Device row (Organization Admin only)
 *     tags: [Devices]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: The organization's Device row for this Hik-Connect device }
 */
router.post(
  "/hikconnect/cloud-devices/:hikConnectDeviceId/connect",
  authorize(UserRole.ORG_ADMIN),
  blockIfReadOnly,
  validate({ params: cloudDeviceParamSchema, body: connectCloudDeviceSchema }),
  connectCloudDeviceHandler,
);

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
 *     summary: Report the device alive (real)
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
 * /devices/{id}/attendance:
 *   get:
 *     summary: Recent attendance for the employees synced to this device
 *     tags: [Devices]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Recent Attendance rows for this device's synced employees }
 */
router.get("/:id/attendance", validate({ params: deviceIdParamSchema }), listDeviceAttendanceHandler);

/**
 * @openapi
 * /devices/{id}/employees/{employeeId}/push:
 *   post:
 *     summary: Push one employee's Face/Card data to this one device (real)
 *     tags: [Devices]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Real push result }
 */
router.post(
  "/:id/employees/:employeeId/push",
  blockIfReadOnly,
  validate({ params: deviceEmployeeSyncParamSchema }),
  pushEmployeeToDeviceHandler,
);

/**
 * @openapi
 * /devices/{id}/employees-to-sync:
 *   get:
 *     summary: Real list of employees eligible to be pushed to the device
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
 *     summary: Report the real outcome of pushing one employee to the device
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
