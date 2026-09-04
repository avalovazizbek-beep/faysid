-- AlterTable
ALTER TABLE `attendances` ADD COLUMN `deviceId` VARCHAR(191) NULL,
    ADD COLUMN `lastSeenAt` DATETIME(3) NULL,
    ADD COLUMN `lastSeenPhotoUrl` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `attendances_deviceId_idx` ON `attendances`(`deviceId`);

-- AddForeignKey
ALTER TABLE `attendances` ADD CONSTRAINT `attendances_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `devices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
