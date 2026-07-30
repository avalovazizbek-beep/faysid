import { prisma } from "../../config/prisma";
import { ApiError } from "../../common/api-error";
import { recordAuditLog } from "../../common/audit-log";
import { createEmployee } from "../employee/employee.service";
import { ListApplicationsQuery } from "./employee-application.dto";

export async function listApplications(organizationId: string, query: ListApplicationsQuery) {
  return prisma.employeeApplication.findMany({
    where: { organizationId, ...(query.status ? { status: query.status } : {}) },
    orderBy: { createdAt: "desc" },
  });
}

async function getOwnedApplication(organizationId: string, id: string) {
  const application = await prisma.employeeApplication.findFirst({ where: { id, organizationId } });
  if (!application) {
    throw ApiError.notFound("Application not found");
  }
  return application;
}

export async function approveApplication(
  organizationId: string,
  id: string,
  employeeCode: string,
  actorUserId?: string,
) {
  const application = await getOwnedApplication(organizationId, id);
  if (application.status !== "PENDING") {
    throw ApiError.conflict("Bu ariza allaqachon ko'rib chiqilgan");
  }

  const employee = await createEmployee(
    organizationId,
    { employeeCode, fullName: application.fullName, phone: application.phone ?? undefined },
    application.photoUrl ?? undefined,
  );

  await prisma.employeeApplication.update({
    where: { id },
    data: { status: "APPROVED", reviewedByUserId: actorUserId, reviewedAt: new Date() },
  });

  await recordAuditLog({
    organizationId,
    userId: actorUserId,
    action: "EMPLOYEE_APPLICATION_APPROVED",
    entityType: "Employee",
    entityId: employee.id,
    metadata: { applicationId: id },
  });

  return employee;
}

export async function rejectApplication(organizationId: string, id: string, actorUserId?: string) {
  const application = await getOwnedApplication(organizationId, id);
  if (application.status !== "PENDING") {
    throw ApiError.conflict("Bu ariza allaqachon ko'rib chiqilgan");
  }

  const updated = await prisma.employeeApplication.update({
    where: { id },
    data: { status: "REJECTED", reviewedByUserId: actorUserId, reviewedAt: new Date() },
  });

  await recordAuditLog({
    organizationId,
    userId: actorUserId,
    action: "EMPLOYEE_APPLICATION_REJECTED",
    entityType: "EmployeeApplication",
    entityId: id,
  });

  return updated;
}
