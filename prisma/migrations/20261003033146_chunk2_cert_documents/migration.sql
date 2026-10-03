-- AlterTable
ALTER TABLE `certificates` ADD COLUMN `document_id` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `certificates` ADD CONSTRAINT `certificates_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
