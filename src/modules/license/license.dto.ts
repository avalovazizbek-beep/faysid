import { z } from "zod";
import { LicenseStatus, OrganizationPackage } from "@prisma/client";

export const generateLicenseSchema = z.object({
  organizationId: z.string().uuid(),
  package: z.nativeEnum(OrganizationPackage),
  durationDays: z.coerce.number().int().positive().max(3650),
});
export type GenerateLicenseDto = z.infer<typeof generateLicenseSchema>;

export const renewLicenseSchema = z.object({
  durationDays: z.coerce.number().int().positive().max(3650),
});
export type RenewLicenseDto = z.infer<typeof renewLicenseSchema>;

export const transferLicenseSchema = z.object({
  targetOrganizationId: z.string().uuid(),
});
export type TransferLicenseDto = z.infer<typeof transferLicenseSchema>;

export const listLicensesQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  organizationId: z.string().uuid().optional(),
  status: z.nativeEnum(LicenseStatus).optional(),
});
export type ListLicensesQuery = z.infer<typeof listLicensesQuerySchema>;

export const licenseIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const activateLicenseSchema = z.object({
  licenseKey: z.string().min(1),
});
export type ActivateLicenseDto = z.infer<typeof activateLicenseSchema>;
