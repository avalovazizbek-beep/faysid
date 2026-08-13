/**
 * Destructive: wipes every organization, employee, device, attendance record,
 * and every other table in the database — keeping only SUPER_ADMIN user
 * row(s) (login/password intact) so the platform stays accessible afterward.
 * Requires --yes-wipe-everything to run, so it can never fire by accident.
 */
import { prisma } from "../src/config/prisma";

const TABLES_TO_WIPE = [
  "refresh_tokens",
  "audit_logs",
  "device_employee_syncs",
  "attendances",
  "leaves",
  "payrolls",
  "employees",
  "shifts",
  "departments",
  "devices",
  "employee_applications",
  "telegram_onboarding_sessions",
  "licenses",
  "holidays",
  "role_permissions",
  "permissions",
  "roles",
  "platform_settings",
  "organizations",
];

async function main(): Promise<void> {
  if (!process.argv.includes("--yes-wipe-everything")) {
    console.error("Bekor qilindi: bu skript --yes-wipe-everything bayrog'isiz ishlamaydi (tasodifan ishga tushmasligi uchun).");
    process.exit(1);
  }

  const keep = await prisma.user.findMany({ where: { role: "SUPER_ADMIN" }, select: { id: true, email: true } });
  if (keep.length === 0) {
    throw new Error("Hech qanday SUPER_ADMIN topilmadi — to'xtatildi (aks holda hech kim tizimga kira olmay qoladi).");
  }
  console.log("Saqlanadigan Super Admin(lar):", keep.map((u) => u.email).join(", "));

  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0");
  for (const table of TABLES_TO_WIPE) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${table}\``);
    console.log(`  o'chirildi: ${table}`);
  }
  await prisma.$executeRawUnsafe("DELETE FROM `users` WHERE `role` != 'SUPER_ADMIN'");
  await prisma.$executeRawUnsafe("UPDATE `users` SET `organizationId` = NULL, `roleId` = NULL WHERE `role` = 'SUPER_ADMIN'");
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");

  const remaining = await prisma.user.findMany({ select: { id: true, email: true, role: true } });
  console.log("Tayyor. Qolgan foydalanuvchilar:", JSON.stringify(remaining, null, 2));

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
