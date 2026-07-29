import { z } from "zod";

export const calendarQuerySchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2020).max(2100),
});
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;
