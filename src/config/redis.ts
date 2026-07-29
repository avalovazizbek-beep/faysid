import Redis from "ioredis";
import { env } from "./env";
import { logger } from "./logger";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  retryStrategy: (times) => (times >= 3 ? null : Math.min(times * 200, 1000)),
});

let hasLoggedError = false;
redis.on("error", (error) => {
  if (!hasLoggedError) {
    logger.error(`Redis error: ${error.message}`);
    hasLoggedError = true;
  }
});
redis.on("connect", () => {
  hasLoggedError = false;
  logger.info("Redis connected");
});
