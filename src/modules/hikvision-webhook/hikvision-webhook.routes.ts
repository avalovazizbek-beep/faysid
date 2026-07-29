import express, { Router } from "express";
import multer from "multer";
import { handleHikvisionEvent } from "./hikvision-webhook.controller";

const router = Router();

// Accept any multipart field names (Hikvision's field names for the event log /
// attached picture vary by model and firmware) — we inspect and log whatever arrives.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// This route is mounted before the app-wide express.json() (see app.ts), so it
// needs its own JSON parsing for devices that POST JSON directly rather than
// multipart/form-data. Both middlewares no-op when the content-type doesn't match.
router.post("/", express.json({ limit: "5mb" }), upload.any(), handleHikvisionEvent);

export default router;
