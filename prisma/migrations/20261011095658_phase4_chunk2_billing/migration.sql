-- AlterTable
ALTER TABLE `schools` MODIFY `subscription_status` ENUM('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED') NOT NULL DEFAULT 'TRIAL';

-- CreateTable
CREATE TABLE `subscriptions` (
    `id` VARCHAR(191) NOT NULL,
    `school_id` VARCHAR(191) NOT NULL,
    `plan` ENUM('BASIC', 'STANDARD', 'PREMIUM') NOT NULL,
    `status` ENUM('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED') NOT NULL DEFAULT 'TRIAL',
    `current_period_start` DATE NULL,
    `current_period_end` DATE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `subscriptions_school_id_key`(`school_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscription_invoices` (
    `id` VARCHAR(191) NOT NULL,
    `school_id` VARCHAR(191) NOT NULL,
    `invoice_number` VARCHAR(191) NOT NULL,
    `financial_year` VARCHAR(191) NOT NULL,
    `amount_paise` INTEGER NOT NULL,
    `cgst_paise` INTEGER NOT NULL DEFAULT 0,
    `sgst_paise` INTEGER NOT NULL DEFAULT 0,
    `igst_paise` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('PENDING', 'PAID') NOT NULL DEFAULT 'PENDING',
    `period_start` DATE NOT NULL,
    `period_end` DATE NOT NULL,
    `razorpay_order_id` VARCHAR(191) NULL,
    `razorpay_payment_id` VARCHAR(191) NULL,
    `paid_at` DATETIME(3) NULL,
    `paid_method` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `subscription_invoices_invoice_number_key`(`invoice_number`),
    UNIQUE INDEX `subscription_invoices_razorpay_order_id_key`(`razorpay_order_id`),
    UNIQUE INDEX `subscription_invoices_razorpay_payment_id_key`(`razorpay_payment_id`),
    INDEX `subscription_invoices_school_id_status_created_at_idx`(`school_id`, `status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `billing_counters` (
    `financial_year` VARCHAR(191) NOT NULL,
    `last_number` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`financial_year`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_school_id_fkey` FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscription_invoices` ADD CONSTRAINT `subscription_invoices_school_id_fkey` FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
