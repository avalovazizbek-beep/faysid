/*
  Warnings:

  - You are about to drop the column `hikConnectApiBaseUrl` on the `platform_settings` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `devices` ADD COLUMN `hikConnectDeviceId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `platform_settings` DROP COLUMN `hikConnectApiBaseUrl`,
    ADD COLUMN `hikConnectRegion` VARCHAR(191) NULL;
