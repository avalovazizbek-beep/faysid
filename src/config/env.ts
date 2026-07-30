import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  API_PREFIX: z.string().default("/api/v1"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  JWT_ACCESS_SECRET: z.string().min(1, "JWT_ACCESS_SECRET is required"),
  JWT_REFRESH_SECRET: z.string().min(1, "JWT_REFRESH_SECRET is required"),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  // Deliberately separate from JWT_ACCESS_SECRET: a 2FA challenge token proves
  // only "knows the password", not full auth, so it must never verify
  // successfully against the access-token secret (which would let it be used
  // as a real access token on any authenticate()-only route).
  JWT_TWO_FACTOR_SECRET: z.string().min(1, "JWT_TWO_FACTOR_SECRET is required"),

  LICENSE_SIGNING_SECRET: z.string().min(1, "LICENSE_SIGNING_SECRET is required"),
  LICENSE_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, "LICENSE_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)"),

  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),

  // Daily attendance report delivery. Optional: if unset, the daily-report cron
  // logs a warning and skips sending instead of failing.
  TELEGRAM_BOT_TOKEN: z.string().optional(),

  // Publicly reachable base URL for this deployment (e.g.
  // "https://tyutorkpi.sies.uz/faysid"), used to register each organization's
  // Telegram onboarding-bot webhook. Optional: without it, saving a bot token
  // still works but the webhook can't be auto-registered.
  PUBLIC_BASE_URL: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration");
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
