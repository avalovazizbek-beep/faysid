import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { ApiError } from "../../common/api-error";
import { buildPagination, parsePagination } from "../../common/api-response";
import { emitToOrganization } from "../../config/socket";
import { startOfTashkentDay } from "../../common/tashkent-time";
import { resolveShiftOccurrence } from "../shift/shift-window.util";
import { CheckInDto, CheckOutDto, ListAttendanceQuery } from "./attendance.dto";

function computeIsLate(scheduledStart: Date | null, lateThresholdMinutes: number, checkInAt: Date): boolean {
  if (!scheduledStart) return false;
  const deadline = new Date(scheduledStart.getTime() + lateThresholdMinutes * 60_000);
  return checkInAt.getTime() > deadline.getTime();
}

async function getOwnedEmployee(organizationId: string, employeeId: string) {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, organizationId, deletedAt: null },
    include: { shift: { select: { startTime: true, endTime: true, lateThresholdMinutes: true } } },
  });
  if (!employee) {
    throw ApiError.notFound("Employee not found");
  }
  return employee;
}

export interface AttendanceActionOptions {
  /** The device's own live verification snapshot at this exact check-in/check-out
   * (already downloaded to local /uploads/attendance/ — see attendance-recorder.ts),
   * stored so the daily report can show visual proof of who actually badged in/out.
   * Omitted for manual/API-triggered check-ins or devices with no snapshot source —
   * never overwrites an existing photo with nothing. */
  photoUrl?: string;
  /** The real event time (device scan time), not the time this function happens to
   * run — defaults to `new Date()` for manual/API-triggered actions. */
  at?: Date;
  /** Which Tashkent business day this action belongs to — defaults to the Tashkent
   * calendar day of `at`. Callers resolving a shift's occurrence (see
   * shift-window.util.ts) pass this explicitly so an overnight shift's early-morning
   * checkout still lands on the shift's *start* day. */
  sessionDate?: Date;
  /** The device that produced this event — recorded so a later automatic
   * finalization (jobs/attendance-shift-finalize.job.ts) knows which Telegram chat
   * to notify. */
  deviceId?: string;
}

export async function checkIn(organizationId: string, dto: CheckInDto, options?: AttendanceActionOptions) {
  const employee = await getOwnedEmployee(organizationId, dto.employeeId);
  const at = options?.at ?? new Date();
  const date = options?.sessionDate ?? startOfTashkentDay(at);

  const existing = await prisma.attendance.findUnique({
    where: { employeeId_date: { employeeId: dto.employeeId, date } },
  });
  if (existing?.checkInAt && !existing.checkOutAt) {
    throw ApiError.conflict("Employee hozir ichkarida — avval check-out qilishi kerak");
  }

  let attendance;
  if (!existing) {
    // First check-in of this business day/shift occurrence.
    const scheduledStart = employee.shift ? resolveShiftOccurrence(employee.shift, date).scheduledStart : null;
    const isLate = computeIsLate(scheduledStart, employee.shift?.lateThresholdMinutes ?? 15, at);
    attendance = await prisma.attendance.create({
      data: {
        organizationId,
        employeeId: dto.employeeId,
        date,
        checkInAt: at,
        lastCheckInAt: at,
        type: dto.type,
        isLate,
        ...(options?.deviceId ? { deviceId: options.deviceId } : {}),
        ...(options?.photoUrl ? { checkInPhotoUrl: options.photoUrl } : {}),
      },
    });
  } else {
    // Re-entry after an earlier check-out on the same business day: the gap since
    // that check-out counts as a break. `checkInAt` (first-of-day) and `isLate` are
    // left untouched.
    const gapMinutes = Math.round((at.getTime() - existing.checkOutAt!.getTime()) / 60_000);
    attendance = await prisma.attendance.update({
      where: { id: existing.id },
      data: {
        checkOutAt: null,
        lastCheckInAt: at,
        breakMinutes: existing.breakMinutes + Math.max(0, gapMinutes),
        ...(options?.deviceId ? { deviceId: options.deviceId } : {}),
      },
    });
  }

  emitToOrganization(organizationId, "attendance:updated", { employeeId: dto.employeeId, action: "check-in" });

  return attendance;
}

