import { connect } from "node:net";
import { prisma } from "../../config/prisma";
import { ApiError } from "../../common/api-error";
import { recordAuditLog } from "../../common/audit-log";
import { CreateDeviceDto, UpdateDeviceDto } from "./device.dto";

export async function createDevice(organizationId: string, dto: CreateDeviceDto) {
  return prisma.device.create({ data: { organizationId, ...dto } });
}

export async function listDevices(organizationId: string) {
  return prisma.device.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { employeeSyncs: true } } },
  });
}

export async function getOwnedDevice(organizationId: string, id: string) {
  const device = await prisma.device.findFirst({ where: { id, organizationId, deletedAt: null } });
  if (!device) {
    throw ApiError.notFound("Device not found");
  }
  return device;
}

export async function updateDevice(organizationId: string, id: string, dto: UpdateDeviceDto) {
  await getOwnedDevice(organizationId, id);
  return prisma.device.update({ where: { id }, data: dto });
}

export async function deleteDevice(organizationId: string, id: string) {
  await getOwnedDevice(organizationId, id);
  await prisma.device.update({ where: { id }, data: { deletedAt: new Date() } });
}

export async function heartbeat(organizationId: string, id: string) {
  await getOwnedDevice(organizationId, id);
  return prisma.device.update({ where: { id }, data: { status: "ONLINE", lastSeenAt: new Date() } });
}

/** Real TCP reachability check — not simulated. Vendor protocol handshake itself is out of scope without an SDK. */
export async function reconnect(organizationId: string, id: string) {
  const device = await getOwnedDevice(organizationId, id);

  const reachable = await new Promise<boolean>((resolve) => {
    const socket = connect({ host: device.ipAddress, port: device.port, timeout: 2000 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });

  return prisma.device.update({
    where: { id },
    data: reachable ? { status: "ONLINE", lastSeenAt: new Date() } : { status: "OFFLINE" },
  });
}

/** Simulated — no vendor SDK available to actually restart hardware. */
export async function restart(organizationId: string, id: string, actorUserId?: string) {
  await getOwnedDevice(organizationId, id);

  await recordAuditLog({
    organizationId,
    userId: actorUserId,
    action: "DEVICE_RESTART_REQUESTED",
    entityType: "Device",
    entityId: id,
  });

  return {
    simulated: true,
    message: "Vendor SDK ulanmagan — bu amal hozircha simulyatsiya qilindi. Haqiqiy qurilma bilan ishlash uchun vendor SDK integratsiyasi kerak.",
  };
}

/** Simulated push of Face(photo)/Card/PIN to the device — there's no real hardware on the other end yet. */
export async function sync(organizationId: string, id: string) {
  const device = await getOwnedDevice(organizationId, id);

  const employees = await prisma.employee.findMany({
    where: {
      organizationId,
      deletedAt: null,
      status: "ACTIVE",
      OR: [{ photoUrl: { not: null } }, { cardNumber: { not: null } }, { pinCodeHash: { not: null } }],
    },
    select: { id: true },
  });

  const results = await Promise.all(
    employees.map((employee) =>
      prisma.deviceEmployeeSync.upsert({
        where: { deviceId_employeeId: { deviceId: device.id, employeeId: employee.id } },
        create: { deviceId: device.id, employeeId: employee.id, status: "SYNCED", syncedAt: new Date() },
        update: { status: "SYNCED", syncedAt: new Date(), errorMessage: null },
      }),
    ),
  );

  await recordAuditLog({ organizationId, action: "DEVICE_SYNC", entityType: "Device", entityId: id, metadata: { employeeCount: results.length } });

  return {
    simulated: true,
    message: "Haqiqiy vendor protokoli hali ulanmagan — sinxronizatsiya simulyatsiya qilindi (real qurilmada test qilinmagan).",
    syncedCount: results.length,
  };
}

export async function listDeviceSyncs(organizationId: string, deviceId: string) {
  await getOwnedDevice(organizationId, deviceId);
  return prisma.deviceEmployeeSync.findMany({
    where: { deviceId },
    include: { employee: { select: { id: true, fullName: true, employeeCode: true } } },
    orderBy: { updatedAt: "desc" },
  });
}
