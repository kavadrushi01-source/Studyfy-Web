-- Founder schema for Payroll (§7 #15): staff attendance marks,
-- leave requests, and computed monthly payroll rows (base − deductions
-- = net). Old payroll_payments rows carry over as base with zero
-- deductions; salary_structures retire (base is entered per compute).
-- The PENDING → PAID mark-paid flow retires with the old tables: the
-- founder schema carries no paid status (see BUGSFIX 49).

-- CreateTable
CREATE TABLE `staff_attendance` (
    `id` VARCHAR(191) NOT NULL,
    `school_id` VARCHAR(191) NOT NULL,
    `staff_id` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `status` ENUM('PRESENT', 'ABSENT', 'LATE', 'EXCUSED') NOT NULL DEFAULT 'PRESENT',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `staff_attendance_school_id_staff_id_date_key`(`school_id`, `staff_id`, `date`),
    INDEX `staff_attendance_school_id_date_idx`(`school_id`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leave_requests` (
    `id` VARCHAR(191) NOT NULL,
    `school_id` VARCHAR(191) NOT NULL,
    `staff_id` VARCHAR(191) NOT NULL,
    `dates` JSON NOT NULL,
    `reason` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `leave_requests_school_id_staff_id_idx`(`school_id`, `staff_id`),
    INDEX `leave_requests_school_id_status_idx`(`school_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll` (
    `id` VARCHAR(191) NOT NULL,
    `school_id` VARCHAR(191) NOT NULL,
    `staff_id` VARCHAR(191) NOT NULL,
    `month` VARCHAR(191) NOT NULL,
    `base_salary` DECIMAL(12, 2) NOT NULL,
    `deductions` DECIMAL(12, 2) NOT NULL,
    `net_pay` DECIMAL(12, 2) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `payroll_school_id_staff_id_month_key`(`school_id`, `staff_id`, `month`),
    INDEX `payroll_school_id_month_idx`(`school_id`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Carry generated months: base = recorded amount, no deductions.
INSERT INTO `payroll` (`id`, `school_id`, `staff_id`, `month`, `base_salary`, `deductions`, `net_pay`, `created_at`, `updated_at`)
SELECT `id`, `school_id`, `staff_id`, `month`, `amount`, 0.00, `amount`, `created_at`, CURRENT_TIMESTAMP(3)
FROM `payroll_payments`;

-- Retire the old tables.
DROP TABLE `payroll_payments`;
DROP TABLE `salary_structures`;

-- CreateIndex FKs
ALTER TABLE `staff_attendance` ADD CONSTRAINT `staff_attendance_school_id_fkey` FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `staff_attendance` ADD CONSTRAINT `staff_attendance_staff_id_fkey` FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_school_id_fkey` FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `leave_requests` ADD CONSTRAINT `leave_requests_staff_id_fkey` FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `payroll` ADD CONSTRAINT `payroll_school_id_fkey` FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `payroll` ADD CONSTRAINT `payroll_staff_id_fkey` FOREIGN KEY (`staff_id`) REFERENCES `staff`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
