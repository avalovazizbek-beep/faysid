-- AlterTable
ALTER TABLE `organizations` ADD COLUMN `hikConnectAppKey` VARCHAR(191) NULL,
    ADD COLUMN `hikConnectAppSecretEnc` VARCHAR(191) NULL;
