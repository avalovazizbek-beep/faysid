import { NextFunction, Request, Response } from "express";
import { ApiError } from "../common/api-error";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenantId?: string;
    }
  }
}

/**
 * Scopes the request to the caller's organization. Use on every
 * organization-panel route so tenants can never read/write across
 * organization boundaries. SUPER_ADMIN has no tenant and must use
 * super-admin-only routes instead.
 */
export function requireTenant(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user?.organizationId) {
    next(ApiError.forbidden("This action requires an organization-scoped account"));
    return;
  }
  req.tenantId = req.user.organizationId;
  next();
}
