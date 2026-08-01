import { createHash, createHmac } from "node:crypto";

/**
 * Client for Hikvision's Open Platform / Hik-Connect cloud API (the AK/SK-
 * signed "Artemis"-style gateway used across Hikvision's partner/open
 * platforms) — the alternative to the local ISAPI client (hikvision-isapi.ts)
 * for a device that's only reachable via Hikvision's own cloud relay (e.g.
 * behind CGNAT, no port-forward possible).
 *
 * IMPORTANT — unverified: unlike ISAPI (well-documented, used successfully
 * elsewhere in this codebase), this platform's exact request/signing shape
 * is proprietary and not confirmed against a real account yet. This
 * implements the commonly-documented Hikvision "AK/SK signature" scheme
 * (very close to Alibaba Cloud API Gateway's signing convention, which
 * Hikvision's open-platform SDKs are known to follow), gated behind
 * testConnection() so the very first real call tells us whether the scheme
 * or base URL needs adjusting — the real error response is the fastest way
 * to correct this, the same pattern used throughout the ISAPI work.
 */

export interface HikConnectCredentials {
  appKey: string;
  appSecret: string;
  apiBaseUrl: string;
}

function contentMd5(body: string): string {
  if (!body) return "";
  return createHash("md5").update(body, "utf8").digest("base64");
}

function buildSignature(
  appSecret: string,
  method: string,
  headers: { accept: string; contentMd5: string; contentType: string; date: string },
  path: string,
): string {
  const stringToSign = [method, headers.accept, headers.contentMd5, headers.contentType, headers.date, path].join(
    "\n",
  );
  return createHmac("sha256", appSecret).update(stringToSign, "utf8").digest("base64");
}

/**
 * Makes one signed request against the Hik-Connect/Artemis-style gateway.
 * `path` must include the API's version prefix (e.g. "/artemis/api/resource/v1/person/personList").
 */
export async function hikConnectRequest(
  credentials: HikConnectCredentials,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; text: string }> {
  const bodyText = body ? JSON.stringify(body) : "";
  const accept = "application/json";
  const contentType = "application/json";
  const date = new Date().toUTCString();
  const md5 = contentMd5(bodyText);

  const signature = buildSignature(credentials.appSecret, method, { accept, contentMd5: md5, contentType, date }, path);

  const baseUrl = credentials.apiBaseUrl.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Accept: accept,
      "Content-Type": contentType,
      "Content-MD5": md5,
      Date: date,
      "X-Ca-Key": credentials.appKey,
      "X-Ca-Signature": signature,
      "X-Ca-Signature-Headers": "",
    },
    body: method === "POST" ? bodyText : undefined,
  });

  return { status: response.status, text: await response.text() };
}

/**
 * Real connectivity + credential check — the first call to make against a
 * newly-entered AppKey/AppSecret/base URL. If this fails, the response body
 * (Hikvision's own error code/message) is what tells us whether the signing
 * scheme, path, or base URL needs correcting.
 */
export async function testConnection(credentials: HikConnectCredentials): Promise<{ ok: boolean; detail: string }> {
  try {
    const { status, text } = await hikConnectRequest(credentials, "POST", "/artemis/api/resource/v1/person/personList", {
      pageNo: 1,
      pageSize: 1,
    });
    return { ok: status === 200, detail: `HTTP ${status}: ${text.slice(0, 500)}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}
