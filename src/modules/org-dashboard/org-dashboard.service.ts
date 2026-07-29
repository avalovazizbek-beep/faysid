import { prisma } from "../../config/prisma";
import { getEmployeeIdsOnApprovedLeave } from "../leave/leave.service";

export type AttendanceRange = "daily" | "weekly" | "monthly" | "yearly";

export interface OrgDashboardStats {
  totalEmployees: number;
  activeEmployees: number;
  totalDepartments: number;
  onlineDevices: number;
  offlineDevices: number;
  attendanceToday: {
    arrived: number;
    absent: number;
    onLeave: number;
    inside: number;
    late: number;
    workedHours: number;
    overtimeMinutes: number;
  };
  attendanceSeries: { label: string; count: number }[];
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function getAttendanceToday(organizationId: string, activeEmployees: number) {
  const today = startOfDay(new Date());

  const [arrived, inside, late, worked, todaysRecords, onLeaveIds] = await Promise.all([
    prisma.attendance.count({
      where: { organizationId, date: today, deletedAt: null, checkInAt: { not: null } },
    }),
    prisma.attendance.count({
      where: { organizationId, date: today, deletedAt: null, checkInAt: { not: null }, checkOutAt: null },
    }),
    prisma.attendance.count({ where: { organizationId, date: today, deletedAt: null, isLate: true } }),
    prisma.attendance.aggregate({
      where: { organizationId, date: today, deletedAt: null, workedMinutes: { not: null } },
      _sum: { workedMinutes: true },
    }),
    prisma.attendance.findMany({
      where: { organizationId, date: today, deletedAt: null, workedMinutes: { not: null } },
      select: { workedMinutes: true, employee: { select: { shift: { select: { workingHoursPerDay: true } } } } },
    }),
    getEmployeeIdsOnApprovedLeave(organizationId, today),
  ]);

  const overtimeMinutes = todaysRecords.reduce((sum, record) => {
    const workingHoursPerDay = record.employee.shift?.workingHoursPerDay;
    if (!workingHoursPerDay || !record.workedMinutes) return sum;
    return sum + Math.max(0, record.workedMinutes - workingHoursPerDay * 60);
  }, 0);

  const onLeave = onLeaveIds.size;

  return {
    arrived,
    absent: Math.max(0, activeEmployees - arrived - onLeave),
    onLeave,
    inside,
    late,
    workedHours: Math.round(((worked._sum.workedMinutes ?? 0) / 60) * 10) / 10,
    overtimeMinutes,
  };
}

const RANGE_CONFIG: Record<AttendanceRange, { buckets: number; stepDays: number; label: (d: Date) => string }> = {
  daily: { buckets: 14, stepDays: 1, label: (d) => d.toISOString().slice(0, 10) },
  weekly: { buckets: 12, stepDays: 7, label: (d) => d.toISOString().slice(0, 10) },
  monthly: {
    buckets: 12,
    stepDays: 30,
    label: (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
  },
  yearly: { buckets: 5, stepDays: 365, label: (d) => String(d.getUTCFullYear()) },
};

function bucketKeyForRange(range: AttendanceRange, date: Date): string {
  if (range === "monthly") return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  if (range === "yearly") return String(date.getUTCFullYear());
  return date.toISOString().slice(0, 10);
}

async function getAttendanceSeries(organizationId: string, range: AttendanceRange) {
  const config = RANGE_CONFIG[range];

  if (range === "monthly" || range === "yearly") {
    // Calendar-aligned buckets (months/years vary in length) — build bucket boundaries explicitly.
    const buckets: { key: string; start: Date }[] = [];
    const now = new Date();
    for (let i = config.buckets - 1; i >= 0; i--) {
      const start =
        range === "monthly"
          ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
          : new Date(Date.UTC(now.getUTCFullYear() - i, 0, 1));
      buckets.push({ key: bucketKeyForRange(range, start), start });
    }

    const earliest = buckets[0].start;
    const rows = await prisma.attendance.findMany({
      where: { organizationId, date: { gte: earliest }, deletedAt: null, checkInAt: { not: null } },
      select: { date: true },
    });

    const counts = new Map(buckets.map((b) => [b.key, 0]));
    for (const row of rows) {
      const key = bucketKeyForRange(range, row.date);
      if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return buckets.map((b) => ({ label: b.key, count: counts.get(b.key) ?? 0 }));
  }

  // daily / weekly: fixed-size buckets
  const start = startOfDay(new Date(Date.now() - (config.buckets * config.stepDays - 1) * 86_400_000));

  const rows = await prisma.attendance.findMany({
    where: { organizationId, date: { gte: start }, deletedAt: null, checkInAt: { not: null } },
    select: { date: true },
  });

  const buckets: { label: string; startMs: number }[] = [];
  for (let i = 0; i < config.buckets; i++) {
    const bucketStart = new Date(start.getTime() + i * config.stepDays * 86_400_000);
    buckets.push({ label: config.label(bucketStart), startMs: bucketStart.getTime() });
  }

  const counts = new Array(config.buckets).fill(0);
  for (const row of rows) {
    const offsetMs = row.date.getTime() - start.getTime();
    const index = Math.floor(offsetMs / (config.stepDays * 86_400_000));
    if (index >= 0 && index < config.buckets) counts[index] += 1;
  }

  return buckets.map((b, i) => ({ label: b.label, count: counts[i] }));
}

export async function getOrgDashboardStats(organizationId: string, range: AttendanceRange = "daily"): Promise<OrgDashboardStats> {
  const [totalEmployees, activeEmployees, totalDepartments, onlineDevices, offlineDevices] = await Promise.all([
    prisma.employee.count({ where: { organizationId, deletedAt: null } }),
    prisma.employee.count({ where: { organizationId, deletedAt: null, status: "ACTIVE" } }),
    prisma.department.count({ where: { organizationId, deletedAt: null } }),
    prisma.device.count({ where: { organizationId, deletedAt: null, status: "ONLINE" } }),
    prisma.device.count({ where: { organizationId, deletedAt: null, status: "OFFLINE" } }),
  ]);

  const [attendanceToday, attendanceSeries] = await Promise.all([
    getAttendanceToday(organizationId, activeEmployees),
    getAttendanceSeries(organizationId, range),
  ]);

  return { totalEmployees, activeEmployees, totalDepartments, onlineDevices, offlineDevices, attendanceToday, attendanceSeries };
}
