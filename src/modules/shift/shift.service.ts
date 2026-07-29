import { prisma } from "../../config/prisma";
import { ApiError } from "../../common/api-error";
import { CreateShiftDto, UpdateShiftDto } from "./shift.dto";

export async function createShift(organizationId: string, dto: CreateShiftDto) {
  const existing = await prisma.shift.findFirst({
    where: { organizationId, name: dto.name, deletedAt: null },
  });
  if (existing) {
    throw ApiError.conflict(`Shift "${dto.name}" already exists`);
  }

  return prisma.shift.create({ data: { organizationId, ...dto } });
}

export async function listShifts(organizationId: string) {
  return prisma.shift.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: { name: "asc" },
    include: { _count: { select: { employees: true } } },
  });
}

async function getOwnedShift(organizationId: string, id: string) {
  const shift = await prisma.shift.findFirst({ where: { id, organizationId, deletedAt: null } });
  if (!shift) {
    throw ApiError.notFound("Shift not found");
  }
  return shift;
}

export async function updateShift(organizationId: string, id: string, dto: UpdateShiftDto) {
  await getOwnedShift(organizationId, id);
  return prisma.shift.update({ where: { id }, data: dto });
}

export async function deleteShift(organizationId: string, id: string) {
  await getOwnedShift(organizationId, id);
  await prisma.shift.update({ where: { id }, data: { deletedAt: new Date() } });
}
