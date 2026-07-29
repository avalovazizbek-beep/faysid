import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { ApiError } from "../../common/api-error";
import { buildPagination, parsePagination } from "../../common/api-response";
import { recordAuditLog } from "../../common/audit-log";
import { GeneratePayrollDto, ListPayrollQuery, UpdatePayrollDto } from "./payroll.dto";

const STANDARD_WORKING_DAYS_PER_MONTH = 22;
const DEFAULT_DAILY_HOURS = 8;

function monthRange(periodYear: number, periodMonth: number): { start: Date; end: Date; daysInMonth: number } {
  const start = new Date(Date.UTC(periodYear, periodMonth - 1, 1));
  const end = new Date(Date.UTC(periodYear, periodMonth, 1));
  const daysInMonth = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return { start, end, daysInMonth };
}

export async function generatePayroll(organizationId: string, dto: GeneratePayrollDto, actorUserId: string) {
  const { start, end } = monthRange(dto.periodYear, dto.periodMonth);

  const employees = await prisma.employee.findMany({
    where: { organizationId, deletedAt: null, status: "ACTIVE", salary: { not: null } },
    include: { shift: { select: { workingHoursPerDay: true } } },
  });

  const results: { employeeId: string; status: "generated" | "skipped"; reason?: string }[] = [];

  for (const employee of employees) {
    const existing = await prisma.payroll.findUnique({
      where: { employeeId_periodMonth_periodYear: { employeeId: employee.id, periodMonth: dto.periodMonth, periodYear: dto.periodYear } },
    });
    if (existing?.status === "FINALIZED") {
      results.push({ employeeId: employee.id, status: "skipped", reason: "already finalized" });
      continue;
    }

    const attendanceRows = await prisma.attendance.findMany({
      where: { employeeId: employee.id, date: { gte: start, lt: end }, deletedAt: null },
    });

    const workedDays = attendanceRows.filter((a) => a.checkInAt !== null).length;
    const lateDays = attendanceRows.filter((a) => a.isLate).length;
    const overtimeMinutes = attendanceRows.reduce((sum, a) => {
      const dailyHours = employee.shift?.workingHoursPerDay ?? DEFAULT_DAILY_HOURS;
      if (!a.workedMinutes) return sum;
      return sum + Math.max(0, a.workedMinutes - dailyHours * 60);
    }, 0);

    const approvedLeaves = await prisma.leave.findMany({
      where: { employeeId: employee.id, organizationId, deletedAt: null, status: "APPROVED", startDate: { lt: end }, endDate: { gte: start } },
    });
    // Simplified: count each approved leave's days that fall within this month (no working-calendar/weekend logic).
    const leaveDays = approvedLeaves.reduce((sum, leave) => {
      const from = leave.startDate < start ? start : leave.startDate;
      const to = leave.endDate >= end ? new Date(end.getTime() - 86_400_000) : leave.endDate;
      const days = Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1);
      return sum + days;
    }, 0);

    const baseSalary = Number(employee.salary);
    const dailyHours = employee.shift?.workingHoursPerDay ?? DEFAULT_DAILY_HOURS;
    const hourlyRate = baseSalary / (STANDARD_WORKING_DAYS_PER_MONTH * dailyHours);
    const overtimePay = Math.round(hourlyRate * (overtimeMinutes / 60) * 100) / 100;
    const absentDays = Math.max(0, STANDARD_WORKING_DAYS_PER_MONTH - workedDays - leaveDays);

    const bonus = existing ? Number(existing.bonus) : 0;
    const penalty = existing ? Number(existing.penalty) : 0;
    const totalPay = Math.round((baseSalary + overtimePay + bonus - penalty) * 100) / 100;

    await prisma.payroll.upsert({
      where: { employeeId_periodMonth_periodYear: { employeeId: employee.id, periodMonth: dto.periodMonth, periodYear: dto.periodYear } },
      create: {
        organizationId,
        employeeId: employee.id,
        periodMonth: dto.periodMonth,
        periodYear: dto.periodYear,
        baseSalary,
        workedDays,
        lateDays,
        absentDays,
        overtimeMinutes,
        overtimePay,
        bonus,
        penalty,
        totalPay,
      },
      update: { baseSalary, workedDays, lateDays, absentDays, overtimeMinutes, overtimePay, totalPay },
    });

    results.push({ employeeId: employee.id, status: "generated" });
  }

  await recordAuditLog({
    organizationId,
    userId: actorUserId,
    action: "PAYROLL_GENERATE",
    metadata: { periodMonth: dto.periodMonth, periodYear: dto.periodYear, count: results.length },
  });

  return results;
}

export async function listPayroll(organizationId: string, query: ListPayrollQuery) {
  const { page, limit, skip } = parsePagination(query);

  const where: Prisma.PayrollWhereInput = {
    organizationId,
    deletedAt: null,
    ...(query.employeeId ? { employeeId: query.employeeId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.periodMonth ? { periodMonth: Number(query.periodMonth) } : {}),
    ...(query.periodYear ? { periodYear: Number(query.periodYear) } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.payroll.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }],
      include: { employee: { select: { id: true, fullName: true, employeeCode: true } } },
    }),
    prisma.payroll.count({ where }),
  ]);

  return { items, pagination: buildPagination(page, limit, total) };
}

async function getOwnedPayroll(organizationId: string, id: string) {
  const payroll = await prisma.payroll.findFirst({ where: { id, organizationId, deletedAt: null } });
  if (!payroll) {
    throw ApiError.notFound("Payroll record not found");
  }
  return payroll;
}

export async function updatePayroll(organizationId: string, id: string, dto: UpdatePayrollDto) {
  const payroll = await getOwnedPayroll(organizationId, id);
  if (payroll.status === "FINALIZED") {
    throw ApiError.conflict("Finalized payroll cannot be edited");
  }

  const bonus = dto.bonus ?? Number(payroll.bonus);
  const penalty = dto.penalty ?? Number(payroll.penalty);
  const totalPay = Math.round((Number(payroll.baseSalary) + Number(payroll.overtimePay) + bonus - penalty) * 100) / 100;

  return prisma.payroll.update({
    where: { id },
    data: { bonus, penalty, totalPay },
    include: { employee: { select: { id: true, fullName: true, employeeCode: true } } },
  });
}

export async function finalizePayroll(organizationId: string, id: string, actorUserId: string) {
  const payroll = await getOwnedPayroll(organizationId, id);
  if (payroll.status === "FINALIZED") {
    throw ApiError.conflict("Already finalized");
  }

  const updated = await prisma.payroll.update({ where: { id }, data: { status: "FINALIZED" } });

  await recordAuditLog({ organizationId, userId: actorUserId, action: "PAYROLL_FINALIZE", entityType: "Payroll", entityId: id });

  return updated;
}
