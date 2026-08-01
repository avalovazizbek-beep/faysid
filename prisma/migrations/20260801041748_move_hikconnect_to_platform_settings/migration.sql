/*
  Warnings:

  - You are about to drop the column `hikConnectApiBaseUrl` on the `organizations` table. All the data in the column will be lost.
  - You are about to drop the column `hikConnectAppKey` on the `organizations` table. All the data in the column will be lost.
  - You are about to drop the column `hikConnectAppSecretEnc` on the `organizations` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `organizations` DROP COLUMN `hikConnectApiBaseUrl`,
    DROP COLUMN `hikConnectAppKey`,
    DROP COLUMN `hikConnectAppSecretEnc`;

-- CreateTable
CREATE TABLE `platform_settings` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `hikConnectAppKey` VARCHAR(191) NULL,
    `hikConnectAppSecretEnc` VARCHAR(191) NULL,
    `hikConnectApiBaseUrl` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
