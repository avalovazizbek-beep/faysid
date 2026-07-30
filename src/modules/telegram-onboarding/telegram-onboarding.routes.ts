import express, { Router } from "express";
import { handleTelegramWebhook } from "./telegram-onboarding.controller";

const router = Router();

// Mounted before the app-wide express.json() (see app.ts) — this route needs
// its own JSON parser since it's called directly by Telegram, not through
// our normal API surface.
router.post("/:organizationId", express.json({ limit: "2mb" }), (req, res) => {
  void handleTelegramWebhook(req, res);
});

export default router;
