import { randomBytes } from "node:crypto";
import { logger } from "../../config/logger";
import {
  formatIsapiTime,
  readPhotoBuffer,
  type HikvisionAttendanceEvent,
  type HikvisionDeviceUser,
  type HikvisionEmployee,
} from "../device/hikvision-isapi";

/**
 * Client for Hik-Connect for Teams OpenAPI (Developer Guide V2.15.0) — reaches
 * a Hikvision access-control terminal's own ISAPI directly through
 * Hikvision's cloud (`video/v1/isapi/proxypass`), regardless of CGNAT or
 * port-forwarding. Ported from a standalone bot (hikvistion/bot/hik_client.py)
 * that was run live against a real Hik-Connect for Teams account and
 * confirmed working: login, device listing, ISAPI UserInfo/Search, AcsEvent,
 * and certificaterecords/search all returned real data. Enrollment
 * (UserInfo/Record + CardInfo/Record) reuses the same proven proxypass JSON
 * envelope so it should work the same way — pushing a face photo
 * (FaceDataRecord, a multipart/binary body) through that envelope is NOT yet
 * confirmed against a real account; see enrollEmployee() below.
 */

export interface HikConnectCredentials {
  appKey: string;
  appSecret: string;
  /** One of REGIONS's keys, or undefined/null to try every region at login. */
  region?: string | null;
}

/** "Getting Started" section of the developer guide — regional gateway hosts. */
export const HIK_CONNECT_REGIONS: Record<string, string> = {
  russia: "https://hikcentralconnectru.com",
  singapore_india: "https://isgp.hikcentralconnect.com",
  europe: "https://ieu.hikcentralconnect.com",
  south_america: "https://isa.hikcentralconnect.com",
  north_america: "https://ius.hikcentralconnect.com",
};

const TOKEN_MAX_AGE_MS = 6 * 24 * 3600_000; // renew before the documented 7-day expiry
const ISAPI_TIMEOUT_MS = 30_000; // proxypass round-trips cloud -> device -> cloud, slower than a plain API call
const DEFAULT_TIMEOUT_MS = 10_000;

export class HikConnectApiError extends Error {
  constructor(
    message: string,
    public readonly errorCode?: string,
  ) {
    super(message);
    this.name = "HikConnectApiError";
  }
}

interface TokenState {
  accessToken: string;
  baseUrl: string;
  fetchedAt: number;
}

/**
 * One platform-wide Hik-Connect account (see platform-settings) serves every
 * organization, so the token is cached at module scope — keyed by appKey so a
 * credential change never serves a stale token. In-memory only: worst case
 * after a process restart is one extra login call, not a real problem (same
 * tradeoff as hikvision-isapi.ts's lockout cache).
 */
const tokenCache = new Map<string, TokenState>();

async function loginAt(baseUrl: string, credentials: HikConnectCredentials): Promise<TokenState> {
  const response = await fetch(`${baseUrl}/api/hccgw/platform/v1/token/get`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appKey: credentials.appKey, secretKey: credentials.appSecret }),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  const body = (await response.json()) as { errorCode?: string; message?: string; data?: { accessToken?: string; areaDomain?: string } };
  if (body.errorCode !== "0" || !body.data?.accessToken) {
    throw new HikConnectApiError(body.message ?? body.errorCode ?? `HTTP ${response.status}`, body.errorCode);
  }
  return {
    accessToken: body.data.accessToken,
    baseUrl: (body.data.areaDomain || baseUrl).replace(/\/$/, ""),
    fetchedAt: Date.now(),
  };
}

async function login(credentials: HikConnectCredentials): Promise<TokenState> {
  const candidates = credentials.region && HIK_CONNECT_REGIONS[credentials.region]
    ? [HIK_CONNECT_REGIONS[credentials.region]]
    : Object.values(HIK_CONNECT_REGIONS);

  let lastError: unknown;
  for (const baseUrl of candidates) {
    try {
      const state = await loginAt(baseUrl, credentials);
      tokenCache.set(credentials.appKey, state);
      return state;
    } catch (error) {
      lastError = error;
    }
  }
  throw new HikConnectApiError(
    `Hech qaysi mintaqaga ulanib bo'lmadi (appKey/appSecret to'g'riligini tekshiring): ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function ensureToken(credentials: HikConnectCredentials): Promise<TokenState> {
  const cached = tokenCache.get(credentials.appKey);
  if (cached && Date.now() - cached.fetchedAt < TOKEN_MAX_AGE_MS) return cached;
  return login(credentials);
}

async function hikConnectPost<T = Record<string, unknown>>(
  credentials: HikConnectCredentials,
  path: string,
  payload: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const state = await ensureToken(credentials);
  let response: Response;
  try {
    response = await fetch(`${state.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Token: state.accessToken },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new HikConnectApiError(`${path}: tarmoq xatosi — ${error instanceof Error ? error.message : String(error)}`);
  }
  const body = (await response.json()) as { errorCode?: string; message?: string; data?: T };
  if (body.errorCode !== "0") {
    throw new HikConnectApiError(`${path}: ${body.message ?? body.errorCode ?? `HTTP ${response.status}`}`, body.errorCode);
  }
  return (body.data ?? ({} as T)) as T;
}

