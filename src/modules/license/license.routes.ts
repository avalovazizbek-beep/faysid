import { Router } from "express";
import { UserRole } from "@prisma/client";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { validate } from "../../middlewares/validate";
import {
  generateLicenseSchema,
  licenseIdParamSchema,
  listLicensesQuerySchema,
  renewLicenseSchema,
  transferLicenseSchema,
} from "./license.dto";
import {
  deleteLicenseHandler,
  disableLicenseHandler,
  generateLicenseHandler,
  listLicensesHandler,
  renewLicenseHandler,
  transferLicenseHandler,
} from "./license.controller";

const router = Router();

// Super Admin only — licenses are generated/managed at the platform level and
// handed to organizations through an offline channel; orgs redeem them via /org/license.
router.use(authenticate, authorize(UserRole.SUPER_ADMIN));

/**
 * @openapi
 * /licenses:
 *   get:
 *     summary: List/search licenses across all organizations (Super Admin) — also serves as the Billing history view
 *     tags: [Licenses]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Paginated list of licenses }
 *   post:
 *     summary: Generate a new redeemable license code for an organization
 *     tags: [Licenses]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       201: { description: License generated }
 */
router.get("/", validate({ query: listLicensesQuerySchema }), listLicensesHandler);
router.post("/", validate({ body: generateLicenseSchema }), generateLicenseHandler);

router.post(
  "/:id/renew",
  validate({ params: licenseIdParamSchema, body: renewLicenseSchema }),
  renewLicenseHandler,
);
router.post("/:id/disable", validate({ params: licenseIdParamSchema }), disableLicenseHandler);
router.post(
  "/:id/transfer",
  validate({ params: licenseIdParamSchema, body: transferLicenseSchema }),
  transferLicenseHandler,
);
router.delete("/:id", validate({ params: licenseIdParamSchema }), deleteLicenseHandler);

export default router;
