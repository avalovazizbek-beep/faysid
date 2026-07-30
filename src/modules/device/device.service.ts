import { connect } from "node:net";
import { Device } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { ApiError } from "../../common/api-error";
import { recordAuditLog } from "../../common/audit-log";
import { logger } from "../../config/logger";
import { encryptSecret, decryptSecret } from "../../common/secret-crypto";
import { CreateDeviceDto, UpdateDeviceDto } from "./device.dto";
import * as isapi from "./hikvision-isapi";

/** Never return the encrypted password; expose only whether one is configured. */
function sanitizeDevice<T extends Partial<Device>>(device: T): Omit<T, "isapiPasswordEnc"> & { hasIsapiCredentials: boolean } {
  const { isapiPasswordEnc, ...rest } = device;
  return { ...rest, hasIsapiCredentials: Boolean(isapiPasswordEnc && device.isapiUsername) };
}

function isapiTarget(device: Device): isapi.HikvisionDeviceTarget | null {
  if (device.vendor !== "HIKVISION" || !device.isapiUsername || !device.isapiPasswordEnc) return null;
  return {
    ipAddress: device.ipAddress,
    port: device.port,
    isapiUsername: device.isapiUsername,
    isapiPassword: decryptSecret(device.isapiPasswordEnc),
  };
}

function toPrismaData<T extends { isapiPassword?: string }>(
  dto: T,
): Omit<T, "isapiPassword"> & { isapiPasswordEnc?: string } {
  const { isapiPassword, ...rest } = dto;
  return {
    ...rest,
    ...(isapiPassword ? { isapiPasswordEnc: encryptSecret(isapiPassword) } : {}),
  };
}

export async function createDevice(organizationId: string, dto: CreateDeviceDto) {
  const device = await prisma.device.create({ data: { organizationId, ...toPrismaData(dto) } });
  return sanitizeDevice(device);
}

export async function listDevices(organizationId: string) {
  const devices = await prisma.device.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { employeeSyncs: true } } },
  });
  return devices.map(sanitizeDevice);
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
  const device = await prisma.device.update({ where: { id }, data: toPrismaData(dto) });
  return sanitizeDevice(device);
}

export async function deleteDevice(organizationId: string, id: string) {
  await getOwnedDevice(organizationId, id);
  await prisma.device.update({ where: { id }, data: { deletedAt: new Date() } });
}

export async function heartbeat(organizationId: string, id: string) {
  await getOwnedDevice(organizationId, id);
  const device = await prisma.device.update({ where: { id }, data: { status: "ONLINE", lastSeenAt: new Date() } });
  return sanitizeDevice(device);
}

/**
 * Reconnect/status check. When ISAPI credentials are configured, this is a
 * real authenticated HTTP call to the device (proves the full network path +
 * login work, not just that a TCP port is open). Otherwise falls back to the
 * previous raw-TCP reachability check.
 */
