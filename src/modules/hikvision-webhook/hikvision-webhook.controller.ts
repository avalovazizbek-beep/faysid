import { Request, Response } from "express";
import { logger } from "../../config/logger";
import { processHikvisionEvent } from "./hikvision-webhook.service";

export async function handleHikvisionEvent(req: Request, res: Response): Promise<void> {
  // Ack immediately — Hikvision devices expect a fast response and may retry-storm
  // or disable the listening config if this endpoint is slow or returns an error.
  res.status(200).json({ success: true });

  try {
    await processHikvisionEvent(req.body as Record<string, unknown>, (req.files as Express.Multer.File[]) ?? []);
  } catch (error) {
    logger.error(`Hikvision webhook processing failed: ${error}`);
  }
}
