import { prisma } from "../../config/prisma";

export async function getCalendar(organizationId: string, month: number, year: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));

  const [holidays, leaves, attendanceRows] = await Promise.all([
    prisma.holiday.findMany({ where: { organizationId, deletedAt: null, date: { gte: start, lt: end } } }),
    prisma.leave.findMany({
      where: { organizationId, deletedAt: null, status: "APPROVED", startDate: { lt: end }, endDate: { gte: start } },
      include: { employee: { select: { id: true, fullName: true } } },
    }),
    prisma.attendance.groupBy({
      by: ["date"],
      where: { organizationId, deletedAt: null, date: { gte: start, lt: end }, checkInAt: { not: null } },
      _count: true,
    }),
  ]);

  return {
    holidays: holidays.map((h) => ({ id: h.id, name: h.name, date: h.date.toISOString().slice(0, 10) })),
    leaves: leaves.map((l) => ({
      id: l.id,
      employeeName: l.employee.fullName,
      type: l.type,
      startDate: l.startDate.toISOString().slice(0, 10),
      endDate: l.endDate.toISOString().slice(0, 10),
    })),
    attendanceByDate: attendanceRows.map((row) => ({ date: row.date.toISOString().slice(0, 10), count: row._count })),
  };
}
