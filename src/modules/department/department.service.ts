import { prisma } from "../../config/prisma";
import { ApiError } from "../../common/api-error";
import { CreateDepartmentDto, UpdateDepartmentDto } from "./department.dto";

export async function createDepartment(organizationId: string, dto: CreateDepartmentDto) {
  const existing = await prisma.department.findFirst({
    where: { organizationId, name: dto.name, deletedAt: null },
  });
  if (existing) {
    throw ApiError.conflict(`Department "${dto.name}" already exists`);
  }

  return prisma.department.create({
    data: { organizationId, name: dto.name, description: dto.description },
  });
}

export async function listDepartments(organizationId: string) {
  return prisma.department.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: { name: "asc" },
    include: { _count: { select: { employees: true } } },
  });
}

async function getOwnedDepartment(organizationId: string, id: string) {
  const department = await prisma.department.findFirst({
    where: { id, organizationId, deletedAt: null },
  });
  if (!department) {
    throw ApiError.notFound("Department not found");
  }
  return department;
}

export async function updateDepartment(organizationId: string, id: string, dto: UpdateDepartmentDto) {
  await getOwnedDepartment(organizationId, id);
  return prisma.department.update({ where: { id }, data: dto });
}

export async function deleteDepartment(organizationId: string, id: string) {
  await getOwnedDepartment(organizationId, id);
  await prisma.department.update({ where: { id }, data: { deletedAt: new Date() } });
}
