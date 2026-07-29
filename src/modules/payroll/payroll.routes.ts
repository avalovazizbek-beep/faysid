import { Router } from "express";
import { UserRole } from "@prisma/client";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { requireTenant } from "../../middlewares/tenant-resolver";
import { validate } from "../../middlewares/validate";
import { generatePayrollSchema, listPayrollQuerySchema, payrollIdParamSchema, updatePayrollSchema } from "./payroll.dto";
import { finalizePayrollHandler, generatePayrollHandler, listPayrollHandler, updatePayrollHandler } from "./payroll.controller";

const router = Router();

router.use(authenticate, requireTenant, authorize(UserRole.ORG_ADMIN));

/**
 * @openapi
 * /payroll:
 *   get:
 *     summary: List payroll records
 *     tags: [Payroll]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Paginated payroll list }
 */
router.get("/", validate({ query: listPayrollQuerySchema }), listPayrollHandler);

/**
 * @openapi
 * /payroll/generate:
 *   post:
 *     summary: Generate/refresh DRAFT payroll for all active employees for a month, from Attendance + approved Leave
 *     tags: [Payroll]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Per-employee generation report }
 */
router.post("/generate", validate({ body: generatePayrollSchema }), generatePayrollHandler);

router.patch("/:id", validate({ params: payrollIdParamSchema, body: updatePayrollSchema }), updatePayrollHandler);
router.post("/:id/finalize", validate({ params: payrollIdParamSchema }), finalizePayrollHandler);

export default router;