export interface HikConnectArea {
  id: string;
  areaName?: string;
  parentAreaId?: string;
}

/** Every area/group in the account, parent and nested children together in one call. */
export async function listAreas(credentials: HikConnectCredentials): Promise<HikConnectArea[]> {
  const data = await hikConnectPost<{ area?: HikConnectArea[] }>(credentials, "/api/hccgw/resource/v1/areas/get", {
    pageIndex: 1,
    pageSize: 500,
    filter: { parentAreaID: "-1", includeSubArea: 1 },
  });
  return data.area ?? [];
}

/** Confirmed live shape from resource/v1/devices/get against a real account. */
export interface HikConnectDevice {
  id: string;
  name?: string;
  serialNo?: string;
  type?: string;
  onlineStatus?: number; // 1 = online, 0 = offline
}

async function listDevicesInArea(credentials: HikConnectCredentials, areaId: string): Promise<HikConnectDevice[]> {
  const data = await hikConnectPost<{ device?: HikConnectDevice[] }>(credentials, "/api/hccgw/resource/v1/devices/get", {
    pageIndex: 1,
    pageSize: 200,
    areaId,
    deviceCategory: "accessControllerDevice",
  });
  return data.device ?? [];
}

/** Every access-control terminal in the account, across every area, in one flat list. */
export async function listAccessDevices(credentials: HikConnectCredentials): Promise<HikConnectDevice[]> {
  const areas = await listAreas(credentials);
  const devices: HikConnectDevice[] = [];
  for (const area of areas) {
    try {
      devices.push(...(await listDevicesInArea(credentials, area.id)));
    } catch (error) {
      logger.warn(`Hik-Connect: could not list devices for area ${area.id}: ${error}`);
    }
  }
  return devices;
}

/**
 * Forwards one ISAPI request through Hik-Connect's cloud relay straight to
 * the terminal itself — proven live for JSON GET/POST bodies (UserInfo,
 * AcsEvent). `data` on this call is the device's raw ISAPI response as a JSON
 * string, so it's parsed separately here.
 */
async function isapiProxy(
  credentials: HikConnectCredentials,
  deviceId: string,
  method: "GET" | "POST" | "PUT",
  url: string,
  jsonBody?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const raw = await hikConnectPost<string>(
    credentials,
    "/api/hccgw/video/v1/isapi/proxypass",
    {
      method,
      url,
      id: deviceId,
      contentType: "application/json",
      body: jsonBody ? JSON.stringify(jsonBody) : "",
    },
    ISAPI_TIMEOUT_MS,
  );
  if (!raw) return {};
  if (typeof raw !== "string") return raw as Record<string, unknown>;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    logger.warn(`Hik-Connect proxypass ${url}: response was not JSON: ${raw.slice(0, 300)}`);
    return {};
  }
}

/** Connectivity + credential check via proxypass — the cloud-relay counterpart of hikvision-isapi.ts's fetchDeviceInfo(). */
export async function fetchDeviceInfo(credentials: HikConnectCredentials, deviceId: string): Promise<{ deviceName?: string; serialNumber?: string }> {
  const result = await isapiProxy(credentials, deviceId, "GET", "/ISAPI/System/deviceInfo?format=json");
  const info = (result.DeviceInfo ?? {}) as { deviceName?: string; serialNumber?: string };
  return { deviceName: info.deviceName, serialNumber: info.serialNumber };
}

/** Real remote reboot via proxypass — standard Hikvision ISAPI endpoint, no request body. */
export async function rebootDevice(credentials: HikConnectCredentials, deviceId: string): Promise<void> {
  await isapiProxy(credentials, deviceId, "PUT", "/ISAPI/System/reboot");
}

/**
 * Terminal's own enrolled-person list (name included) — via proxypass'd
 * ISAPI UserInfo/Search. Confirmed live: this account's employees live only
 * in the terminal's local memory, not Hik-Connect's cloud Person Management,
 * so this is the only real source for their names.
 */
