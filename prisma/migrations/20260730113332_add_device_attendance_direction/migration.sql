-- AlterTable
ALTER TABLE `devices` ADD COLUMN `attendanceDirection` ENUM('AUTO', 'CHECK_IN_ONLY', 'CHECK_OUT_ONLY') NOT NULL DEFAULT 'AUTO';
