import { z } from "zod";

export const createHolidaySchema = z.object({
  name: z.string().min(2).max(150),
  date: z.string().min(1),
});
export type CreateHolidayDto = z.infer<typeof createHolidaySchema>;

export const holidayIdParamSchema = z.object({
  id: z.string().uuid(),
});
