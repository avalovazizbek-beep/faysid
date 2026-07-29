-- AlterTable
ALTER TABLE `attendances` ADD COLUMN `breakMinutes` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `lastCheckInAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `organizations` ADD COLUMN `telegramChatId` VARCHAR(191) NULL;
