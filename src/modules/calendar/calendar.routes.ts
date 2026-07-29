import { Router } from "express";
import { UserRole } from "@prisma/client";
import { authenticate } from "../../middlewares/authenticate";
import { authorize } from "../../middlewares/authorize";
import { requireTenant } from "../../middlewares/tenant-resolver";
import { validate } from "../../middlewares/validate";
import { calendarQuerySchema } from "./calendar.dto";
import { getCalendarHandler } from "./calendar.controller";

const router = Router();

router.use(authenticate, requireTenant, authorize(UserRole.ORG_ADMIN, UserRole.STAFF));

router.get("/", validate({ query: calendarQuerySchema }), getCalendarHandler);

export default router;
