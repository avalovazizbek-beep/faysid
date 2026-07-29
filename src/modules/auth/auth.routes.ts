import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate";
import { validate } from "../../middlewares/validate";
import { authRateLimiter } from "../../middlewares/rate-limiter";
import { loginSchema, refreshSchema } from "./auth.dto";
import { getMeHandler, loginHandler, logoutHandler, refreshHandler } from "./auth.controller";
import twoFactorRoutes from "./two-factor.routes";

const router = Router();
router.use(authRateLimiter);

router.use("/2fa", twoFactorRoutes);

/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Authenticate a user and issue an access/refresh token pair
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string, minLength: 8 }
 *     responses:
 *       200: { description: Login successful }
 *       401: { description: Invalid credentials }
 */
router.post("/login", validate({ body: loginSchema }), loginHandler);

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     summary: Exchange a refresh token for a new access/refresh token pair
 *     tags: [Auth]
 *     responses:
 *       200: { description: Token refreshed }
 *       401: { description: Invalid or expired refresh token }
 */
router.post("/refresh", validate({ body: refreshSchema }), refreshHandler);

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     summary: Revoke a refresh token
 *     tags: [Auth]
 *     responses:
 *       200: { description: Logged out }
 */
router.post("/logout", validate({ body: refreshSchema }), logoutHandler);

/**
 * @openapi
 * /auth/me:
 *   get:
 *     summary: Current authenticated user's profile
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Current user }
 */
router.get("/me", authenticate, getMeHandler);

export default router;