export async function reconnect(organizationId: string, id: string) {
  const device = await getOwnedDevice(organizationId, id);
  const target = isapiTarget(device);

  let reachable: boolean;
  if (target) {
    try {
      await isapi.fetchDeviceInfo(target);
      reachable = true;
    } catch (error) {
      logger.warn(`Hikvision reconnect check failed for device ${id}: ${error}`);
      reachable = false;
    }
  } else {
    reachable = await new Promise<boolean>((resolve) => {
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
  }

  const updated = await prisma.device.update({
    where: { id },
    data: reachable ? { status: "ONLINE", lastSeenAt: new Date() } : { status: "OFFLINE" },
  });
  return sanitizeDevice(updated);
}

/** Simulated — no vendor SDK available to actually restart hardware. */
export async function restart(organizationId: string, id: string, actorUserId?: string) {
  const device = await getOwnedDevice(organizationId, id);
  const target = isapiTarget(device);

  if (!target) {
    await recordAuditLog({
      organizationId,
      userId: actorUserId,
      action: "DEVICE_RESTART_REQUESTED",
      entityType: "Device",
      entityId: id,
      metadata: { simulated: true },
    });
    return {
      simulated: true,
      message: "ISAPI login/parol sozlanmagan — bu amal simulyatsiya qilindi. Qurilmaga ISAPI login/parol kiriting.",
    };
  }

  try {
    await isapi.rebootDevice(target);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn(`Device restart failed for device ${id}: ${errorMessage}`);
    throw new ApiError(502, `Qurilmaga ulanib bo'lmadi: ${errorMessage}`);
  }

  await recordAuditLog({
    organizationId,
    userId: actorUserId,
    action: "DEVICE_RESTART_REQUESTED",
    entityType: "Device",
    entityId: id,
    metadata: { simulated: false },
  });
  return {
    simulated: false,
    message: "Qurilmaga real qayta ishga tushirish buyrug'i yuborildi.",
  };
}

function eligibleEmployeesWhere(organizationId: string) {
  return {
    organizationId,
    deletedAt: null,
    status: "ACTIVE" as const,
    OR: [{ photoUrl: { not: null } }, { cardNumber: { not: null } }, { pinCodeHash: { not: null } }],
  };
}

/**
 * Pushes Face(photo)/Card data to the device. Real over ISAPI when the device
 * has isapiUsername/isapiPassword configured (Hikvision); otherwise falls
 * back to the previous simulated behavior (no vendor SDK/credentials to act on).
 */
export async function sync(organizationId: string, id: string) {
  const device = await getOwnedDevice(organizationId, id);
  const target = isapiTarget(device);

  const employees = await prisma.employee.findMany({
    where: eligibleEmployeesWhere(organizationId),
    select: { id: true, employeeCode: true, fullName: true, cardNumber: true, photoUrl: true },
  });

  if (!target) {
    const results = await Promise.all(
      employees.map((employee) =>
        prisma.deviceEmployeeSync.upsert({
          where: { deviceId_employeeId: { deviceId: device.id, employeeId: employee.id } },
          create: { deviceId: device.id, employeeId: employee.id, status: "SYNCED", syncedAt: new Date() },
          update: { status: "SYNCED", syncedAt: new Date(), errorMessage: null },
        }),
      ),
    );
    await recordAuditLog({ organizationId, action: "DEVICE_SYNC", entityType: "Device", entityId: id, metadata: { employeeCount: results.length, simulated: true } });
    return {
      simulated: true,
      message: "ISAPI login/parol sozlanmagan — sinxronizatsiya simulyatsiya qilindi. Qurilmaning haqiqiy admin login/parolini kiriting.",
      syncedCount: results.length,
    };
  }

  let succeeded = 0;
  let failed = 0;
  for (const employee of employees) {
    try {
      await isapi.enrollEmployee(target, {
        employeeCode: employee.employeeCode,
        fullName: employee.fullName,
        cardNumber: employee.cardNumber,
        photoUrl: employee.photoUrl,
      });
      await prisma.deviceEmployeeSync.upsert({
        where: { deviceId_employeeId: { deviceId: device.id, employeeId: employee.id } },
        create: { deviceId: device.id, employeeId: employee.id, status: "SYNCED", syncedAt: new Date() },
        update: { status: "SYNCED", syncedAt: new Date(), errorMessage: null },
      });
      succeeded += 1;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`Hikvision sync failed for employee ${employee.id} on device ${id}: ${errorMessage}`);
      await prisma.deviceEmployeeSync.upsert({
        where: { deviceId_employeeId: { deviceId: device.id, employeeId: employee.id } },
        create: { deviceId: device.id, employeeId: employee.id, status: "FAILED", errorMessage: errorMessage.slice(0, 1000) },
        update: { status: "FAILED", errorMessage: errorMessage.slice(0, 1000) },
      });
      failed += 1;
    }
  }

  await recordAuditLog({
    organizationId,
    action: "DEVICE_SYNC",
    entityType: "Device",
    entityId: id,
    metadata: { employeeCount: employees.length, succeeded, failed, simulated: false },
  });

  return {
    simulated: false,
    message: `Haqiqiy ISAPI sinxronizatsiya yakunlandi: ${succeeded} muvaffaqiyatli, ${failed} xato.`,
    syncedCount: succeeded,
    failedCount: failed,
  };
}

/**
 * Pushes one employee to every ISAPI-credentialed Hikvision device in the
 * organization — the "bind to device" action for when you just added/edited
 * one employee and don't want to resync everyone. The device's Person ID
 * ends up equal to employeeCode (see hikvision-isapi.enrollEmployee), which
 * is also the key the webhook matches incoming events against — so once
 * pushed, showing this employee's face at the device produces a real
 * attendance event with no separate device-side employee management needed.
 */
export async function pushEmployeeToDevices(organizationId: string, employeeId: string) {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, organizationId, deletedAt: null } });
  if (!employee) {
    throw ApiError.notFound("Employee not found");
  }

  const devices = await prisma.device.findMany({
    where: { organizationId, deletedAt: null, vendor: "HIKVISION", isapiUsername: { not: null }, isapiPasswordEnc: { not: null } },
  });

  if (devices.length === 0) {
    return {
      pushed: 0,
      results: [],
      message: "ISAPI login/parol sozlangan Hikvision qurilma topilmadi. Avval 'Qurilmalar' sahifasida qurilmaga ISAPI login/parol kiriting.",
    };
  }

  const results: { deviceId: string; deviceName: string; success: boolean; error?: string }[] = [];
  for (const device of devices) {
    const target = isapiTarget(device);
    if (!target) continue;
    try {
      await isapi.enrollEmployee(target, {
        employeeCode: employee.employeeCode,
        fullName: employee.fullName,
        cardNumber: employee.cardNumber,
        photoUrl: employee.photoUrl,
      });
      await prisma.deviceEmployeeSync.upsert({
        where: { deviceId_employeeId: { deviceId: device.id, employeeId } },
        create: { deviceId: device.id, employeeId, status: "SYNCED", syncedAt: new Date() },
        update: { status: "SYNCED", syncedAt: new Date(), errorMessage: null },
      });
      results.push({ deviceId: device.id, deviceName: device.name, success: true });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`Push-to-device failed for employee ${employeeId} on device ${device.id}: ${errorMessage}`);
      await prisma.deviceEmployeeSync.upsert({
        where: { deviceId_employeeId: { deviceId: device.id, employeeId } },
        create: { deviceId: device.id, employeeId, status: "FAILED", errorMessage: errorMessage.slice(0, 1000) },
        update: { status: "FAILED", errorMessage: errorMessage.slice(0, 1000) },
      });
      results.push({ deviceId: device.id, deviceName: device.name, success: false, error: errorMessage.slice(0, 500) });
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  await recordAuditLog({
    organizationId,
    action: "DEVICE_EMPLOYEE_PUSH",
    entityType: "Employee",
    entityId: employeeId,
    metadata: { deviceCount: devices.length, succeeded },
  });

  return {
    pushed: succeeded,
    results,
    message: `${succeeded}/${devices.length} qurilmaga muvaffaqiyatli yuborildi.`,
  };
}

