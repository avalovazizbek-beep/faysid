import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { buildPagination, parsePagination } from "../../common/api-response";
import { ListAuditLogsQuery } from "./audit-log.dto";

export async function listAuditLogs(query: ListAuditLogsQuery) {
  const { page, limit, skip } = parsePagination(query);

  const where: Prisma.AuditLogWhereInput = {
    ...(query.action ? { action: query.action } : {}),
    ...(query.organizationId ? { organizationId: query.organizationId } : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          },
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        organization: { select: { id: true, name: true } },
        user: { select: { id: true, fullName: true, email: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { items, pagination: buildPagination(page, limit, total) };
}
