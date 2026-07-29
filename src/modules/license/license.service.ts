import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { ApiError } from "../../common/api-error";
import { buildPagination, parsePagination } from "../../common/api-response";
import { recordAuditLog } from "../../common/audit-log";
import { encryptLicenseKey, generateLicenseKey, signLicense, verifyLicenseSignature } from "../../common/license-crypto";
import {
  ActivateLicenseDto,
  GenerateLicenseDto,
  ListLicensesQuery,
  RenewLicenseDto,
  TransferLicenseDto,
} from "./license.dto";

interface Actor {
  userId: string;
  ipAddress: string | null;
}

async function createLicenseRecord(
  organizationId: string,
  licensePackage: GenerateLicenseDto["package"],
  durationDays: number,
) {
  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + durationDays * 86_400_000);
  const licenseKey = generateLicenseKey();

  const digitalSignature = signLicense({ licenseKey, organizationId, package: licensePackage, startDate, endDate });
  const encryptedKey = encryptLicenseKey(licenseKey);
  const version = (await prisma.license.count({ where: { organizationId } })) + 1;

  return prisma.license.create({
    data: {
      organizationId,
      licenseKey,
      package: licensePackage,
      startDate,
      endDate,
      digitalSignature,
      encryptedKey,
      version,
    },
  });
}

export async function generateLicense(dto: GenerateLicenseDto, actor: Actor) {
  const organization = await prisma.organization.findFirst({
    where: { id: dto.organizationId, deletedAt: null },
  });
  if (!organization) {
    throw ApiError.notFound("Organization not found");
  }

  const license = await createLicenseRecord(dto.organizationId, dto.package, dto.durationDays);

  await recordAuditLog({
    organizationId: dto.organizationId,
    userId: actor.userId,
    action: "LICENSE_GENERATE",
    entityType: "License",
    entityId: license.id,
    metadata: { package: dto.package, durationDays: dto.durationDays },
    ipAddress: actor.ipAddress,
  });

  return license;
}

async function getOwnedLicense(id: string) {
  const license = await prisma.license.findFirst({ where: { id, deletedAt: null } });
  if (!license) {
    throw ApiError.notFound("License not found");
  }
  return license;
}

export async function renewLicense(id: string, dto: RenewLicenseDto, actor: Actor) {
  const existing = await getOwnedLicense(id);
  const license = await createLicenseRecord(existing.organizationId, existing.package, dto.durationDays);

  await recordAuditLog({
    organizationId: existing.organizationId,
    userId: actor.userId,
    action: "LICENSE_RENEW",
    entityType: "License",
    entityId: license.id,
    metadata: { previousLicenseId: existing.id, durationDays: dto.durationDays },
    ipAddress: actor.ipAddress,
  });

  return license;
}

export async function disableLicense(id: string, actor: Actor) {
  const existing = await getOwnedLicense(id);
  const license = await prisma.license.update({ where: { id }, data: { status: "DISABLED" } });

  await recordAuditLog({
    organizationId: existing.organizationId,
    userId: actor.userId,
    action: "LICENSE_DISABLE",
    entityType: "License",
    entityId: id,
    ipAddress: actor.ipAddress,
  });

  return license;
}

export async function deleteLicense(id: string, actor: Actor) {
  const existing = await getOwnedLicense(id);
  await prisma.license.update({ where: { id }, data: { deletedAt: new Date() } });

  await recordAuditLog({
    organizationId: existing.organizationId,
    userId: actor.userId,
    action: "LICENSE_DELETE",
    entityType: "License",
    entityId: id,
    ipAddress: actor.ipAddress,
  });
}

export async function transferLicense(id: string, dto: TransferLicenseDto, actor: Actor) {
  const existing = await getOwnedLicense(id);

  const targetOrg = await prisma.organization.findFirst({
    where: { id: dto.targetOrganizationId, deletedAt: null },
  });
  if (!targetOrg) {
    throw ApiError.notFound("Target organization not found");
  }

  const license = await prisma.license.update({
    where: { id },
    data: { organizationId: dto.targetOrganizationId },
  });

  await recordAuditLog({
    organizationId: dto.targetOrganizationId,
    userId: actor.userId,
    action: "LICENSE_TRANSFER",
    entityType: "License",
    entityId: id,
    metadata: { fromOrganizationId: existing.organizationId, toOrganizationId: dto.targetOrganizationId },
    ipAddress: actor.ipAddress,
  });

  return license;
}

export async function listLicenses(query: ListLicensesQuery) {
  const { page, limit, skip } = parsePagination(query);

  const where: Prisma.LicenseWhereInput = {
    deletedAt: null,
    ...(query.organizationId ? { organizationId: query.organizationId } : {}),
    ...(query.status ? { status: query.status } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.license.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: { organization: { select: { id: true, name: true, domain: true } } },
    }),
    prisma.license.count({ where }),
  ]);

  return { items, pagination: buildPagination(page, limit, total) };
}

export async function activateLicenseForOrg(organizationId: string, dto: ActivateLicenseDto, actor: Actor) {
  const license = await prisma.license.findFirst({
    where: { licenseKey: dto.licenseKey, organizationId, deletedAt: null },
  });

  if (!license) {
    throw ApiError.badRequest("Litsenziya kodi noto'g'ri yoki bu tashkilotga tegishli emas");
  }
  if (license.status === "DISABLED") {
    throw ApiError.badRequest("Bu litsenziya kodi faol emas");
  }

  const signatureValid = verifyLicenseSignature(
    {
      licenseKey: license.licenseKey,
      organizationId: license.organizationId,
      package: license.package,
      startDate: license.startDate,
      endDate: license.endDate,
    },
    license.digitalSignature,
  );
  if (!signatureValid) {
    throw ApiError.badRequest("Litsenziya kodi buzilgan (signature mos kelmadi)");
  }

  if (license.endDate.getTime() < Date.now()) {
    throw ApiError.badRequest("Bu litsenziya kodi muddati tugagan. Super Admin'dan yangi kod so'rang");
  }

  const organization = await prisma.organization.update({
    where: { id: organizationId },
    data: { status: "ACTIVE", package: license.package, licenseExpiresAt: license.endDate },
  });

  await recordAuditLog({
    organizationId,
    userId: actor.userId,
    action: "LICENSE_ACTIVATED",
    entityType: "License",
    entityId: license.id,
    metadata: { package: license.package, licenseExpiresAt: license.endDate },
    ipAddress: actor.ipAddress,
  });

  return organization;
}

export async function getLicenseStatusForOrg(organizationId: string) {
  const organization = await prisma.organization.findFirstOrThrow({ where: { id: organizationId } });

  const daysRemaining = organization.licenseExpiresAt
    ? Math.ceil((organization.licenseExpiresAt.getTime() - Date.now()) / 86_400_000)
    : null;

  // The source of truth for "is this org actually usable" is licenseExpiresAt,
  // not the status field — status can drift (legacy data, manual admin
  // actions) so we never trust "ACTIVE" on its own.
  const hasValidLicense = organization.licenseExpiresAt !== null && organization.licenseExpiresAt.getTime() > Date.now();

  return {
    status: organization.status,
    package: organization.package,
    licenseExpiresAt: organization.licenseExpiresAt,
    daysRemaining,
    hasValidLicense,
  };
}