/**
 * Reads the device's own enrolled person list and reconciles it against
 * FaceHub employees by employeeCode (== the device's Person ID convention),
 * so an admin can see at a glance which device-side people already have a
 * matching site employee and which don't — no bulk "import" is needed since
 * the site is meant to stay the source of truth.
 */
export async function listDeviceUsers(organizationId: string, deviceId: string) {
  const device = await getOwnedDevice(organizationId, deviceId);
  const target = isapiTarget(device);
  if (!target) {
    throw ApiError.badRequest("Bu qurilmada ISAPI login/parol sozlanmagan");
  }

  let deviceUsers: isapi.HikvisionDeviceUser[];
  try {
    deviceUsers = await isapi.searchDeviceUsers(target);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn(`listDeviceUsers failed for device ${deviceId}: ${errorMessage}`);
    throw new ApiError(502, `Qurilmaga ulanib bo'lmadi: ${errorMessage}`);
  }

  const employees = await prisma.employee.findMany({
    where: { organizationId, deletedAt: null, employeeCode: { in: deviceUsers.map((u) => u.personId) } },
    select: { id: true, employeeCode: true, fullName: true },
  });
  const employeeByCode = new Map(employees.map((e) => [e.employeeCode, e]));

  return deviceUsers.map((u) => ({
    personId: u.personId,
    deviceName: u.name,
    matchedEmployee: employeeByCode.get(u.personId) ?? null,
  }));
}

export async function listDeviceSyncs(organizationId: string, deviceId: string) {
  await getOwnedDevice(organizationId, deviceId);
  return prisma.deviceEmployeeSync.findMany({
    where: { deviceId },
    include: { employee: { select: { id: true, fullName: true, employeeCode: true } } },
    orderBy: { updatedAt: "desc" },
  });
}

/** Real list for the desktop bridge to push over ISAPI — same eligibility as sync() above. */
export async function listEmployeesToSync(organizationId: string, deviceId: string) {
  await getOwnedDevice(organizationId, deviceId);

  return prisma.employee.findMany({
    where: eligibleEmployeesWhere(organizationId),
    select: { id: true, employeeCode: true, fullName: true, cardNumber: true, photoUrl: true },
  });
}

/** Records the real outcome of a desktop-bridge push for one employee. */
export async function ackEmployeeSync(
  organizationId: string,
  deviceId: string,
  employeeId: string,
  status: "SYNCED" | "FAILED",
  errorMessage?: string,
) {
  const device = await getOwnedDevice(organizationId, deviceId);
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, organizationId, deletedAt: null } });
  if (!employee) {
    throw ApiError.notFound("Employee not found");
  }

  return prisma.deviceEmployeeSync.upsert({
    where: { deviceId_employeeId: { deviceId: device.id, employeeId } },
    create: { deviceId: device.id, employeeId, status, syncedAt: status === "SYNCED" ? new Date() : null, errorMessage },
    update: { status, syncedAt: status === "SYNCED" ? new Date() : null, errorMessage: errorMessage ?? null },
  });
}
