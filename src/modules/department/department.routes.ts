import { Router } from "express";
import { UserRole } from "@prisma/client";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { requireTenant } from "../../middlewares/tenant-resolver";
import { validate } from "../../middlewares/validate";
import { createDepartmentSchema, departmentIdParamSchema, updateDepartmentSchema } from "./department.dto";
import {
  createDepartmentHandler,
  deleteDepartmentHandler,
  listDepartmentsHandler,
  updateDepartmentHandler,
} from "./department.controller";

const router = Router();

router.use(authenticate, requireTenant, authorize(UserRole.ORG_ADMIN, UserRole.STAFF));

/**
 * @openapi
 * /departments:
 *   get:
 *     summary: List departments for the caller's organization
 *     tags: [Departments]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: List of departments }
 *   post:
 *     summary: Create a department
 *     tags: [Departments]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Department created }
 */
router.get("/", listDepartmentsHandler);
router.post("/", validate({ body: createDepartmentSchema }), createDepartmentHandler);
router.patch(
  "/:id",
  validate({ params: departmentIdParamSchema, body: updateDepartmentSchema }),
  updateDepartmentHandler,
);
router.delete("/:id", validate({ params: departmentIdParamSchema }), deleteDepartmentHandler);

export default router;
