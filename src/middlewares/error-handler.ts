import { NextFunction, Request, Response } from "express";
import { ApiError } from "../common/api-error";
import { logger } from "../config/logger";
import { isProduction } from "../config/env";

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const apiError = err instanceof ApiError ? err : ApiError.internal(err instanceof Error ? err.message : "Unknown error");

  if (apiError.statusCode >= 500) {
    logger.error(`${req.method} ${req.originalUrl} -> ${apiError.message}`, { stack: err instanceof Error ? err.stack : undefined });
  } else {
    logger.warn(`${req.method} ${req.originalUrl} -> ${apiError.message}`);
  }

  res.status(apiError.statusCode).json({
    success: false,
    message: apiError.message,
    ...(apiError.details ? { details: apiError.details } : {}),
    ...(isProduction ? {} : { stack: err instanceof Error ? err.stack : undefined }),
  });
}
