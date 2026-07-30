import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { logger } from "../../config/logger";

export interface HikvisionDeviceTarget {
  ipAddress: string;
  port: number;
  isapiUsername: string;
  isapiPassword: string;
}

export interface HikvisionEmployee {
  employeeCode: string;
  fullName: string;
  cardNumber?: string | null;
  photoUrl?: string | null;
}

class HikvisionIsapiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "HikvisionIsapiError";
  }
}

function md5(input: string): string {
  return createHash("md5").update(input).digest("hex");
}

interface DigestChallenge {
  realm: string;
  nonce: string;
  qop?: string;
  opaque?: string;
}

function parseWwwAuthenticate(header: string): DigestChallenge | null {
  if (!header.toLowerCase().startsWith("digest ")) return null;
  const params: Record<string, string> = {};
  const regex = /(\w+)=(?:"([^"]*)"|([^,\s]+))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(header)) !== null) {
    params[match[1]] = match[2] ?? match[3];
  }
  if (!params.realm || !params.nonce) return null;
  return { realm: params.realm, nonce: params.nonce, qop: params.qop, opaque: params.opaque };
}

function buildDigestAuthHeader(
  challenge: DigestChallenge,
  method: string,
  uri: string,
  username: string,
  password: string,
): string {
  const ha1 = md5(`${username}:${challenge.realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const nc = "00000001";
  const cnonce = randomBytes(8).toString("hex");

  let response: string;
  let extra = "";
  if (challenge.qop) {
    response = md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${challenge.qop}:${ha2}`);
    extra = `, qop=${challenge.qop}, nc=${nc}, cnonce="${cnonce}"`;
  } else {
    response = md5(`${ha1}:${challenge.nonce}:${ha2}`);
  }

  const opaquePart = challenge.opaque ? `, opaque="${challenge.opaque}"` : "";
  return (
    `Digest username="${username}", realm="${challenge.realm}", nonce="${challenge.nonce}", ` +
    `uri="${uri}", response="${response}"${extra}${opaquePart}`
  );
}

/**
 * Minimal hand-rolled HTTP Digest Auth (RFC 2617) client for Hikvision's
 * ISAPI: send once unauthenticated, read the 401 challenge, retry once with
 * the computed Authorization header. No SDK/dependency — matches this
 * project's existing pattern of raw fetch for external HTTP integrations
 * (see common/telegram.ts).
 */
/**
 * Hikvision locks the admin account for a cooldown period after repeated
 * failed logins (its own brute-force protection — see the <lockStatus>lock
 * </lockStatus> / <unlockTime> XML it returns on 401). Without this, our
 * 30s connectivity-poll cron would keep hammering a locked account forever,
 * which risks resetting/extending the device's own lockout timer instead of
 * ever letting it recover. Keyed by ip:port, in-memory only (worst case
 * after a process restart is one extra wasted attempt, not a real problem).
 */
const lockouts = new Map<string, { until: number }>();

function deviceKey(device: HikvisionDeviceTarget): string {
  return `${device.ipAddress}:${device.port}`;
}

function assertNotLockedOut(device: HikvisionDeviceTarget): void {
  const entry = lockouts.get(deviceKey(device));
  if (entry && entry.until > Date.now()) {
    const remaining = Math.ceil((entry.until - Date.now()) / 1000);
    throw new HikvisionIsapiError(`Device account is locked out (Hikvision brute-force protection) — retry in ${remaining}s`, 401);
  }
}

function recordAuthResult(device: HikvisionDeviceTarget, status: number, text: string): void {
  const key = deviceKey(device);
  if (status !== 401) {
    lockouts.delete(key);
    return;
  }
  const unlockMatch = /<lockStatus>lock<\/lockStatus>[\s\S]*?<unlockTime>(\d+)<\/unlockTime>/.exec(text);
  if (unlockMatch) {
    lockouts.set(key, { until: Date.now() + Number(unlockMatch[1]) * 1000 });
  } else {
    // Plain wrong-credentials 401 (no device-reported lock) — still back off
    // briefly so a misconfigured device doesn't get hit every 30s forever.
    lockouts.set(key, { until: Date.now() + 60_000 });
  }
}

