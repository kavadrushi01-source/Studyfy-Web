-- AlterTable
ALTER TABLE `book_loans` ADD COLUMN `fine_amount` DECIMAL(10, 2) NULL;

-- AlterTable
ALTER TABLE `schools` ADD COLUMN `library_fine_per_day` INTEGER NOT NULL DEFAULT 5;
