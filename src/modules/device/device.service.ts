import { connect } from "node:net";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Device } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { ApiError } from "../../common/api-error";
import { recordAuditLog } from "../../common/audit-log";
import { logger } from "../../config/logger";
import { encryptSecret, decryptSecret } from "../../common/secret-crypto";
import { CreateDeviceDto, UpdateDeviceDto } from "./device.dto";
import * as isapi from "./hikvision-isapi";
import * as hikConnect from "../hikconnect/hikconnect-api";
import { getHikConnectCredentials } from "../platform-settings/platform-settings.service";
import { createEmployee } from "../employee/employee.service";

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

/**
 * Preferred path when set — reaches the device through Hik-Connect's cloud
 * proxypass instead of direct ISAPI, so it works regardless of CGNAT/
 * port-forwarding. Falls back to isapiTarget() (direct LAN ISAPI) when unset.
 */
async function hikConnectTarget(device: Device): Promise<{ credentials: hikConnect.HikConnectCredentials; deviceId: string } | null> {
  if (device.vendor !== "HIKVISION" || !device.hikConnectDeviceId) return null;
  const credentials = await getHikConnectCredentials();
  if (!credentials) return null;
  return { credentials, deviceId: device.hikConnectDeviceId };
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
 * Reconnect/status check. Prefers Hik-Connect cloud proxypass when the device
 * is bound to one (works regardless of network topology), then falls back to
 * direct ISAPI when credentials are configured (a real authenticated HTTP
 * call, proving the full network path + login work, not just that a TCP port
 * is open), then to a raw-TCP reachability check.
 */
export async function reconnect(organizationId: string, id: string) {
  const device = await getOwnedDevice(organizationId, id);
  const hc = await hikConnectTarget(device);
  const target = isapiTarget(device);

  let reachable: boolean;
  if (hc) {
    try {
      await hikConnect.fetchDeviceInfo(hc.credentials, hc.deviceId);
      reachable = true;
    } catch (error) {
      logger.warn(`Hik-Connect reconnect check failed for device ${id}: ${error}`);
      reachable = false;
    }
  } else if (target) {
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

/** Real remote reboot via Hik-Connect proxypass or direct ISAPI; simulated only when neither is configured. */
export async function restart(organizationId: string, id: string, actorUserId?: string) {
  const device = await getOwnedDevice(organizationId, id);
  const hc = await hikConnectTarget(device);
  const target = isapiTarget(device);

  if (!hc && !target) {
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
      message: "Hik-Connect yoki ISAPI login/parol sozlanmagan — bu amal simulyatsiya qilindi.",
    };
  }

  try {
    if (hc) {
      await hikConnect.rebootDevice(hc.credentials, hc.deviceId);
    } else if (target) {
      await isapi.rebootDevice(target);
    }
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

type EnrollableEmployee = { id: string; employeeCode: string; fullName: string; cardNumber: string | null; photoUrl: string | null };
type DeviceReachability = {
  hc: { credentials: hikConnect.HikConnectCredentials; deviceId: string } | null;
  target: isapi.HikvisionDeviceTarget | null;
};

/**
 * Enrolls one employee on one device (Hik-Connect proxypass preferred, else
 * direct ISAPI) and records the real outcome on DeviceEmployeeSync — the
 * shared core of sync() (all employees -> one device), pushEmployeeToDevices()
 * (one employee -> every device), and pushEmployeeToDevice() (one -> one).
 */
async function enrollAndRecordSync(
  device: Device,
  { hc, target }: DeviceReachability,
  employee: EnrollableEmployee,
): Promise<{ success: boolean; error?: string }> {
  try {
    const payload = {
      employeeCode: employee.employeeCode,
      fullName: employee.fullName,
      cardNumber: employee.cardNumber,
      photoUrl: employee.photoUrl,
    };
    if (hc) {
      await hikConnect.enrollEmployee(hc.credentials, hc.deviceId, payload);
    } else if (target) {
      await isapi.enrollEmployee(target, payload);
    }
    await prisma.deviceEmployeeSync.upsert({
      where: { deviceId_employeeId: { deviceId: device.id, employeeId: employee.id } },
      create: { deviceId: device.id, employeeId: employee.id, status: "SYNCED", syncedAt: new Date() },
      update: { status: "SYNCED", syncedAt: new Date(), errorMessage: null },
    });
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn(`Enroll failed for employee ${employee.id} on device ${device.id}: ${errorMessage}`);
    await prisma.deviceEmployeeSync.upsert({
      where: { deviceId_employeeId: { deviceId: device.id, employeeId: employee.id } },
      create: { deviceId: device.id, employeeId: employee.id, status: "FAILED", errorMessage: errorMessage.slice(0, 1000) },
      update: { status: "FAILED", errorMessage: errorMessage.slice(0, 1000) },
    });
    return { success: false, error: errorMessage.slice(0, 500) };
  }
}

/**
 * Pushes Face(photo)/Card data to the device. Real over Hik-Connect proxypass
 * when the device is bound to one, else real over direct ISAPI when
 * isapiUsername/isapiPassword is configured; otherwise falls back to the
 * previous simulated behavior (no vendor SDK/credentials to act on).
 */
export async function sync(organizationId: string, id: string) {
  const device = await getOwnedDevice(organizationId, id);
  const hc = await hikConnectTarget(device);
  const target = isapiTarget(device);

  const employees = await prisma.employee.findMany({
    where: eligibleEmployeesWhere(organizationId),
    select: { id: true, employeeCode: true, fullName: true, cardNumber: true, photoUrl: true },
  });

  if (!hc && !target) {
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
      message: "Hik-Connect yoki ISAPI login/parol sozlanmagan — sinxronizatsiya simulyatsiya qilindi.",
      syncedCount: results.length,
    };
  }

  let succeeded = 0;
  let failed = 0;
  for (const employee of employees) {
    const result = await enrollAndRecordSync(device, { hc, target }, employee);
    if (result.success) succeeded += 1;
    else failed += 1;
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
    message: `Haqiqiy sinxronizatsiya yakunlandi: ${succeeded} muvaffaqiyatli, ${failed} xato.`,
    syncedCount: succeeded,
    failedCount: failed,
  };
}

/**
 * Pushes one employee to every Hik-Connect-bound or ISAPI-credentialed
 * Hikvision device in the organization — the "bind to device" action for
 * when you just added/edited one employee and don't want to resync everyone.
 * The device's Person ID ends up equal to employeeCode (see enrollEmployee in
 * hikvision-isapi.ts/hikconnect-api.ts), which is also the key the webhook
 * matches incoming events against — so once pushed, showing this employee's
 * face at the device produces a real attendance event with no separate
 * device-side employee management needed.
 */
export async function pushEmployeeToDevices(organizationId: string, employeeId: string) {
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, organizationId, deletedAt: null } });
  if (!employee) {
    throw ApiError.notFound("Employee not found");
  }

  const devices = await prisma.device.findMany({
    where: {
      organizationId,
      deletedAt: null,
      vendor: "HIKVISION",
      OR: [{ hikConnectDeviceId: { not: null } }, { isapiUsername: { not: null }, isapiPasswordEnc: { not: null } }],
    },
  });

  if (devices.length === 0) {
    return {
      pushed: 0,
      results: [],
      message: "Hik-Connect yoki ISAPI login/parol sozlangan Hikvision qurilma topilmadi. Avval 'Qurilmalar' sahifasida qurilmani ulang.",
    };
  }

  const results: { deviceId: string; deviceName: string; success: boolean; error?: string }[] = [];
  for (const device of devices) {
    const hc = await hikConnectTarget(device);
    const target = isapiTarget(device);
    if (!hc && !target) continue;
    const result = await enrollAndRecordSync(device, { hc, target }, employee);
    results.push({ deviceId: device.id, deviceName: device.name, success: result.success, error: result.error });
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
 * Pushes one employee to exactly one device — the "qurilma tanlab, xodim
 * qo'shish" action inside the device's own detail panel, as opposed to
 * pushEmployeeToDevices() which fans out to every device in the org.
 */
export async function pushEmployeeToDevice(organizationId: string, deviceId: string, employeeId: string) {
  const device = await getOwnedDevice(organizationId, deviceId);
  const employee = await prisma.employee.findFirst({ where: { id: employeeId, organizationId, deletedAt: null } });
  if (!employee) {
    throw ApiError.notFound("Employee not found");
  }

  const hc = await hikConnectTarget(device);
  const target = isapiTarget(device);
  if (!hc && !target) {
    throw ApiError.badRequest("Bu qurilmada Hik-Connect yoki ISAPI login/parol sozlanmagan");
  }

  const result = await enrollAndRecordSync(device, { hc, target }, employee);
  await recordAuditLog({
    organizationId,
    action: "DEVICE_EMPLOYEE_PUSH",
    entityType: "Employee",
    entityId: employeeId,
    metadata: { deviceId, success: result.success },
  });

  if (!result.success) {
    throw new ApiError(502, `Qurilmaga yuborilmadi: ${result.error}`);
  }
  return { success: true, message: `${employee.fullName} "${device.name}" qurilmasiga muvaffaqiyatli yuborildi.` };
}

/**
 * Recent attendance for the employees actually synced to this device
 * (DeviceEmployeeSync) — the "davomat" section of the device's detail panel,
 * so an admin can see this specific terminal's people's attendance without
 * leaving the Devices page.
 */
export async function listDeviceAttendance(organizationId: string, deviceId: string) {
  await getOwnedDevice(organizationId, deviceId);

  const syncedEmployeeIds = await prisma.deviceEmployeeSync.findMany({
    where: { deviceId, status: "SYNCED" },
    select: { employeeId: true },
  });
  if (syncedEmployeeIds.length === 0) return [];

  return prisma.attendance.findMany({
    where: { organizationId, employeeId: { in: syncedEmployeeIds.map((s) => s.employeeId) }, deletedAt: null },
    orderBy: { date: "desc" },
    take: 50,
    include: { employee: { select: { id: true, fullName: true, employeeCode: true } } },
  });
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
  const hc = await hikConnectTarget(device);
  const target = isapiTarget(device);
  if (!hc && !target) {
    throw ApiError.badRequest("Bu qurilmada Hik-Connect yoki ISAPI login/parol sozlanmagan");
  }

  let deviceUsers: isapi.HikvisionDeviceUser[];
  try {
    deviceUsers = hc ? await hikConnect.searchDeviceUsers(hc.credentials, hc.deviceId) : await isapi.searchDeviceUsers(target!);
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

/**
 * Creates a bare FaceHub employee (employeeCode = the device's Person ID) for
 * a person that already exists on the device but has no matching site
 * record — the "pull" half of the reconciliation shown by listDeviceUsers().
 * Only employeeCode/fullName are known from the device; the admin fills in
 * department/position/etc. afterward via the normal employee edit form.
 */
export async function importDeviceUser(organizationId: string, deviceId: string, personId: string, name?: string) {
  const device = await getOwnedDevice(organizationId, deviceId);
  const target = isapiTarget(device);

  let photoUrl: string | undefined;
  if (target) {
    try {
      const photoBuffer = await isapi.fetchDevicePersonPhoto(target, personId);
      if (photoBuffer) {
        const dir = path.join(__dirname, "..", "..", "..", "uploads", "employees");
        mkdirSync(dir, { recursive: true });
        const filename = `${randomUUID()}.jpg`;
        writeFileSync(path.join(dir, filename), photoBuffer);
        photoUrl = `/uploads/employees/${filename}`;
      }
    } catch (error) {
      logger.warn(`Could not fetch device photo for person ${personId}: ${error}`);
    }
  }

  // createEmployee() itself checks for a duplicate employeeCode (including
  // ones used by a previously soft-deleted employee, which still block reuse
  // at the DB level) and throws a friendly ApiError — no need to duplicate
  // that check here.
  return createEmployee(organizationId, { employeeCode: personId, fullName: name?.trim() || personId }, photoUrl);
}

export async function listDeviceSyncs(organizationId: string, deviceId: string) {
  await getOwnedDevice(organizationId, deviceId);
  return prisma.deviceEmployeeSync.findMany({
    where: { deviceId },
    include: { employee: { select: { id: true, fullName: true, employeeCode: true } } },
    orderBy: { updatedAt: "desc" },
  });
}

/** Real list of employees eligible to be pushed to a device — same eligibility as sync() above. */
export async function listEmployeesToSync(organizationId: string, deviceId: string) {
  await getOwnedDevice(organizationId, deviceId);

  return prisma.employee.findMany({
    where: eligibleEmployeesWhere(organizationId),
    select: { id: true, employeeCode: true, fullName: true, cardNumber: true, photoUrl: true },
  });
}

/** Records the real outcome of pushing one employee to a device. */
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
