import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { env } from "./env";
import { logger } from "./logger";
import { verifyAccessToken } from "../modules/auth/jwt.util";

const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/;

let io: Server | null = null;

export function initSocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin || origin === env.CORS_ORIGIN || LOCALHOST_ORIGIN.test(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      },
      credentials: true,
    },
  });

  io.use((socket: Socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) throw new Error("Missing token");
      const payload = verifyAccessToken(token);
      socket.data.organizationId = payload.organizationId;
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const organizationId = socket.data.organizationId as string | null;
    if (organizationId) {
      socket.join(organizationId);
    }
  });

  logger.info("Socket.IO server initialized");
  return io;
}

export function emitToOrganization(organizationId: string, event: string, payload: unknown): void {
  io?.to(organizationId).emit(event, payload);
}
