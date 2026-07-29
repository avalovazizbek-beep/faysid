import cron from "node-cron";
import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import { recordAuditLog } from "../common/audit-log";

const WARNING_THRESHOLDS_DAYS = [30, 15, 7, 3, 1];

/** Flags organizations whose license is about to expire, and expires the ones that already have. */
export async function runLicenseExpiryCheck(): Promise<void> {
  const activeOrgs = await prisma.organization.findMany({
    where: { status: "ACTIVE", licenseExpiresAt: { not: null }, deletedAt: null },
    select: { id: true, licenseExpiresAt: true },
  });

  const now = Date.now();

  for (const org of activeOrgs) {
    const daysRemaining = Math.ceil((org.licenseExpiresAt!.getTime() - now) / 86_400_000);

    if (daysRemaining < 0) {
      await prisma.organization.update({ where: { id: org.id }, data: { status: "EXPIRED" } });
      await recordAuditLog({
        organizationId: org.id,
        action: "LICENSE_EXPIRED",
        entityType: "Organization",
        entityId: org.id,
      });
      logger.info(`Organization ${org.id} license expired`);
    } else if (WARNING_THRESHOLDS_DAYS.includes(daysRemaining)) {
      await recordAuditLog({
        organizationId: org.id,
        action: "LICENSE_EXPIRING_SOON",
        entityType: "Organization",
        entityId: org.id,
        metadata: { daysRemaining },
      });
      logger.info(`Organization ${org.id} license expiring in ${daysRemaining} day(s)`);
    }
  }
}

export function startLicenseExpiryCron(): void {
  // Runs daily at 01:00 server time.
  cron.schedule("0 1 * * *", () => {
    runLicenseExpiryCheck().catch((error) => logger.error(`License expiry check failed: ${error}`));
  });
  logger.info("License expiry cron scheduled (daily at 01:00)");
}
