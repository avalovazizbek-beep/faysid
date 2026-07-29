import { z } from "zod";

const sixDigitCode = z.string().regex(/^\d{6}$/, "6 xonali kod kiriting");

export const enableTwoFactorSchema = z.object({
  code: sixDigitCode,
});
export type EnableTwoFactorDto = z.infer<typeof enableTwoFactorSchema>;

export const disableTwoFactorSchema = z.object({
  code: sixDigitCode,
});
export type DisableTwoFactorDto = z.infer<typeof disableTwoFactorSchema>;

export const verifyTwoFactorSchema = z.object({
  challengeToken: z.string().min(1),
  code: sixDigitCode,
});
export type VerifyTwoFactorDto = z.infer<typeof verifyTwoFactorSchema>;
