import { Request, Response } from "express";
import { asyncHandler } from "../../common/async-handler";
import { sendCreated, sendSuccess } from "../../common/api-response";
import * as organizationService from "./organization.service";

function actorFrom(req: Request) {
  return { userId: req.user?.sub, ipAddress: req.ip ?? null };
}

export const createOrganizationHandler = asyncHandler(async (req: Request, res: Response) => {
  const organization = await organizationService.createOrganization(req.body);
  sendCreated(res, organization);
});

export const listOrganizationsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { items, pagination } = await organizationService.listOrganizations(req.query as Record<string, string>);
  sendSuccess(res, items, 200, pagination);
});

export const getOrganizationHandler = asyncHandler(async (req: Request, res: Response) => {
  const organization = await organizationService.getOrganizationById(req.params.id);
  sendSuccess(res, organization);
});

export const updateOrganizationHandler = asyncHandler(async (req: Request, res: Response) => {
  const organization = await organizationService.updateOrganization(req.params.id, req.body, actorFrom(req));
  sendSuccess(res, organization);
});

export const blockOrganizationHandler = asyncHandler(async (req: Request, res: Response) => {
  const organization = await organizationService.blockOrganization(req.params.id, actorFrom(req));
  sendSuccess(res, organization);
});

export const activateOrganizationHandler = asyncHandler(async (req: Request, res: Response) => {
  const organization = await organizationService.activateOrganization(req.params.id, actorFrom(req));
  sendSuccess(res, organization);
});

export const deleteOrganizationHandler = asyncHandler(async (req: Request, res: Response) => {
  await organizationService.deleteOrganization(req.params.id, actorFrom(req));
  sendSuccess(res, { message: "Organization deleted" });
});
