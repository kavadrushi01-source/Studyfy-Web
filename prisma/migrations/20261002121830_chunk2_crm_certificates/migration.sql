-- Chunk 2 (CRM + certificates): enquiry assignee + updated_at (backfilled
-- from created_at), enquiry_notes + certificates tables, indexes, FKs.
-- AlterTable
ALTER TABLE `enquiries` ADD COLUMN `assignee_id` VARCHAR(191) NULL,
    ADD COLUMN `updated_at` DATETIME(3) NULL;
UPDATE `enquiries` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;
ALTER TABLE `enquiries` MODIFY COLUMN `updated_at` DATETIME(3) NOT NULL;

-- CreateTable
CREATE TABLE `enquiry_notes` (
    `id` VARCHAR(191) NOT NULL,
    `school_id` VARCHAR(191) NOT NULL,
    `enquiry_id` VARCHAR(191) NOT NULL,
    `author_id` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `enquiry_notes_enquiry_id_created_at_idx`(`enquiry_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `certificates` (
    `id` VARCHAR(191) NOT NULL,
    `school_id` VARCHAR(191) NOT NULL,
    `student_id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `serial` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `issued_by` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `certificates_school_id_student_id_created_at_idx`(`school_id`, `student_id`, `created_at`),
    UNIQUE INDEX `certificates_school_id_serial_key`(`school_id`, `serial`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `enquiries_school_id_status_created_at_idx` ON `enquiries`(`school_id`, `status`, `created_at`);

-- AddForeignKey
ALTER TABLE `enquiries` ADD CONSTRAINT `enquiries_assignee_id_fkey` FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enquiry_notes` ADD CONSTRAINT `enquiry_notes_school_id_fkey` FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enquiry_notes` ADD CONSTRAINT `enquiry_notes_enquiry_id_fkey` FOREIGN KEY (`enquiry_id`) REFERENCES `enquiries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enquiry_notes` ADD CONSTRAINT `enquiry_notes_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `certificates` ADD CONSTRAINT `certificates_school_id_fkey` FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `certificates` ADD CONSTRAINT `certificates_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `certificates` ADD CONSTRAINT `certificates_issued_by_fkey` FOREIGN KEY (`issued_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
