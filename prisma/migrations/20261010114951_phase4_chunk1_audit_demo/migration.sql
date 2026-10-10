-- AlterTable
ALTER TABLE `schools` ADD COLUMN `is_demo` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `plan` ENUM('BASIC', 'STANDARD', 'PREMIUM') NULL;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `school_id` VARCHAR(191) NULL,
    `actor_id` VARCHAR(191) NOT NULL,
    `impersonated_by` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `entity` VARCHAR(191) NOT NULL,
    `entity_id` VARCHAR(191) NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_school_id_created_at_idx`(`school_id`, `created_at`),
    INDEX `audit_logs_school_id_entity_created_at_idx`(`school_id`, `entity`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_school_id_fkey` FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_impersonated_by_fkey` FOREIGN KEY (`impersonated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
