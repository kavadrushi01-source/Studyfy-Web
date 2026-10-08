-- Phase 3 #21 (Biometric/RFID): device registry + pupil device-ID mapping.
-- The students unique index is safe: device_user_id is a brand-new column,
-- entirely NULL, and MySQL treats NULLs as distinct.

-- AlterTable
ALTER TABLE `students` ADD COLUMN `device_user_id` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `biometric_devices` (
    `id` VARCHAR(191) NOT NULL,
    `school_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `location` VARCHAR(191) NULL,
    `key_hash` VARCHAR(191) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `last_seen_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `biometric_devices_key_hash_key`(`key_hash`),
    INDEX `biometric_devices_school_id_is_active_idx`(`school_id`, `is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `students_school_id_device_user_id_key` ON `students`(`school_id`, `device_user_id`);

-- AddForeignKey
ALTER TABLE `biometric_devices` ADD CONSTRAINT `biometric_devices_school_id_fkey` FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
