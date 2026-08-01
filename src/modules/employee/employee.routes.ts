import { Router } from "express";
import { UserRole } from "@prisma/client";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { requireTenant } from "../../middlewares/tenant-resolver";
import { blockIfReadOnly } from "../../middlewares/enforce-read-only";
import { validate } from "../../middlewares/validate";
import { csvUpload, employeePhotoUpload } from "../../middlewares/upload";
import {
  createEmployeeSchema,
  employeeIdParamSchema,
  listEmployeesQuerySchema,
  updateEmployeeSchema,
} from "./employee.dto";
import {
  createEmployeeHandler,
  deleteEmployeeHandler,
  exportEmployeesHandler,
  getEmployeeHandler,
  importEmployeesHandler,
  listEmployeesHandler,
  purgeEmployeeHandler,
  pushEmployeeToDeviceHandler,
  updateEmployeeHandler,
} from "./employee.controller";

const router = Router();

router.use(authenticate, requireTenant, authorize(UserRole.ORG_ADMIN, UserRole.STAFF));

/**
 * @openapi
 * /employees:
 *   get:
 *     summary: List employees for the caller's organization (search/filter/paginate)
 *     tags: [Employees]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Paginated list of employees }
 *   post:
 *     summary: Create an employee (multipart/form-data, optional "photo" file)
 *     tags: [Employees]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Employee created }
 */
router.get("/", validate({ query: listEmployeesQuerySchema }), listEmployeesHandler);
router.post(
  "/",
  blockIfReadOnly,
  employeePhotoUpload.single("photo"),
  validate({ body: createEmployeeSchema }),
  createEmployeeHandler,
);

/**
 * @openapi
 * /employees/export:
 *   get:
 *     summary: Export all employees as CSV
 *     tags: [Employees]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: CSV file }
 */
router.get("/export", exportEmployeesHandler);

/**
 * @openapi
 * /employees/import:
 *   post:
 *     summary: Bulk-import employees from a CSV file (multipart/form-data, "file")
 *     tags: [Employees]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Per-row import report }
 */
router.post("/import", blockIfReadOnly, csvUpload.single("file"), importEmployeesHandler);

router.get("/:id", validate({ params: employeeIdParamSchema }), getEmployeeHandler);
router.patch(
  "/:id",
  employeePhotoUpload.single("photo"),
  validate({ params: employeeIdParamSchema, body: updateEmployeeSchema }),
  updateEmployeeHandler,
);
router.delete("/:id", validate({ params: employeeIdParamSchema }), deleteEmployeeHandler);

/**
 * @openapi
 * /employees/{id}/purge:
 *   delete:
 *     summary: Permanently remove an already-deleted employee, freeing their employeeCode for reuse (irreversible, ORG_ADMIN only)
 *     tags: [Employees]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Employee permanently removed }
 */
router.delete(
  "/:id/purge",
  authorize(UserRole.ORG_ADMIN),
  validate({ params: employeeIdParamSchema }),
  purgeEmployeeHandler,
);

/**
 * @openapi
 * /employees/{id}/push-to-device:
 *   post:
 *     summary: Push this employee (name/card/photo) to every ISAPI-credentialed Hikvision device in the organization
 *     tags: [Employees]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Per-device push result }
 */
router.post("/:id/push-to-device", validate({ params: employeeIdParamSchema }), pushEmployeeToDeviceHandler);

export default router;
