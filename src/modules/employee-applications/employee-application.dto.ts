import { z } from "zod";

export const applicationIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const listApplicationsQuerySchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
});
export type ListApplicationsQuery = z.infer<typeof listApplicationsQuerySchema>;

export const approveApplicationSchema = z.object({
  employeeCode: z.string().min(1).max(50),
});
export type ApproveApplicationDto = z.infer<typeof approveApplicationSchema>;
