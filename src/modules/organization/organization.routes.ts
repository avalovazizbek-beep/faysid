import { Router } from "express";
import { UserRole } from "@prisma/client";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { validate } from "../../middlewares/validate";
import {
  createOrganizationSchema,
  listOrganizationsQuerySchema,
  organizationIdParamSchema,
  updateOrganizationSchema,
} from "./organization.dto";
import {
  activateOrganizationHandler,
  blockOrganizationHandler,
  createOrganizationHandler,
  deleteOrganizationHandler,
  getOrganizationHandler,
  listOrganizationsHandler,
  updateOrganizationHandler,
} from "./organization.controller";

const router = Router();

// Every route here is Super Admin only — organizations are managed at the platform level.
router.use(authenticate, authorize(UserRole.SUPER_ADMIN));

/**
 * @openapi
 * /organizations:
 *   get:
 *     summary: List organizations (Super Admin)
 *     tags: [Organizations]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Paginated list of organizations }
 *   post:
 *     summary: Create a new organization with its owner account (Super Admin)
 *     tags: [Organizations]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: Organization created }
 */
router.get("/", validate({ query: listOrganizationsQuerySchema }), listOrganizationsHandler);
router.post("/", validate({ body: createOrganizationSchema }), createOrganizationHandler);

router.get("/:id", validate({ params: organizationIdParamSchema }), getOrganizationHandler);
router.patch(
  "/:id",
  validate({ params: organizationIdParamSchema, body: updateOrganizationSchema }),
  updateOrganizationHandler,
);
router.post("/:id/block", validate({ params: organizationIdParamSchema }), blockOrganizationHandler);
router.post("/:id/activate", validate({ params: organizationIdParamSchema }), activateOrganizationHandler);
router.delete("/:id", validate({ params: organizationIdParamSchema }), deleteOrganizationHandler);

export default router;
