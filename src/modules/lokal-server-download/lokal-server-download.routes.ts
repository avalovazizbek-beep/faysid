import path from "node:path";
import { Router } from "express";
import archiver from "archiver";
import { UserRole } from "@prisma/client";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { logger } from "../../config/logger";

const router = Router();

// Compiled to backend/dist/modules/lokal-server-download, or run directly from
// backend/src/modules/lokal-server-download via tsx — both are 3 levels under
// backend/, so this resolves to backend/lokal-server-package either way.
const PACKAGE_DIR = path.join(__dirname, "..", "..", "..", "lokal-server-package");

/**
 * CGNAT bilan bloklangan tarmoqlar uchun: qurilma bilan bir xil lokal
 * tarmoqdagi kompyuterda ishlaydigan, chiquvchi so'rov orqali davomatni
 * saytga uzatib turadigan mustaqil dastur. Hech qanday tenant-maxsus
 * ma'lumot yo'q — shuning uchun tenant talab qilinmaydi, faqat admin roli.
 */
router.get("/download", authenticate, authorize(UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN), (_req, res) => {
  res.attachment("facehub-lokal-server.zip");
  res.setHeader("Content-Type", "application/zip");

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (error: Error) => {
    logger.error(`Lokal server zip yaratishda xato: ${error.message}`);
    if (!res.headersSent) res.status(500).end();
  });
  archive.pipe(res);
  archive.directory(PACKAGE_DIR, false);
  void archive.finalize();
});

export default router;
