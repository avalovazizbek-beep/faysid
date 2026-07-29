import { cpus, freemem, loadavg, totalmem, uptime } from "node:os";
import { prisma } from "../../config/prisma";
import { redis } from "../../config/redis";

async function getOrganizationCounts() {
  const [byStatus, byPackage] = await Promise.all([
    prisma.organization.groupBy({ by: ["status"], where: { deletedAt: null }, _count: true }),
    prisma.organization.groupBy({ by: ["package"], where: { deletedAt: null }, _count: true }),
  ]);

  const statusCounts = Object.fromEntries(byStatus.map((row) => [row.status, row._count]));
  const packageCounts = Object.fromEntries(byPackage.map((row) => [row.package, row._count]));

  return {
    total: byStatus.reduce((sum, row) => sum + row._count, 0),
    active: statusCounts.ACTIVE ?? 0,
    blocked: statusCounts.BLOCKED ?? 0,
    trial: packageCounts.TRIAL ?? 0,
    basic: packageCounts.BASIC ?? 0,
    pro: packageCounts.PRO ?? 0,
    enterprise: packageCounts.ENTERPRISE ?? 0,
  };
}

async function getLicenseCounts() {
  const in30Days = new Date(Date.now() + 30 * 86_400_000);

  const [expiringSoon, expired] = await Promise.all([
    prisma.organization.count({
      where: { deletedAt: null, status: "ACTIVE", licenseExpiresAt: { lte: in30Days, gte: new Date() } },
    }),
    prisma.organization.count({ where: { deletedAt: null, status: "EXPIRED" } }),
  ]);

  return { expiringSoon, expired };
}

function getServerStats() {
  const cpuCount = cpus().length;
  return {
    cpuLoadPercent: Math.min(100, Math.round((loadavg()[0] / cpuCount) * 100)),
    totalMemMb: Math.round(totalmem() / 1024 / 1024),
    freeMemMb: Math.round(freemem() / 1024 / 1024),
    uptimeSeconds: Math.round(uptime()),
  };
}

async function getHealthStatus() {
  let database = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = true;
  } catch {
    database = false;
  }

  const redisStatus = redis.status === "ready" || redis.status === "connect";

  return { database, redis: redisStatus, socket: false };
}

async function getOrganizationGrowth() {
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
  twelveMonthsAgo.setDate(1);
  twelveMonthsAgo.setHours(0, 0, 0, 0);

  const organizations = await prisma.organization.findMany({
    where: { createdAt: { gte: twelveMonthsAgo } },
    select: { createdAt: true },
  });

  const buckets = new Map<string, number>();
  for (let i = 0; i < 12; i++) {
    const bucketDate = new Date(twelveMonthsAgo);
    bucketDate.setMonth(bucketDate.getMonth() + i);
    const key = `${bucketDate.getFullYear()}-${String(bucketDate.getMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, 0);
  }

  for (const org of organizations) {
    const key = `${org.createdAt.getFullYear()}-${String(org.createdAt.getMonth() + 1).padStart(2, "0")}`;
    if (buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }

  return Array.from(buckets.entries()).map(([month, count]) => ({ month, count }));
}

export async function getSuperAdminDashboardStats() {
  const [organizations, licenses, activeEmployees, server, health, organizationGrowth] = await Promise.all([
    getOrganizationCounts(),
    getLicenseCounts(),
    prisma.employee.count({ where: { deletedAt: null, status: "ACTIVE" } }),
    getServerStats(),
    getHealthStatus(),
    getOrganizationGrowth(),
  ]);

  return { organizations, licenses, activeEmployees, server, health, organizationGrowth };
}
