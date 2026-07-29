import { Router } from "express";
import { UserRole } from "@prisma/client";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { requireTenant } from "../../middlewares/tenant-resolver";
import { validate } from "../../middlewares/validate";
import { activateLicenseSchema } from "./license.dto";
import { activateOrgLicenseHandler, getOrgLicenseStatusHandler } from "./org-license.controller";

const router = Router();

router.use(authenticate, requireTenant, authorize(UserRole.ORG_ADMIN, UserRole.STAFF));

/**
 * @openapi
 * /org/license/status:
 *   get:
 *     summary: Current license status for the caller's organization (drives the Organization Panel's blocking overlay)
 *     tags: [Organization License]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: License status }
 */
router.get("/status", getOrgLicenseStatusHandler);

/**
 * @openapi
 * /org/license/activate:
 *   post:
 *     summary: Redeem a license code issued by the Super Admin
 *     tags: [Organization License]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: License activated }
 *       400: { description: Invalid, disabled, or expired license code }
 */
router.post("/activate", validate({ body: activateLicenseSchema }), activateOrgLicenseHandler);

export default router;
