-- AlterTable
ALTER TABLE `subscription_invoices` ADD COLUMN `plan` ENUM('BASIC', 'STANDARD', 'PREMIUM') NULL;