async function digestRequest(
  device: HikvisionDeviceTarget,
  method: string,
  uriPath: string,
  body?: RequestInit["body"],
  contentType?: string,
): Promise<{ status: number; text: string }> {
  assertNotLockedOut(device);

  const baseUrl = `http://${device.ipAddress}:${device.port}`;
  const url = `${baseUrl}${uriPath}`;

  const firstResponse = await fetch(url, { method, body, headers: contentType ? { "Content-Type": contentType } : undefined });
  if (firstResponse.status !== 401) {
    const text = await firstResponse.text();
    recordAuthResult(device, firstResponse.status, text);
    return { status: firstResponse.status, text };
  }

  const challengeHeader = firstResponse.headers.get("www-authenticate");
  if (!challengeHeader) {
    const text = await firstResponse.text();
    recordAuthResult(device, firstResponse.status, text);
    return { status: firstResponse.status, text };
  }
  const challenge = parseWwwAuthenticate(challengeHeader);
  if (!challenge) {
    const text = await firstResponse.text();
    recordAuthResult(device, firstResponse.status, text);
    return { status: firstResponse.status, text };
  }

  const authHeader = buildDigestAuthHeader(challenge, method, uriPath, device.isapiUsername, device.isapiPassword);
  const secondResponse = await fetch(url, {
    method,
    body,
    headers: { Authorization: authHeader, ...(contentType ? { "Content-Type": contentType } : {}) },
  });
  const secondText = await secondResponse.text();
  recordAuthResult(device, secondResponse.status, secondText);
  return { status: secondResponse.status, text: secondText };
}

export interface HikvisionAttendanceEvent {
  employeeNo: string;
  time: string;
  attendanceStatus: string;
}

/**
 * Hikvision's ISAPI rejects JS's default Date#toISOString() ("...ss.sssZ")
 * with a "badJsonContent" / startTime error — confirmed live against the
 * real device. It expects "YYYY-MM-DDTHH:mm:ss+HH:mm" (no milliseconds,
 * explicit offset instead of "Z"). The device's own clock is local Uzbekistan
 * time (UTC+5, no DST), so render the wall-clock time in that zone.
 */
