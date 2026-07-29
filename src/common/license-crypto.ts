import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../config/env";

// Unambiguous uppercase alphabet — no 0/O, 1/I/L — so a human reading a code
// aloud over the phone can't confuse characters.
const KEY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomSegment(length: number): string {
  return Array.from(randomBytes(length))
    .map((byte) => KEY_ALPHABET[byte % KEY_ALPHABET.length])
    .join("");
}

/** Generates a redeemable license key like "FH-9L2Q-WT5A-KP81". */
export function generateLicenseKey(): string {
  return `FH-${randomSegment(4)}-${randomSegment(4)}-${randomSegment(4)}`;
}

export interface LicenseSignaturePayload {
  licenseKey: string;
  organizationId: string;
  package: string;
  startDate: Date;
  endDate: Date;
}

function canonicalize(payload: LicenseSignaturePayload): string {
  return [
    payload.licenseKey,
    payload.organizationId,
    payload.package,
    payload.startDate.toISOString(),
    payload.endDate.toISOString(),
  ].join("|");
}

export function signLicense(payload: LicenseSignaturePayload): string {
  return createHmac("sha256", env.LICENSE_SIGNING_SECRET).update(canonicalize(payload)).digest("hex");
}

export function verifyLicenseSignature(payload: LicenseSignaturePayload, signature: string): boolean {
  const expected = signLicense(payload);
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(signature, "hex");
  return expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
}

const ENCRYPTION_ALGORITHM = "aes-256-gcm";

/** Encrypts a license key with AES-256-GCM. Output: "iv:authTag:ciphertext" (all hex). */
export function encryptLicenseKey(plaintext: string): string {
  const key = Buffer.from(env.LICENSE_ENCRYPTION_KEY, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export function decryptLicenseKey(encrypted: string): string {
  const [ivHex, authTagHex, ciphertextHex] = encrypted.split(":");
  const key = Buffer.from(env.LICENSE_ENCRYPTION_KEY, "hex");
  const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextHex, "hex")), decipher.final()]).toString("utf8");
}
