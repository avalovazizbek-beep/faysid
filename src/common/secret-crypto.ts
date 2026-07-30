import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../config/env";

const ENCRYPTION_ALGORITHM = "aes-256-gcm";

/**
 * Generic AES-256-GCM encrypt/decrypt for secrets we must store reversibly
 * (e.g. a device's own ISAPI admin password) — unlike employee PIN codes,
 * which are one-way bcrypt hashes. Reuses LICENSE_ENCRYPTION_KEY (already a
 * required, already-deployed 32-byte hex secret) rather than adding a new
 * env var just for this. Output: "iv:authTag:ciphertext" (all hex).
 */
export function encryptSecret(plaintext: string): string {
  const key = Buffer.from(env.LICENSE_ENCRYPTION_KEY, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export function decryptSecret(encrypted: string): string {
  const [ivHex, authTagHex, ciphertextHex] = encrypted.split(":");
  const key = Buffer.from(env.LICENSE_ENCRYPTION_KEY, "hex");
  const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextHex, "hex")), decipher.final()]).toString("utf8");
}
