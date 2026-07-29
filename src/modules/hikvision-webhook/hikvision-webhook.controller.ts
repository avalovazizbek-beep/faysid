import { Request, Response } from "express";
import { logger } from "../../config/logger";
import { processHikvisionEvent } from "./hikvision-webhook.service";

export async function handleHikvisionEvent(req: Request, res: Response): Promise<void> {
  // Ack immediately — Hikvision devices expect a fast response and may retry-storm
  // or disable the listening config if this endpoint is slow or returns an error.
  res.status(200).json({ success: true });

  // Raw dump for live calibration against the real device — the exact ISAPI event
  // shape (JSON vs multipart, field names) can only be confirmed once we see it.
  console.log("========== HIKVISION ==========");
  console.log(req.headers);
  console.log(req.body);
  console.log(req.files);

  try {
    await processHikvisionEvent(req.body as Record<string, unknown>, (req.files as Express.Multer.File[]) ?? []);
  } catch (error) {
    logger.error(`Hikvision webhook processing failed: ${error}`);
  }
}
