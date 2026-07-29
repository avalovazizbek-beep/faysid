import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate";
import { validate } from "../../middlewares/validate";
import { disableTwoFactorSchema, enableTwoFactorSchema, verifyTwoFactorSchema } from "./two-factor.dto";
import {
  disableTwoFactorHandler,
  enableTwoFactorHandler,
  setupTwoFactorHandler,
  verifyTwoFactorHandler,
} from "./two-factor.controller";

const router = Router();

/**
 * @openapi
 * /auth/2fa/verify:
 *   post:
 *     summary: Complete login with a TOTP code after a 2FA challenge
 *     tags: [Auth]
 *     responses:
 *       200: { description: Login completed, tokens issued }
 */
router.post("/verify", validate({ body: verifyTwoFactorSchema }), verifyTwoFactorHandler);

router.use(authenticate);

/**
 * @openapi
 * /auth/2fa/setup:
 *   post:
 *     summary: Start 2FA setup — generates a secret and QR code (not yet enabled)
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Secret + otpauth URL + QR code data URL }
 */
router.post("/setup", setupTwoFactorHandler);

/**
 * @openapi
 * /auth/2fa/enable:
 *   post:
 *     summary: Confirm setup with a code from the authenticator app and enable 2FA
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: 2FA enabled }
 */
router.post("/enable", validate({ body: enableTwoFactorSchema }), enableTwoFactorHandler);

/**
 * @openapi
 * /auth/2fa/disable:
 *   post:
 *     summary: Disable 2FA (requires a valid current code)
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: 2FA disabled }
 */
router.post("/disable", validate({ body: disableTwoFactorSchema }), disableTwoFactorHandler);

export default router;
