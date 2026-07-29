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

const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/;

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
    "/uploads",
    express.static(path.join(__dirname, "..", "uploads"), {
      setHeaders: (res) => {
        // Helmet's default same-origin CORP would otherwise block the frontend
        // (a different origin/port) from rendering these images.
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      },
    }),
  );
  app.use(compression());
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
