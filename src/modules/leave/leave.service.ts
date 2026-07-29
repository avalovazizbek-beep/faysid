import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { ApiError } from "../../common/api-error";
import { buildPagination, parsePagination } from "../../common/api-response";
import { recordAuditLog } from "../../common/audit-log";
import { CreateLeaveDto, ListLeavesQuery } from "./leave.dto";

export async function createLeave(organizationId: string, dto: CreateLeaveDto) {
  const employee = await prisma.employee.findFirst({
    where: { id: dto.employeeId, organizationId, deletedAt: null },
  });
  if (!employee) {
    throw ApiError.badRequest("Selected employee does not belong to this organization");
  }

  const startDate = new Date(dto.startDate);
  const endDate = new Date(dto.endDate);
  if (endDate < startDate) {
    throw ApiError.badRequest("endDate startDate'dan oldin bo'lishi mumkin emas");
  }

  return prisma.leave.create({
    data: { organizationId, employeeId: dto.employeeId, type: dto.type, startDate, endDate, reason: dto.reason },
    include: { employee: { select: { id: true, fullName: true, employeeCode: true } } },
  });
}

export async function listLeaves(organizationId: string, query: ListLeavesQuery) {
  const { page, limit, skip } = parsePagination(query);

  const where: Prisma.LeaveWhereInput = {
    organizationId,
    deletedAt: null,
    ...(query.employeeId ? { employeeId: query.employeeId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.type ? { type: query.type } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.leave.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: { employee: { select: { id: true, fullName: true, employeeCode: true } } },
    }),
    prisma.leave.count({ where }),
  ]);

  return { items, pagination: buildPagination(page, limit, total) };
}

async function getOwnedLeave(organizationId: string, id: string) {
  const leave = await prisma.leave.findFirst({ where: { id, organizationId, deletedAt: null } });
  if (!leave) {
    throw ApiError.notFound("Leave request not found");
  }
  return leave;
}

export async function approveLeave(organizationId: string, id: string, actorUserId: string) {
  const leave = await getOwnedLeave(organizationId, id);
  if (leave.status !== "PENDING") {
    throw ApiError.conflict("Faqat kutilayotgan so'rovlarni tasdiqlash mumkin");
  }

  const updated = await prisma.leave.update({
    where: { id },
    data: { status: "APPROVED", approvedByUserId: actorUserId, approvedAt: new Date() },
    include: { employee: { select: { id: true, fullName: true, employeeCode: true } } },
  });

  await recordAuditLog({ organizationId, userId: actorUserId, action: "LEAVE_APPROVE", entityType: "Leave", entityId: id });

  return updated;
}

export async function rejectLeave(organizationId: string, id: string, actorUserId: string) {
  const leave = await getOwnedLeave(organizationId, id);
  if (leave.status !== "PENDING") {
    throw ApiError.conflict("Faqat kutilayotgan so'rovlarni rad etish mumkin");
  }

  const updated = await prisma.leave.update({
    where: { id },
    data: { status: "REJECTED", approvedByUserId: actorUserId, approvedAt: new Date() },
    include: { employee: { select: { id: true, fullName: true, employeeCode: true } } },
  });

  await recordAuditLog({ organizationId, userId: actorUserId, action: "LEAVE_REJECT", entityType: "Leave", entityId: id });

  return updated;
}

export async function deleteLeave(organizationId: string, id: string) {
  const leave = await getOwnedLeave(organizationId, id);
  if (leave.status !== "PENDING") {
    throw ApiError.conflict("Faqat kutilayotgan so'rovlarni bekor qilish mumkin");
  }
  await prisma.leave.update({ where: { id }, data: { deletedAt: new Date() } });
}

/** Employee IDs with an APPROVED leave covering the given date — used to exclude them from "absent" counts. */
export async function getEmployeeIdsOnApprovedLeave(organizationId: string, date: Date): Promise<Set<string>> {
  const leaves = await prisma.leave.findMany({
    where: { organizationId, deletedAt: null, status: "APPROVED", startDate: { lte: date }, endDate: { gte: date } },
    select: { employeeId: true },
  });
  return new Set(leaves.map((l) => l.employeeId));
}
