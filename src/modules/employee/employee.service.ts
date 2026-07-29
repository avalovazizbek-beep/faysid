import bcrypt from "bcrypt";
import { EmployeeStatus, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { ApiError } from "../../common/api-error";
import { buildPagination, parsePagination } from "../../common/api-response";
import { parseCsv, toCsv } from "../../common/csv";
import { CreateEmployeeDto, ListEmployeesQuery, UpdateEmployeeDto } from "./employee.dto";

const includeRelations = {
  department: { select: { id: true, name: true } },
  shift: { select: { id: true, name: true, startTime: true, endTime: true } },
} satisfies Prisma.EmployeeInclude;

type EmployeeWithRelations = Prisma.EmployeeGetPayload<{ include: typeof includeRelations }>;

function sanitizeEmployee<T extends EmployeeWithRelations>(employee: T) {
  const { pinCodeHash, ...rest } = employee;
  return { ...rest, hasPinCode: pinCodeHash !== null };
}

async function assertDepartmentBelongsToOrg(organizationId: string, departmentId: string) {
  const department = await prisma.department.findFirst({ where: { id: departmentId, organizationId, deletedAt: null } });
  if (!department) {
    throw ApiError.badRequest("Selected department does not belong to this organization");
  }
}

async function assertShiftBelongsToOrg(organizationId: string, shiftId: string) {
  const shift = await prisma.shift.findFirst({ where: { id: shiftId, organizationId, deletedAt: null } });
  if (!shift) {
    throw ApiError.badRequest("Selected shift does not belong to this organization");
  }
}

export async function createEmployee(organizationId: string, dto: CreateEmployeeDto, photoUrl?: string) {
  const existing = await prisma.employee.findFirst({
    where: { organizationId, employeeCode: dto.employeeCode, deletedAt: null },
  });
  if (existing) {
    throw ApiError.conflict(`Employee code "${dto.employeeCode}" already exists`);
  }

  if (dto.departmentId) await assertDepartmentBelongsToOrg(organizationId, dto.departmentId);
  if (dto.shiftId) await assertShiftBelongsToOrg(organizationId, dto.shiftId);

  const { pinCode, ...rest } = dto;

  const employee = await prisma.employee.create({
    data: {
      organizationId,
      ...rest,
      photoUrl,
      ...(pinCode ? { pinCodeHash: await bcrypt.hash(pinCode, 10) } : {}),
    },
    include: includeRelations,
  });
  return sanitizeEmployee(employee);
}

export async function listEmployees(organizationId: string, query: ListEmployeesQuery) {
  const { page, limit, skip } = parsePagination(query);

  const where: Prisma.EmployeeWhereInput = {
    organizationId,
    deletedAt: null,
    ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { fullName: { contains: query.search } },
            { employeeCode: { contains: query.search } },
            { phone: { contains: query.search } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.employee.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: includeRelations,
    }),
    prisma.employee.count({ where }),
  ]);

  return { items: items.map(sanitizeEmployee), pagination: buildPagination(page, limit, total) };
}

async function getOwnedEmployee(organizationId: string, id: string) {
  const employee = await prisma.employee.findFirst({
    where: { id, organizationId, deletedAt: null },
    include: includeRelations,
  });
  if (!employee) {
    throw ApiError.notFound("Employee not found");
  }
  return sanitizeEmployee(employee);
}

export const getEmployeeById = getOwnedEmployee;

export async function updateEmployee(organizationId: string, id: string, dto: UpdateEmployeeDto, photoUrl?: string) {
  await getOwnedEmployee(organizationId, id);

  if (dto.departmentId) await assertDepartmentBelongsToOrg(organizationId, dto.departmentId);
  if (dto.shiftId) await assertShiftBelongsToOrg(organizationId, dto.shiftId);

  const { pinCode, ...rest } = dto;

  const employee = await prisma.employee.update({
    where: { id },
    data: {
      ...rest,
      ...(photoUrl ? { photoUrl } : {}),
      ...(pinCode ? { pinCodeHash: await bcrypt.hash(pinCode, 10) } : {}),
    },
    include: includeRelations,
  });
  return sanitizeEmployee(employee);
}

export async function deleteEmployee(organizationId: string, id: string) {
  await getOwnedEmployee(organizationId, id);
  await prisma.employee.update({ where: { id }, data: { deletedAt: new Date() } });
}

const CSV_HEADER = [
  "employeeCode",
  "fullName",
  "phone",
  "passportNumber",
  "jshshir",
  "position",
  "department",
  "shift",
  "salary",
  "status",
];

export async function exportEmployeesToCsv(organizationId: string): Promise<string> {
  const employees = await prisma.employee.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: { createdAt: "asc" },
    include: includeRelations,
  });

  const rows = employees.map((emp) => [
    emp.employeeCode,
    emp.fullName,
    emp.phone,
    emp.passportNumber,
    emp.jshshir,
    emp.position,
    emp.department?.name,
    emp.shift?.name,
    emp.salary?.toString(),
    emp.status,
  ]);

  return toCsv([CSV_HEADER, ...rows]);
}

export interface ImportRowResult {
  row: number;
  employeeCode: string;
  status: "created" | "error";
  message?: string;
}

export async function importEmployeesFromCsv(organizationId: string, csvText: string): Promise<ImportRowResult[]> {
  const rows = parseCsv(csvText);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim());
  const columnIndex = (name: string) => header.indexOf(name);

  const [departments, shifts] = await Promise.all([
    prisma.department.findMany({ where: { organizationId, deletedAt: null } }),
    prisma.shift.findMany({ where: { organizationId, deletedAt: null } }),
  ]);
  const departmentByName = new Map(departments.map((d) => [d.name.toLowerCase(), d.id]));
  const shiftByName = new Map(shifts.map((s) => [s.name.toLowerCase(), s.id]));

  const results: ImportRowResult[] = [];

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    const get = (name: string) => {
      const idx = columnIndex(name);
      return idx >= 0 ? (cells[idx] ?? "").trim() : "";
    };

    const employeeCode = get("employeeCode");
    const fullName = get("fullName");

    try {
      if (!employeeCode || !fullName) {
        throw new Error("employeeCode va fullName majburiy");
      }

      const existing = await prisma.employee.findFirst({
        where: { organizationId, employeeCode, deletedAt: null },
      });
      if (existing) {
        throw new Error(`Employee code "${employeeCode}" allaqachon mavjud`);
      }

      const departmentName = get("department");
      const shiftName = get("shift");
      const salaryRaw = get("salary");
      const statusRaw = get("status").toUpperCase();

      await prisma.employee.create({
        data: {
          organizationId,
          employeeCode,
          fullName,
          phone: get("phone") || undefined,
          passportNumber: get("passportNumber") || undefined,
          jshshir: get("jshshir") || undefined,
          position: get("position") || undefined,
          departmentId: departmentName ? departmentByName.get(departmentName.toLowerCase()) : undefined,
          shiftId: shiftName ? shiftByName.get(shiftName.toLowerCase()) : undefined,
          salary: salaryRaw ? Number(salaryRaw) : undefined,
          status: statusRaw === "INACTIVE" ? EmployeeStatus.INACTIVE : EmployeeStatus.ACTIVE,
        },
      });

      results.push({ row: i + 1, employeeCode, status: "created" });
    } catch (error) {
      results.push({
        row: i + 1,
        employeeCode: employeeCode || "?",
        status: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return results;
}
