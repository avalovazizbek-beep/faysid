import bcrypt from "bcrypt";
import { Prisma, UserRole } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { ApiError } from "../../common/api-error";
import { buildPagination, parsePagination } from "../../common/api-response";
import { recordAuditLog } from "../../common/audit-log";
import { CreateOrganizationDto, ListOrganizationsQuery, UpdateOrganizationDto } from "./organization.dto";

export async function createOrganization(dto: CreateOrganizationDto) {
  const existingDomain = await prisma.organization.findUnique({ where: { domain: dto.domain } });
  if (existingDomain) {
    throw ApiError.conflict(`Domain "${dto.domain}" is already taken`);
  }

  const existingOwner = await prisma.user.findUnique({ where: { email: dto.ownerEmail } });
  if (existingOwner) {
    throw ApiError.conflict(`A user with email "${dto.ownerEmail}" already exists`);
  }

  const ownerPasswordHash = await bcrypt.hash(dto.ownerPassword, 12);

  // No license is auto-generated here — the organization starts with no active
  // license (status stays at its schema default) and is locked behind the
  // Organization Panel's license gate until the Super Admin generates a code
  // (modules/license) and the org redeems it via /org/license/activate.
  const organization = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: dto.name,
        domain: dto.domain,
        timezone: dto.timezone,
        language: dto.language,
        package: dto.package,
      },
    });

    const owner = await tx.user.create({
      data: {
        organizationId: org.id,
        role: UserRole.ORG_ADMIN,
        fullName: dto.ownerFullName,
        email: dto.ownerEmail,
        passwordHash: ownerPasswordHash,
      },
    });

    return tx.organization.update({
      where: { id: org.id },
      data: { ownerId: owner.id },
      include: { owner: { select: { id: true, fullName: true, email: true } } },
    });
  });

  await recordAuditLog({
    organizationId: organization.id,
    action: "ORGANIZATION_CREATE",
    entityType: "Organization",
    entityId: organization.id,
    metadata: { name: organization.name, domain: organization.domain, package: organization.package },
  });

  return organization;
}

export async function listOrganizations(query: ListOrganizationsQuery) {
  const { page, limit, skip } = parsePagination(query);

  const where: Prisma.OrganizationWhereInput = {
    deletedAt: null,
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search } },
            { domain: { contains: query.search } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.organization.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: { owner: { select: { id: true, fullName: true, email: true } } },
    }),
    prisma.organization.count({ where }),
  ]);

  return { items, pagination: buildPagination(page, limit, total) };
}

export async function getOrganizationById(id: string) {
  const organization = await prisma.organization.findFirst({
    where: { id, deletedAt: null },
    include: { owner: { select: { id: true, fullName: true, email: true } } },
  });

  if (!organization) {
    throw ApiError.notFound("Organization not found");
  }

  return organization;
}

interface Actor {
  userId?: string;
  ipAddress?: string | null;
}

export async function updateOrganization(id: string, dto: UpdateOrganizationDto, actor: Actor = {}) {
  await getOrganizationById(id);

  const organization = await prisma.organization.update({
    where: { id },
    data: dto,
    include: { owner: { select: { id: true, fullName: true, email: true } } },
  });

  await recordAuditLog({
    organizationId: id,
    userId: actor.userId,
    action: "ORGANIZATION_UPDATE",
    entityType: "Organization",
    entityId: id,
    metadata: dto,
    ipAddress: actor.ipAddress,
  });

  return organization;
}

export async function blockOrganization(id: string, actor: Actor = {}) {
  await getOrganizationById(id);
  const organization = await prisma.organization.update({ where: { id }, data: { status: "BLOCKED" } });

  await recordAuditLog({
    organizationId: id,
    userId: actor.userId,
    action: "ORGANIZATION_BLOCK",
    entityType: "Organization",
    entityId: id,
    ipAddress: actor.ipAddress,
  });

  return organization;
}

export async function activateOrganization(id: string, actor: Actor = {}) {
  const existing = await getOrganizationById(id);

  // "Activate" here means "un-block" — it must not force ACTIVE without a real
  // license behind it, otherwise it becomes a backdoor around the license gate.
  // Restore whatever status the organization's actual license entitles it to.
  const hasValidLicense = existing.licenseExpiresAt !== null && existing.licenseExpiresAt.getTime() > Date.now();
  const restoredStatus = hasValidLicense ? "ACTIVE" : existing.licenseExpiresAt ? "EXPIRED" : "TRIAL";

  const organization = await prisma.organization.update({ where: { id }, data: { status: restoredStatus } });

  await recordAuditLog({
    organizationId: id,
    userId: actor.userId,
    action: "ORGANIZATION_ACTIVATE",
    entityType: "Organization",
    entityId: id,
    ipAddress: actor.ipAddress,
  });

  return organization;
}

export async function deleteOrganization(id: string, actor: Actor = {}) {
  await getOrganizationById(id);
  await prisma.organization.update({ where: { id }, data: { deletedAt: new Date() } });

  await recordAuditLog({
    organizationId: id,
    userId: actor.userId,
    action: "ORGANIZATION_DELETE",
    entityType: "Organization",
    entityId: id,
    ipAddress: actor.ipAddress,
  });
}
