import { NextFunction, Request, Response } from "express";
import { prisma } from "../config/prisma";
import { ApiError } from "../common/api-error";
import { asyncHandler } from "../common/async-handler";

/**
 * Blocks creation of new resources unless the organization has a currently
 * redeemed, active license. Gates on licenseExpiresAt directly rather than the
 * `status` field — status can drift out of sync (legacy data, manual admin
 * actions) but licenseExpiresAt is only ever set by an actual license redeem,
 * so it can't be faked into granting access.
 */
export const blockIfReadOnly = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: req.tenantId! },
    select: { status: true, licenseExpiresAt: true },
  });

  if (organization.status === "BLOCKED") {
    throw ApiError.forbidden("Ushbu tashkilot Super Admin tomonidan bloklangan.");
  }

  const hasValidLicense = organization.licenseExpiresAt !== null && organization.licenseExpiresAt.getTime() > Date.now();
  if (!hasValidLicense) {
    throw ApiError.forbidden(
      "Litsenziya kodi kiritilmagan yoki muddati tugagan. Iltimos, Super Admin bergan litsenziya kodini kiriting.",
    );
  }

  next();
});
