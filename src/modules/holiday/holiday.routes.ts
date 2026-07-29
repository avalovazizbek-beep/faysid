import { Router } from "express";
import { UserRole } from "@prisma/client";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { requireTenant } from "../../middlewares/tenant-resolver";
import { blockIfReadOnly } from "../../middlewares/enforce-read-only";
import { validate } from "../../middlewares/validate";
import { createHolidaySchema, holidayIdParamSchema } from "./holiday.dto";
import { createHolidayHandler, deleteHolidayHandler, listHolidaysHandler } from "./holiday.controller";

const router = Router();

router.use(authenticate, requireTenant, authorize(UserRole.ORG_ADMIN, UserRole.STAFF));

router.get("/", listHolidaysHandler);
router.post("/", blockIfReadOnly, validate({ body: createHolidaySchema }), createHolidayHandler);
router.delete("/:id", validate({ params: holidayIdParamSchema }), deleteHolidayHandler);

export default router;