export async function checkOut(organizationId: string, dto: CheckOutDto, options?: AttendanceActionOptions) {
  await getOwnedEmployee(organizationId, dto.employeeId);
  const at = options?.at ?? new Date();
  const date = options?.sessionDate ?? startOfTashkentDay(at);

  const existing = await prisma.attendance.findUnique({
    where: { employeeId_date: { employeeId: dto.employeeId, date } },
  });
  if (!existing?.checkInAt) {
    throw ApiError.badRequest("Employee bugun hali check-in qilmagan");
  }
  if (existing.checkOutAt) {
    throw ApiError.conflict("Employee bugun allaqachon check-out qilgan");
  }

  const sessionMinutes = Math.round((at.getTime() - existing.lastCheckInAt!.getTime()) / 60_000);
  const workedMinutes = (existing.workedMinutes ?? 0) + Math.max(0, sessionMinutes);

  const attendance = await prisma.attendance.update({
    where: { id: existing.id },
    data: { checkOutAt: at, workedMinutes, ...(options?.photoUrl ? { checkOutPhotoUrl: options.photoUrl } : {}) },
  });

  emitToOrganization(organizationId, "attendance:updated", { employeeId: dto.employeeId, action: "check-out" });

  return attendance;
}

/**
 * Records a mid-shift re-scan without flipping check-in/check-out state or
 * firing any notification — this is what stops a face terminal's repeated
 * detections of a still-present employee from toggling "keldi"/"chiqdi" on
 * every scan. Only touches a row that's genuinely open (checkInAt set,
 * checkOutAt null) for the given business day; a no-op (returns false)
 * otherwise, so the caller can decide to treat the event as a fresh check-in
 * instead (see attendance-recorder.ts).
 */
export async function touchOpenSession(
  organizationId: string,
  employeeId: string,
  sessionDate: Date,
  at: Date,
  photoUrl?: string,
  deviceId?: string,
): Promise<boolean> {
  const existing = await prisma.attendance.findFirst({
    where: { organizationId, employeeId, date: sessionDate },
  });
  if (!existing?.checkInAt || existing.checkOutAt) return false;

  await prisma.attendance.update({
    where: { id: existing.id },
    data: {
      lastSeenAt: at,
      ...(photoUrl ? { lastSeenPhotoUrl: photoUrl } : {}),
      ...(deviceId ? { deviceId } : {}),
    },
  });
  return true;
}

function computeOvertimeMinutes(workedMinutes: number | null, workingHoursPerDay: number | undefined): number {
  if (!workedMinutes || !workingHoursPerDay) return 0;
  return Math.max(0, workedMinutes - workingHoursPerDay * 60);
}

export async function listAttendance(organizationId: string, query: ListAttendanceQuery) {
  const { page, limit, skip } = parsePagination(query);

  if (query.deviceId) {
    const device = await prisma.device.findFirst({ where: { id: query.deviceId, organizationId, deletedAt: null } });
    if (!device) {
      throw ApiError.badRequest("Selected device does not belong to this organization");
    }
  }

  const employeeConditions: Prisma.EmployeeWhereInput[] = [];
  if (query.search) {
    employeeConditions.push({ OR: [{ fullName: { contains: query.search } }, { employeeCode: { contains: query.search } }] });
  }
  if (query.deviceId) {
    employeeConditions.push({ deviceSyncs: { some: { deviceId: query.deviceId, status: "SYNCED" } } });
  }

  const where: Prisma.AttendanceWhereInput = {
    organizationId,
    deletedAt: null,
    ...(query.employeeId ? { employeeId: query.employeeId } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.lateOnly === "true" ? { isLate: true } : {}),
    ...(employeeConditions.length > 0 ? { employee: { AND: employeeConditions } } : {}),
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
