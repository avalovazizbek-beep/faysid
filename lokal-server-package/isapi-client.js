/**
 * Hikvision ISAPI Digest Auth mijozi (backend/src/modules/device/hikvision-isapi.ts
 * bilan bir xil algoritm, faqat oddiy JS'ga o'girilgan — lokal serverning
 * o'zi standalone ishlashi uchun, backendga bog'liq bo'lmasdan).
 */

const crypto = require("node:crypto");

function md5(input) {
  return crypto.createHash("md5").update(input).digest("hex");
}

function parseWwwAuthenticate(header) {
  if (!header || !header.toLowerCase().startsWith("digest ")) return null;
  const params = {};
  const regex = /(\w+)=(?:"([^"]*)"|([^,\s]+))/g;
  let match;
  while ((match = regex.exec(header)) !== null) {
    params[match[1]] = match[2] ?? match[3];
  }
  if (!params.realm || !params.nonce) return null;
  return { realm: params.realm, nonce: params.nonce, qop: params.qop, opaque: params.opaque };
}

function buildDigestAuthHeader(challenge, method, uri, username, password) {
  const ha1 = md5(`${username}:${challenge.realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const nc = "00000001";
  const cnonce = crypto.randomBytes(8).toString("hex");

  let response;
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

/** Bitta digest-auth so'rov: kerak bo'lsa 401 chaqiruvidan keyin qayta uradi. */
async function digestRequest(device, method, uriPath, body, contentType) {
  const baseUrl = `http://${device.ipAddress}:${device.port}`;
  const url = `${baseUrl}${uriPath}`;

  const firstResponse = await fetch(url, {
    method,
    body,
    headers: contentType ? { "Content-Type": contentType } : undefined,
  });
  if (firstResponse.status !== 401) {
    return { status: firstResponse.status, text: await firstResponse.text() };
  }

  const challengeHeader = firstResponse.headers.get("www-authenticate");
  const challenge = parseWwwAuthenticate(challengeHeader);
  if (!challenge) {
    return { status: firstResponse.status, text: await firstResponse.text() };
  }

  const authHeader = buildDigestAuthHeader(challenge, method, uriPath, device.isapiUsername, device.isapiPassword);
  const secondResponse = await fetch(url, {
    method,
    body,
    headers: { Authorization: authHeader, ...(contentType ? { "Content-Type": contentType } : {}) },
  });
  return { status: secondResponse.status, text: await secondResponse.text() };
}

/** Qurilmaning haqiqiy mahalliy (Asia/Tashkent, +5, DST'siz) vaqtini ISAPI kutgan formatda beradi. */
function formatIsapiTime(date) {
  const tashkent = new Date(date.getTime() + 5 * 60 * 60_000);
  const pad = (n) => String(n).padStart(2, "0");
  const y = tashkent.getUTCFullYear();
  const mo = pad(tashkent.getUTCMonth() + 1);
  const d = pad(tashkent.getUTCDate());
  const h = pad(tashkent.getUTCHours());
  const mi = pad(tashkent.getUTCMinutes());
  const s = pad(tashkent.getUTCSeconds());
  return `${y}-${mo}-${d}T${h}:${mi}:${s}+05:00`;
}

/** Qurilmaning voqealar jurnalidan (AcsEvent) berilgan vaqt oralig'idagi hodisalarni o'qiydi. */
async function searchAcsEvents(device, startTime, endTime) {
  const events = [];
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
      throw new Error(`AcsEvent search failed (${status}): ${text.slice(0, 300)}`);
    }

    const parsed = JSON.parse(text);
    const page = parsed.AcsEvent?.InfoList ?? [];
    for (const e of page) {
      if (e.employeeNoString && e.time) {
        events.push({ employeeNo: e.employeeNoString, time: e.time, attendanceStatus: e.attendanceStatus ?? "" });
      }
    }

    if (page.length < pageSize) break;
    position += pageSize;
    if (position > 3000) break;
  }

  return events;
}

/** Qurilma IP/login/parolini tekshirish uchun oddiy so'rov (setup ustasi ishlatadi). */
async function testConnection(device) {
  const { status } = await digestRequest(device, "GET", "/ISAPI/System/deviceInfo?format=json", undefined, undefined);
  return status === 200;
}

module.exports = { searchAcsEvents, testConnection };
