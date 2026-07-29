import { prisma } from "../../config/prisma";
import { ApiError } from "../../common/api-error";
import { CreateHolidayDto } from "./holiday.dto";

export async function createHoliday(organizationId: string, dto: CreateHolidayDto) {
  return prisma.holiday.create({ data: { organizationId, name: dto.name, date: new Date(dto.date) } });
}

export async function listHolidays(organizationId: string, year?: number) {
  return prisma.holiday.findMany({
    where: {
      organizationId,
      deletedAt: null,
      ...(year ? { date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } } : {}),
    },
    orderBy: { date: "asc" },
  });
}

export async function deleteHoliday(organizationId: string, id: string) {
  const holiday = await prisma.holiday.findFirst({ where: { id, organizationId, deletedAt: null } });
  if (!holiday) {
    throw ApiError.notFound("Holiday not found");
  }
  await prisma.holiday.update({ where: { id }, data: { deletedAt: new Date() } });
}
