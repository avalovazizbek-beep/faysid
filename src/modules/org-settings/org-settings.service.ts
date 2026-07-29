import { prisma } from "../../config/prisma";
import { ApiError } from "../../common/api-error";
import { UpdateOrgSettingsDto } from "./org-settings.dto";

export async function getOrgSettings(organizationId: string) {
  const organization = await prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    select: { telegramChatId: true },
  });
  if (!organization) {
    throw ApiError.notFound("Organization not found");
  }
  return organization;
}

export async function updateOrgSettings(organizationId: string, dto: UpdateOrgSettingsDto) {
  return prisma.organization.update({
    where: { id: organizationId },
    data: { telegramChatId: dto.telegramChatId },
    select: { telegramChatId: true },
  });
}