export async function searchDeviceUsers(credentials: HikConnectCredentials, deviceId: string): Promise<HikvisionDeviceUser[]> {
  const users: HikvisionDeviceUser[] = [];
  let position = 0;
  const pageSize = 30;

  for (;;) {
    const result = await isapiProxy(credentials, deviceId, "POST", "/ISAPI/AccessControl/UserInfo/Search?format=json", {
      UserInfoSearchCond: { searchID: "1", searchResultPosition: position, maxResults: pageSize },
    });
    const search = (result.UserInfoSearch ?? {}) as { UserInfo?: { employeeNo?: string; name?: string }[]; responseStatusStrg?: string };
    const page = search.UserInfo ?? [];
    for (const u of page) {
      if (u.employeeNo) users.push({ personId: u.employeeNo, name: u.name ?? "" });
    }
    if (search.responseStatusStrg !== "MORE" || page.length === 0) break;
    position += page.length;
    if (position > 5000) break; // safety cap
  }

  return users;
}

/**
 * Terminal's own access-control event log (ISAPI AcsEvent) via proxypass —
 * the cloud-relay counterpart of hikvision-isapi.ts's searchAcsEvents(). Only
 * identification events (major=5, minor=75 — "identification succeeded",
 * the one that carries the employee's name) are kept; door-relay/sensor
 * events without a name are filtered out, matching the confirmed-live bot.
 */
export async function searchDeviceEvents(
  credentials: HikConnectCredentials,
  deviceId: string,
  startTime: Date,
  endTime: Date,
): Promise<HikvisionAttendanceEvent[]> {
  const events: HikvisionAttendanceEvent[] = [];
  let position = 0;
  const pageSize = 30;

  for (;;) {
    const result = await isapiProxy(credentials, deviceId, "POST", "/ISAPI/AccessControl/AcsEvent?format=json", {
      AcsEventCond: {
        searchID: "1",
        searchResultPosition: position,
        maxResults: pageSize,
        major: 0,
        minor: 0,
        startTime: formatIsapiTime(startTime),
        endTime: formatIsapiTime(endTime),
      },
    });
    const acsEvent = (result.AcsEvent ?? {}) as { InfoList?: Record<string, unknown>[]; responseStatusStrg?: string };
    const page = acsEvent.InfoList ?? [];
    for (const e of page) {
      const name = e.name as string | undefined;
      const employeeNoString = (e.employeeNoString as string | undefined) ?? (e.employeeNo as string | undefined);
      const time = e.time as string | undefined;
      const isIdentification = e.major === 5 && e.minor === 75;
      if (name && employeeNoString && time && isIdentification) {
        events.push({
          employeeNo: employeeNoString,
          time,
          attendanceStatus: (e.attendanceStatus as string) ?? "",
          serialNo: e.serialNo !== undefined ? String(e.serialNo) : undefined,
        });
      }
    }
    if (acsEvent.responseStatusStrg !== "MORE" || page.length === 0) break;
    position += page.length;
    if (position > 3000) break; // safety cap
  }

  return events;
}

/**
 * Cloud-side certificaterecords/search — returns each event's snapshot photo
 * URL, keyed by devSerialNo (the same value as ISAPI AcsEvent's `serialNo`,
 * the link between the name from searchDeviceEvents() and the photo from
 * here). Only populated once the terminal has "save verification picture"
 * enabled (AcsCfg: uploadVerificationPic/saveVerificationPic) — confirmed
 * live: turning that on is what made acsSnapPicList start appearing.
 */
export async function searchCertificateSnapshots(
  credentials: HikConnectCredentials,
  deviceId: string,
  beginTime: Date,
  endTime: Date,
): Promise<Map<string, string>> {
  const snapshots = new Map<string, string>();
  let pageIndex = 1;
  const pageSize = 100;

  for (;;) {
    const data = await hikConnectPost<{ recordList?: Record<string, unknown>[]; totalNum?: number }>(
      credentials,
      "/api/hccgw/acs/v1/event/certificaterecords/search",
      {
        pageIndex,
        pageSize,
        searchCriteria: {
          beginTime: formatIsapiTime(beginTime),
          endTime: formatIsapiTime(endTime),
          type: 0,
          swipeAuthResult: 0,
          searchType: 0,
        },
      },
    );
    const records = data.recordList ?? [];
    for (const record of records) {
      if (record.deviceId !== deviceId) continue;
      const pics = (record.acsSnapPicList as { snapPicUrl?: string }[] | undefined) ?? [];
      // The real API returns devSerialNo as a JSON number, while searchDeviceEvents()
      // stores AcsEvent's serialNo as a string (String(e.serialNo)) — without this
      // coercion, Map<number, string> keys never match the string lookup key below,
      // so every snapshot lookup silently missed (confirmed live: typeof was "number").
      const devSerialNo = record.devSerialNo !== undefined && record.devSerialNo !== null ? String(record.devSerialNo) : undefined;
      if (devSerialNo && pics[0]?.snapPicUrl) snapshots.set(devSerialNo, pics[0].snapPicUrl);
    }
    if (records.length < pageSize || pageIndex * pageSize >= (data.totalNum ?? 0)) break;
    pageIndex += 1;
    if (pageIndex > 50) break; // safety cap
  }

  return snapshots;
}

