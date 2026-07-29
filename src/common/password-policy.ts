import { z } from "zod";

/** Min 8 chars + at least one uppercase, one lowercase, one digit, one special character. */
export const passwordSchema = z
  .string()
  .min(8, "Parol kamida 8 belgidan iborat bo'lishi kerak")
  .regex(/[a-z]/, "Parolda kamida 1 ta kichik harf bo'lishi kerak")
  .regex(/[A-Z]/, "Parolda kamida 1 ta katta harf bo'lishi kerak")
  .regex(/\d/, "Parolda kamida 1 ta raqam bo'lishi kerak")
  .regex(/[^A-Za-z0-9]/, "Parolda kamida 1 ta maxsus belgi bo'lishi kerak");
