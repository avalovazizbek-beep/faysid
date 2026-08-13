-- AlterTable
ALTER TABLE `devices` ADD COLUMN `dailyReportLastSentDate` DATE NULL,
    ADD COLUMN `dailyReportTime` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `organizations` ADD COLUMN `telegramNotifyBotTokenEnc` VARCHAR(191) NULL;
