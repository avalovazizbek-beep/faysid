import path from "node:path";
import express, { Application } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";
import { env, isProduction } from "./config/env";
import { morganStream } from "./config/logger";
import { globalRateLimiter } from "./middlewares/rate-limiter";
import { errorHandler, notFoundHandler } from "./middlewares/error-handler";
import { swaggerSpec } from "./docs/swagger";
import routes from "./routes";
import hikvisionWebhookRoutes from "./modules/hikvision-webhook/hikvision-webhook.routes";

const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/;

// On shared hosting the whole app (API + uploads + the device webhook) is namespaced
// under a path prefix, e.g. API_PREFIX="/faysid/api/v1" — derive that same base ("/faysid")
// for the other two mounts so they move together instead of needing separate config.
// In plain local dev, API_PREFIX="/api/v1" and this is just "".
const BASE_PATH = env.API_PREFIX.replace(/\/api\/v1$/, "");

export function createApp(): Application {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin: isProduction
        ? env.CORS_ORIGIN
        : (origin, callback) => {
            // Vite picks the next free port when its default is taken, so in dev we
            // accept any localhost origin rather than hard-failing on a port mismatch.
            if (!origin || origin === env.CORS_ORIGIN || LOCALHOST_ORIGIN.test(origin)) {
              callback(null, true);
              return;
            }
            callback(new Error(`Origin ${origin} not allowed by CORS`));
          },
      credentials: true,
    }),
  );
  app.use(
    `${BASE_PATH}/uploads`,
    express.static(path.join(__dirname, "..", "uploads"), {
      setHeaders: (res) => {
        // Helmet's default same-origin CORP would otherwise block the frontend
        // (a different origin/port) from rendering these images.
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      },
    }),
  );
  app.use(compression());

  // Mounted before the JSON body parser / global rate limiter and outside API_PREFIX:
  // this is the literal path configured in the Hikvision device's HTTP Listening
  // settings, called directly by the device (no auth, not a browser, and it may
  // fire in bursts) rather than through our normal API surface.
  app.use(`${BASE_PATH}/api/hikvision/event`, hikvisionWebhookRoutes);

  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev", { stream: morganStream }));
  app.use(globalRateLimiter);

  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.use(env.API_PREFIX, routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
