import { z } from "zod";
import { OrganizationPackage, OrganizationStatus } from "@prisma/client";
import { passwordSchema } from "../../common/password-policy";

export const createOrganizationSchema = z.object({
  name: z.string().min(2).max(150),
  domain: z
    .string()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9-]+$/, "Domain may only contain lowercase letters, numbers and hyphens"),
  timezone: z.string().default("Asia/Tashkent"),
  language: z.string().default("uz"),
  package: z.nativeEnum(OrganizationPackage).default(OrganizationPackage.TRIAL),
  ownerFullName: z.string().min(2),
  ownerEmail: z.string().email(),
  ownerPassword: passwordSchema,
});
export type CreateOrganizationDto = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = z.object({
  name: z.string().min(2).max(150).optional(),
  logoUrl: z.string().url().optional(),
  timezone: z.string().optional(),
  language: z.string().optional(),
  package: z.nativeEnum(OrganizationPackage).optional(),
  status: z.nativeEnum(OrganizationStatus).optional(),
});
export type UpdateOrganizationDto = z.infer<typeof updateOrganizationSchema>;

export const listOrganizationsQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: z.nativeEnum(OrganizationStatus).optional(),
  search: z.string().optional(),
});
export type ListOrganizationsQuery = z.infer<typeof listOrganizationsQuerySchema>;

export const organizationIdParamSchema = z.object({
  id: z.string().uuid(),
});
