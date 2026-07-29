import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import multer from "multer";
import { ApiError } from "../common/api-error";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function makeUploader(subdir: string) {
  const destination = path.join(__dirname, "..", "..", "uploads", subdir);
  mkdirSync(destination, { recursive: true });

  return multer({
    storage: multer.diskStorage({
      destination,
      filename: (_req, file, cb) => {
        cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
      },
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        cb(new ApiError(415, "Only JPEG, PNG or WEBP images are allowed"));
        return;
      }
      cb(null, true);
    },
  });
}

export const employeePhotoUpload = makeUploader("employees");

const CSV_MIME_TYPES = new Set(["text/csv", "application/vnd.ms-excel", "text/plain"]);

export const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!CSV_MIME_TYPES.has(file.mimetype) && !file.originalname.toLowerCase().endsWith(".csv")) {
      cb(new ApiError(415, "Only CSV files are allowed"));
      return;
    }
    cb(null, true);
  },
});