/**
 * Pushes one employee's person record + card number + face photo to a
 * terminal via proxypass — the cloud-relay counterpart of
 * hikvision-isapi.ts's enrollEmployee(). UserInfo/Record(+Modify fallback)
 * and CardInfo/Record reuse the exact same JSON envelope proven live by
 * searchDeviceUsers/searchDeviceEvents above, so they carry the same
 * confidence. The face photo step (FaceDataRecord) is NOT the same shape:
 * ISAPI expects a raw multipart/form-data body with binary image bytes, but
 * proxypass's envelope only documents a JSON string `body` field — sending
 * base64-encoded multipart bytes through it is an educated guess, unconfirmed
 * against a real account. If the terminal/gateway rejects it, that failure is
 * thrown here (not swallowed) so the per-employee sync result shows exactly
 * what happened, same as the "confirmed live" error-surfacing convention
 * used throughout hikvision-isapi.ts.
 */
export async function enrollEmployee(credentials: HikConnectCredentials, deviceId: string, employee: HikvisionEmployee): Promise<void> {
  const userInfoBody = {
    UserInfo: {
      employeeNo: employee.employeeCode,
      name: employee.fullName,
      userType: "normal",
      Valid: { enable: true, beginTime: "2020-01-01T00:00:00", endTime: "2037-12-31T23:59:59" },
    },
  };
  let userInfoResult = await isapiProxy(credentials, deviceId, "POST", "/ISAPI/AccessControl/UserInfo/Record?format=json", userInfoBody);
  if (userInfoResult.statusCode !== 1 && JSON.stringify(userInfoResult).includes("employeeNoAlreadyExist")) {
    userInfoResult = await isapiProxy(credentials, deviceId, "PUT", "/ISAPI/AccessControl/UserInfo/Modify?format=json", userInfoBody);
  }
  if (userInfoResult.statusCode !== 1 && userInfoResult.statusCode !== undefined) {
    throw new HikConnectApiError(`UserInfo push (proxypass) failed: ${JSON.stringify(userInfoResult).slice(0, 500)}`);
  }

  if (employee.cardNumber) {
    const cardResult = await isapiProxy(credentials, deviceId, "PUT", "/ISAPI/AccessControl/CardInfo/Record?format=json", {
      CardInfo: { employeeNo: employee.employeeCode, cardNo: employee.cardNumber, cardType: "normalCard" },
    });
    if (cardResult.statusCode !== 1 && cardResult.statusCode !== undefined) {
      throw new HikConnectApiError(`CardInfo push (proxypass) failed: ${JSON.stringify(cardResult).slice(0, 500)}`);
    }
  }

  if (employee.photoUrl) {
    const photoBuffer = await readPhotoBuffer(employee.photoUrl);
    if (photoBuffer) {
      const faceMeta = JSON.stringify({ faceLibType: "blackFD", FDID: "1", FPID: employee.employeeCode });
      const boundary = `----FaceHubBoundary${randomBytes(8).toString("hex")}`;
      const multipartBody =
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="FaceDataRecord"\r\n\r\n${faceMeta}\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="img"; filename="face.jpg"\r\n` +
        `Content-Type: image/jpeg\r\n\r\n`;
      const closing = `\r\n--${boundary}--\r\n`;
      const fullBody = Buffer.concat([Buffer.from(multipartBody, "utf8"), photoBuffer, Buffer.from(closing, "utf8")]);

      const raw = await hikConnectPost<string>(
        credentials,
        "/api/hccgw/video/v1/isapi/proxypass",
        {
          method: "POST",
          url: "/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json",
          id: deviceId,
          contentType: `multipart/form-data; boundary=${boundary}`,
          body: fullBody.toString("base64"),
          bodyEncoding: "base64",
        },
        ISAPI_TIMEOUT_MS,
      );
      let faceResult: Record<string, unknown> = {};
      try {
        faceResult = typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : ((raw as unknown as Record<string, unknown>) ?? {});
      } catch {
        // Non-JSON response — most likely proof this base64 multipart shape isn't what the gateway expects.
      }
      if (faceResult.statusCode !== 1) {
        throw new HikConnectApiError(
          `Rasm (FaceDataRecord) proxypass orqali muvaffaqiyatsiz — bu mexanizm hali tasdiqlanmagan: ${JSON.stringify(faceResult).slice(0, 500) || raw?.slice?.(0, 500)}`,
        );
      }
    }
  }
}

/** Real connectivity + credential check — login, then confirm the account can actually list its own areas. */
export async function testConnection(credentials: HikConnectCredentials): Promise<{ ok: boolean; detail: string }> {
  try {
    await login(credentials);
    const areas = await listAreas(credentials);
    return { ok: true, detail: `Ulandi. ${areas.length} ta guruh (area) topildi.` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}
