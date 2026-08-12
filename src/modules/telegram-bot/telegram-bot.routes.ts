import express, { Router } from "express";
import { handleTelegramBotWebhook } from "./telegram-bot.controller";

const router = Router();

// Mounted before the app-wide express.json() (see app.ts) — this route needs
// its own JSON parser since it's called directly by Telegram, not through
// our normal API surface. No :organizationId param (unlike telegram-onboarding) —
// this is the single global notification bot shared by every organization.
router.post("/", express.json({ limit: "2mb" }), (req, res) => {
  void handleTelegramBotWebhook(req, res);
});

export default router;
