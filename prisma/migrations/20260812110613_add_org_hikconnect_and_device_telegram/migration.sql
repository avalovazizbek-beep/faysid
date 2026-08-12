-- AlterTable
ALTER TABLE `devices` ADD COLUMN `telegramChatId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `organizations` ADD COLUMN `hikConnectAppKey` VARCHAR(191) NULL,
    ADD COLUMN `hikConnectAppSecretEnc` VARCHAR(191) NULL,
    ADD COLUMN `hikConnectRegion` VARCHAR(191) NULL;
