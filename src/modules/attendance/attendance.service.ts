import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { ApiError } from "../../common/api-error";
import { buildPagination, parsePagination } from "../../common/api-response";
import { emitToOrganization } from "../../config/socket";
import { CheckInDto, CheckOutDto, ListAttendanceQuery } from "./attendance.dto";

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function computeIsLate(shift: { startTime: string; lateThresholdMinutes: number } | null, checkInAt: Date): boolean {
  if (!shift) return false;

  const [hours, minutes] = shift.startTime.split(":").map(Number);
  const scheduledStart = new Date(checkInAt);
  scheduledStart.setHours(hours, minutes, 0, 0);
  const deadline = new Date(scheduledStart.getTime() + shift.lateThresholdMinutes * 60_000);

  return checkInAt.getTime() > deadline.getTime();
}

async function getOwnedEmployee(organizationId: string, employeeId: string) {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, organizationId, deletedAt: null },
    include: { shift: { select: { startTime: true, lateThresholdMinutes: true } } },
  });
  if (!employee) {
    throw ApiError.notFound("Employee not found");
  }
  return employee;
}

export async function checkIn(organizationId: string, dto: CheckInDto) {
  const employee = await getOwnedEmployee(organizationId, dto.employeeId);
  const date = startOfToday();
  const now = new Date();

  const existing = await prisma.attendance.findUnique({
    where: { employeeId_date: { employeeId: dto.employeeId, date } },
  });
  if (existing?.checkInAt && !existing.checkOutAt) {
    throw ApiError.conflict("Employee hozir ichkarida — avval check-out qilishi kerak");
  }

  let attendance;
  if (!existing) {
    // First check-in of the day.
    const isLate = computeIsLate(employee.shift, now);
    attendance = await prisma.attendance.create({
      data: {
        organizationId,
        employeeId: dto.employeeId,
        date,
        checkInAt: now,
        lastCheckInAt: now,
        type: dto.type,
        isLate,
      },
    });
  } else {
    // Re-entry after an earlier check-out today: the gap since that check-out counts
    // as a break. `checkInAt` (first-of-day) and `isLate` are left untouched.
    const gapMinutes = Math.round((now.getTime() - existing.checkOutAt!.getTime()) / 60_000);
    attendance = await prisma.attendance.update({
      where: { id: existing.id },
      data: {
        checkOutAt: null,
        lastCheckInAt: now,
        breakMinutes: existing.breakMinutes + Math.max(0, gapMinutes),
      },
    });
  }

  emitToOrganization(organizationId, "attendance:updated", { employeeId: dto.employeeId, action: "check-in" });

  return attendance;
}

export async function checkOut(organizationId: string, dto: CheckOutDto) {
  await getOwnedEmployee(organizationId, dto.employeeId);
  const date = startOfToday();
  const now = new Date();

  const existing = await prisma.attendance.findUnique({
    where: { employeeId_date: { employeeId: dto.employeeId, date } },
  });
  if (!existing?.checkInAt) {
    throw ApiError.badRequest("Employee bugun hali check-in qilmagan");
  }
  if (existing.checkOutAt) {
    throw ApiError.conflict("Employee bugun allaqachon check-out qilgan");
  }

  const sessionMinutes = Math.round((now.getTime() - existing.lastCheckInAt!.getTime()) / 60_000);
  const workedMinutes = (existing.workedMinutes ?? 0) + Math.max(0, sessionMinutes);

  const attendance = await prisma.attendance.update({
    where: { id: existing.id },
    data: { checkOutAt: now, workedMinutes },
  });

  emitToOrganization(organizationId, "attendance:updated", { employeeId: dto.employeeId, action: "check-out" });

  return attendance;
}

function computeOvertimeMinutes(workedMinutes: number | null, workingHoursPerDay: number | undefined): number {
  if (!workedMinutes || !workingHoursPerDay) return 0;
  return Math.max(0, workedMinutes - workingHoursPerDay * 60);
}

export async function listAttendance(organizationId: string, query: ListAttendanceQuery) {
  const { page, limit, skip } = parsePagination(query);

  const where: Prisma.AttendanceWhereInput = {
    organizationId,
    deletedAt: null,
    ...(query.employeeId ? { employeeId: query.employeeId } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.lateOnly === "true" ? { isLate: true } : {}),
    ...(query.search
      ? {
          employee: {
            OR: [{ fullName: { contains: query.search } }, { employeeCode: { contains: query.search } }],
          },
        }
      : {}),
    ...(query.dateFrom || query.dateTo
      ? {
          date: {
            ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
            ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
          },
        }
      : {}),
  };

  const [records, total] = await Promise.all([
    prisma.attendance.findMany({
      where,
      skip,
      take: limit,
      orderBy: { date: "desc" },
      include: {
        employee: {
          select: { id: true, fullName: true, employeeCode: true, shift: { select: { workingHoursPerDay: true } } },
        },
      },
    }),
    prisma.attendance.count({ where }),
  ]);

  const items = records.map((record) => ({
    ...record,
    overtimeMinutes: computeOvertimeMinutes(record.workedMinutes, record.employee.shift?.workingHoursPerDay),
  }));

  return { items, pagination: buildPagination(page, limit, total) };
}
