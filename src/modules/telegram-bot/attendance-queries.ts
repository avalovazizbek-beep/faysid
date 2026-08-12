import { prisma } from "../../config/prisma";

/** The organization (and, when the chat is bound to one specific terminal, the device) this Telegram chat's commands should be scoped to. */
export interface ChatScope {
  organizationId: string;
  deviceId?: string;
  /** Device name if device-scoped, else organization name — shown in message headers. */
  label: string;
}

export async function resolveChatScope(chatId: string): Promise<ChatScope | null> {
  const device = await prisma.device.findFirst({
    where: { telegramChatId: chatId, deletedAt: null },
    select: { id: true, name: true, organizationId: true },
  });
  if (device) return { organizationId: device.organizationId, deviceId: device.id, label: device.name };

  const organization = await prisma.organization.findFirst({
    where: { telegramChatId: chatId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (organization) return { organizationId: organization.id, label: organization.name };

  return null;
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function scopedActiveEmployees(scope: ChatScope) {
  return prisma.employee.findMany({
    where: {
      organizationId: scope.organizationId,
      deletedAt: null,
      status: "ACTIVE",
      ...(scope.deviceId ? { deviceSyncs: { some: { deviceId: scope.deviceId, status: "SYNCED" } } } : {}),
    },
    select: { id: true, fullName: true },
  });
}

export interface TodaySummary {
  total: number;
  arrived: number;
  absent: number;
  late: number;
}

export async function getTodaySummary(scope: ChatScope): Promise<TodaySummary> {
  const employees = await scopedActiveEmployees(scope);
  const employeeIds = employees.map((e) => e.id);
  if (employeeIds.length === 0) return { total: 0, arrived: 0, absent: 0, late: 0 };

  const today = startOfToday();
  const [arrived, late] = await Promise.all([
    prisma.attendance.count({
      where: { employeeId: { in: employeeIds }, date: today, deletedAt: null, checkInAt: { not: null } },
    }),
    prisma.attendance.count({
      where: { employeeId: { in: employeeIds }, date: today, deletedAt: null, isLate: true },
    }),
  ]);

  return { total: employees.length, arrived, absent: Math.max(0, employees.length - arrived), late };
}

export interface NamedTime {
  fullName: string;
  time: Date | null;
}

export async function getArrivedToday(scope: ChatScope): Promise<NamedTime[]> {
  const employees = await scopedActiveEmployees(scope);
  if (employees.length === 0) return [];

  const rows = await prisma.attendance.findMany({
    where: { employeeId: { in: employees.map((e) => e.id) }, date: startOfToday(), deletedAt: null, checkInAt: { not: null } },
    include: { employee: { select: { fullName: true } } },
    orderBy: { checkInAt: "asc" },
  });
  return rows.map((r) => ({ fullName: r.employee.fullName, time: r.checkInAt }));
}

export async function getAbsentToday(scope: ChatScope): Promise<string[]> {
  const employees = await scopedActiveEmployees(scope);
  if (employees.length === 0) return [];

  const arrivedRows = await prisma.attendance.findMany({
    where: { employeeId: { in: employees.map((e) => e.id) }, date: startOfToday(), deletedAt: null, checkInAt: { not: null } },
    select: { employeeId: true },
  });
  const arrivedIds = new Set(arrivedRows.map((r) => r.employeeId));

  return employees.filter((e) => !arrivedIds.has(e.id)).map((e) => e.fullName);
}

export async function getLateToday(scope: ChatScope): Promise<NamedTime[]> {
  const employees = await scopedActiveEmployees(scope);
  if (employees.length === 0) return [];

  const rows = await prisma.attendance.findMany({
    where: { employeeId: { in: employees.map((e) => e.id) }, date: startOfToday(), deletedAt: null, isLate: true },
    include: { employee: { select: { fullName: true } } },
    orderBy: { checkInAt: "asc" },
  });
  return rows.map((r) => ({ fullName: r.employee.fullName, time: r.checkInAt }));
}
