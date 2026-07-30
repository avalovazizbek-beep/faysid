-- AlterTable
ALTER TABLE `organizations` ADD COLUMN `telegramBotTokenEnc` VARCHAR(191) NULL,
    ADD COLUMN `telegramRegistrationCode` VARCHAR(191) NULL,
    ADD COLUMN `telegramRegistrationCodeDate` DATE NULL,
    ADD COLUMN `telegramWebhookSecret` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `employee_applications` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `fullName` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `photoUrl` VARCHAR(191) NULL,
    `telegramUserId` VARCHAR(191) NOT NULL,
    `telegramChatId` VARCHAR(191) NOT NULL,
    `telegramUsername` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `reviewedByUserId` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `employee_applications_organizationId_idx`(`organizationId`),
    INDEX `employee_applications_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `telegram_onboarding_sessions` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `chatId` VARCHAR(191) NOT NULL,
    `step` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `fullName` VARCHAR(191) NULL,
    `photoFileId` VARCHAR(191) NULL,
    `telegramUserId` VARCHAR(191) NULL,
    `telegramUsername` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `telegram_onboarding_sessions_organizationId_chatId_key`(`organizationId`, `chatId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `employee_applications` ADD CONSTRAINT `employee_applications_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `organizations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
