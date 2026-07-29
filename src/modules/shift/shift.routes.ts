import { Router } from "express";
import { UserRole } from "@prisma/client";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { requireTenant } from "../../middlewares/tenant-resolver";
import { blockIfReadOnly } from "../../middlewares/enforce-read-only";
import { validate } from "../../middlewares/validate";
import { createShiftSchema, shiftIdParamSchema, updateShiftSchema } from "./shift.dto";
import { createShiftHandler, deleteShiftHandler, listShiftsHandler, updateShiftHandler } from "./shift.controller";

const router = Router();

router.use(authenticate, requireTenant, authorize(UserRole.ORG_ADMIN, UserRole.STAFF));

/**
 * @openapi
 * /shifts:
 *   get:
 *     summary: List shifts for the caller's organization
 *     tags: [Shifts]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: List of shifts }
 *   post:
 *     summary: Create a shift
 *     tags: [Shifts]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Shift created }
 */
router.get("/", listShiftsHandler);
router.post("/", blockIfReadOnly, validate({ body: createShiftSchema }), createShiftHandler);
router.patch("/:id", validate({ params: shiftIdParamSchema, body: updateShiftSchema }), updateShiftHandler);
router.delete("/:id", validate({ params: shiftIdParamSchema }), deleteShiftHandler);

export default router;
