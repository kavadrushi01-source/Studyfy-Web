-- AlterTable
ALTER TABLE `sections` ADD COLUMN `class_teacher_id` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `sections` ADD CONSTRAINT `sections_class_teacher_id_fkey` FOREIGN KEY (`class_teacher_id`) REFERENCES `staff`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