function formatIsapiTime(date: Date): string {
  const tashkent = new Date(date.getTime() + 5 * 60 * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = tashkent.getUTCFullYear();
  const mo = pad(tashkent.getUTCMonth() + 1);
  const d = pad(tashkent.getUTCDate());
  const h = pad(tashkent.getUTCHours());
  const mi = pad(tashkent.getUTCMinutes());
  const s = pad(tashkent.getUTCSeconds());
  return `${y}-${mo}-${d}T${h}:${mi}:${s}+05:00`;
}

/**
 * Polls the device's own access-control event log (AcsEvent) for real
 * attendance events — the fallback path for when the device's HTTP Listening
 * push (the webhook) never actually fires. Paginates in batches of 30 like
 * searchDeviceUsers. Exact field names (attendanceStatus values, etc.) are
 * the standard Hikvision shape but unconfirmed against this specific
 * firmware until a real event is seen — adjust here if needed.
 */
export async function searchAcsEvents(
  device: HikvisionDeviceTarget,
  startTime: Date,
  endTime: Date,
): Promise<HikvisionAttendanceEvent[]> {
  const events: HikvisionAttendanceEvent[] = [];
  let position = 0;
  const pageSize = 30;

  for (;;) {
    const body = JSON.stringify({
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
    const { status, text } = await digestRequest(
      device,
      "POST",
      "/ISAPI/AccessControl/AcsEvent?format=json",
      body,
      "application/json",
    );
    if (status !== 200) {
      throw new HikvisionIsapiError(`AcsEvent search failed (${status}): ${text.slice(0, 500)}`, status, text);
    }

    const parsed = JSON.parse(text) as {
      AcsEvent?: { InfoList?: Record<string, unknown>[] };
    };
    const page = parsed.AcsEvent?.InfoList ?? [];
    if (page.length > 0) {
      // Temporary diagnostic: attendanceStatus has come back empty against
      // the real device — log the full raw event once so the correct field
      // (if named differently) can be identified and mapped.
      logger.info(`Hikvision AcsEvent raw sample: ${JSON.stringify(page[0])}`);
    }
    for (const e of page) {
      const employeeNoString = e.employeeNoString as string | undefined;
      const time = e.time as string | undefined;
      if (employeeNoString && time) {
        events.push({ employeeNo: employeeNoString, time, attendanceStatus: (e.attendanceStatus as string) ?? "" });
      }
    }

    if (page.length < pageSize) break;
    position += pageSize;
    if (position > 3000) break; // safety cap
  }

  return events;
}

/** Real remote reboot — standard Hikvision ISAPI endpoint, no request body. */
export async function rebootDevice(device: HikvisionDeviceTarget): Promise<void> {
  const { status, text } = await digestRequest(device, "PUT", "/ISAPI/System/reboot");
  if (status !== 200) {
    throw new HikvisionIsapiError(`reboot request failed with status ${status}`, status, text.slice(0, 500));
  }
}

/** Connectivity + credential check — used for real online/offline status. */
export async function fetchDeviceInfo(device: HikvisionDeviceTarget): Promise<{ deviceName?: string; serialNumber?: string }> {
  const { status, text } = await digestRequest(device, "GET", "/ISAPI/System/deviceInfo?format=json");
  if (status !== 200) {
    throw new HikvisionIsapiError(`deviceInfo request failed with status ${status}`, status, text.slice(0, 500));
  }
  try {
    const parsed = JSON.parse(text) as { DeviceInfo?: { deviceName?: string; serialNumber?: string } };
    return { deviceName: parsed.DeviceInfo?.deviceName, serialNumber: parsed.DeviceInfo?.serialNumber };
  } catch {
    return {};
  }
}

export interface HikvisionDeviceUser {
  personId: string;
  name: string;
}

/**
 * Pulls the device's own enrolled person list (its "User" management page) —
 * used to reconcile against FaceHub's employees so an admin can see which
 * device Person IDs already have a matching employeeCode and which don't.
 * Paginates in batches of 30 since some firmware caps maxResults per call.
 */
export async function searchDeviceUsers(device: HikvisionDeviceTarget): Promise<HikvisionDeviceUser[]> {
  const users: HikvisionDeviceUser[] = [];
  let position = 0;
  const pageSize = 30;

  for (;;) {
    const body = JSON.stringify({
      UserInfoSearchCond: { searchID: "1", searchResultPosition: position, maxResults: pageSize },
    });
    const { status, text } = await digestRequest(
      device,
      "POST",
      "/ISAPI/AccessControl/UserInfo/Search?format=json",
      body,
      "application/json",
    );
    if (status !== 200) {
      throw new HikvisionIsapiError(`UserInfo/Search failed (${status}): ${text.slice(0, 500)}`, status, text);
    }

    const parsed = JSON.parse(text) as {
      UserInfoSearch?: { UserInfo?: { employeeNo?: string; name?: string }[]; responseStatusStrg?: string };
    };
    const page = parsed.UserInfoSearch?.UserInfo ?? [];
    for (const u of page) {
      if (u.employeeNo) users.push({ personId: u.employeeNo, name: u.name ?? "" });
    }

    if (page.length < pageSize) break;
    position += pageSize;
    if (position > 5000) break; // safety cap
  }

  return users;
}

/**
 * Pulls a person's enrolled face photo back off the device — the read-side
 * counterpart of the FaceDataRecord upload in enrollEmployee(). Hikvision's
 * face-library search response shape (a "picUri" to fetch separately vs. an
 * inline base64 blob) varies by firmware and isn't confirmed against this
 * specific device yet; this handles both known shapes and returns null
 * (rather than throwing) on anything unexpected, since a missing photo
 * should never block importing the person themselves.
 */
export async function fetchDevicePersonPhoto(device: HikvisionDeviceTarget, personId: string): Promise<Buffer | null> {
  try {
    const body = JSON.stringify({
      FaceInfoSearchCond: { searchID: "1", searchResultPosition: 0, maxResults: 1, faceLibType: "blackFD", FDID: "1", FPID: personId },
    });
    const { status, text } = await digestRequest(
      device,
      "POST",
      "/ISAPI/Intelligent/FDLib/FDSearch?format=json",
      body,
      "application/json",
    );
    if (status !== 200) {
      logger.warn(`Hikvision FDSearch failed for person ${personId} (${status}): ${text.slice(0, 300)}`);
      return null;
    }

    const parsed = JSON.parse(text) as {
      FaceInfoSearch?: { MatchList?: { FPID?: string; data?: string }[] };
    };
    const match = parsed.FaceInfoSearch?.MatchList?.[0];
    // Only the inline-base64 shape is supported — digestRequest() reads
    // responses as text, which would corrupt a binary image fetched from a
    // separate picture URL. If this firmware uses that shape instead, this
    // returns null (no photo) rather than saving corrupted image data; the
    // employee import itself still succeeds without a photo.
    if (!match?.data) return null;
    return Buffer.from(match.data, "base64");
  } catch (error) {
    logger.warn(`Hikvision FDSearch: could not fetch photo for person ${personId}: ${error}`);
    return null;
  }
}

async function readPhotoBuffer(photoUrl: string): Promise<Buffer | null> {
  try {
    // photoUrl is always "/uploads/employees/<file>" (see middlewares/upload.ts)
    // — resolve it against the same uploads root the backend already serves.
    const relative = photoUrl.replace(/^\/uploads\//, "");
    const absolute = path.join(__dirname, "..", "..", "..", "uploads", relative);
    return await readFile(absolute);
  } catch (error) {
    logger.warn(`Hikvision sync: could not read photo file for ${photoUrl}: ${error}`);
    return null;
  }
}

/**
 * Pushes one employee's person record + card number + face photo to the
 * device. The exact ISAPI shapes for face-library enrollment vary by
 * Hikvision firmware generation and can't be 100% confirmed without a live
 * trial against this specific DS-K1T331W — if the device rejects a step with
 * a specific ISAPI error, that real error (thrown here verbatim) is what
 * tells us which endpoint/payload to adjust.
 */
export async function enrollEmployee(device: HikvisionDeviceTarget, employee: HikvisionEmployee): Promise<void> {
  const userInfoBody = JSON.stringify({
    UserInfo: {
      employeeNo: employee.employeeCode,
      name: employee.fullName,
      userType: "normal",
      Valid: { enable: true, beginTime: "2020-01-01T00:00:00", endTime: "2037-12-31T23:59:59" },
    },
  });
  let userInfoResult = await digestRequest(
    device,
    "POST",
    "/ISAPI/AccessControl/UserInfo/Record?format=json",
    userInfoBody,
    "application/json",
  );

  // "Record" only creates NEW people — confirmed live that a second sync of
  // the same employee correctly fails with subStatusCode "employeeNoAlreadyExist".
  // Fall back to Modify (update) for that case instead of treating it as an error.
  if (userInfoResult.status !== 200 && userInfoResult.text.includes("employeeNoAlreadyExist")) {
    userInfoResult = await digestRequest(
      device,
      "PUT",
      "/ISAPI/AccessControl/UserInfo/Modify?format=json",
      userInfoBody,
      "application/json",
    );
  }

  if (userInfoResult.status !== 200) {
    throw new HikvisionIsapiError(
      `UserInfo push failed (${userInfoResult.status}): ${userInfoResult.text.slice(0, 500)}`,
      userInfoResult.status,
      userInfoResult.text,
    );
  }

  if (employee.cardNumber) {
    const cardBody = JSON.stringify({
      CardInfo: { employeeNo: employee.employeeCode, cardNo: employee.cardNumber, cardType: "normalCard" },
    });
    const cardResult = await digestRequest(
      device,
      "PUT",
      "/ISAPI/AccessControl/CardInfo/Record?format=json",
      cardBody,
      "application/json",
    );
    if (cardResult.status !== 200) {
      throw new HikvisionIsapiError(
        `CardInfo push failed (${cardResult.status}): ${cardResult.text.slice(0, 500)}`,
        cardResult.status,
        cardResult.text,
      );
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

      const faceResult = await digestRequest(
        device,
        "POST",
        "/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json",
        fullBody,
        `multipart/form-data; boundary=${boundary}`,
      );
      if (faceResult.status !== 200) {
        // Not fatal for the whole enrollment — the person/card record is real either
        // way — but surfaced so the per-employee sync result shows it wasn't complete.
        throw new HikvisionIsapiError(
          `Face photo push failed (${faceResult.status}): ${faceResult.text.slice(0, 500)}`,
          faceResult.status,
          faceResult.text,
        );
      }
    }
  }
}

export { HikvisionIsapiError };
