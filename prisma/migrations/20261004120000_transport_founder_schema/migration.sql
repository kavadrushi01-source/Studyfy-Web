-- Founder schema for Transport (§7 #14): fleet-level vehicles,
-- routes carrying their stops as an ordered JSON run, and a
-- student_routes join table (row presence = rides this term).
-- Existing rows are carried over; the vehicle->route link, route
-- descriptions, and driver phones have no column in the new shape
-- and are retired with the old tables (see BUGSFIX 48).

-- CreateTable
CREATE TABLE `vehicles` (
    `id` VARCHAR(191) NOT NULL,
    `school_id` VARCHAR(191) NOT NULL,
    `registration_number` VARCHAR(191) NOT NULL,
    `capacity` INTEGER NOT NULL,
    `driver_name` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `vehicles_school_id_registration_number_key`(`school_id`, `registration_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transport_routes` (
    `id` VARCHAR(191) NOT NULL,
    `school_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `stops` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `transport_routes_school_id_name_idx`(`school_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_routes` (
    `id` VARCHAR(191) NOT NULL,
    `school_id` VARCHAR(191) NOT NULL,
    `student_id` VARCHAR(191) NOT NULL,
    `route_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `student_routes_school_id_student_id_key`(`school_id`, `student_id`),
    INDEX `student_routes_route_id_idx`(`route_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Carry routes: stops become [{ name, pickupTime }] in run order.
-- GROUP_CONCAT default cap (1024 chars) is far too small for JSON runs.
SET SESSION group_concat_max_len = 1000000;
INSERT INTO `transport_routes` (`id`, `school_id`, `name`, `stops`, `created_at`, `updated_at`)
SELECT
    r.`id`,
    r.`school_id`,
    r.`name`,
    COALESCE(
        (
            SELECT CAST(
                CONCAT(
                    '[',
                    GROUP_CONCAT(
                        JSON_OBJECT('name', s.`name`, 'pickupTime', s.`pickup_time`)
                        ORDER BY s.`stop_order` SEPARATOR ','
                    ),
                    ']'
                ) AS JSON
            )
            FROM `bus_stops` s
            WHERE s.`route_id` = r.`id`
        ),
        JSON_ARRAY()
    ),
    r.`created_at`,
    r.`updated_at`
FROM `bus_routes` r;

-- Carry fleet (fleet-level now; per-route assignment retired).
INSERT INTO `vehicles` (`id`, `school_id`, `registration_number`, `capacity`, `driver_name`, `created_at`, `updated_at`)
SELECT `id`, `school_id`, `number`, `capacity`, `driver_name`, `created_at`, `updated_at`
FROM `bus_vehicles`;

-- Carry rider assignments (route-level now; boarding-stop retired).
INSERT INTO `student_routes` (`id`, `school_id`, `student_id`, `route_id`, `created_at`, `updated_at`)
SELECT `id`, `school_id`, `student_id`, `route_id`, `created_at`, `updated_at`
FROM `student_transport`;

-- Retire the old tables (children first: FKs reference routes/stops).
DROP TABLE `student_transport`;
DROP TABLE `bus_vehicles`;
DROP TABLE `bus_stops`;
DROP TABLE `bus_routes`;

-- CreateIndex FKs
ALTER TABLE `vehicles` ADD CONSTRAINT `vehicles_school_id_fkey` FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `transport_routes` ADD CONSTRAINT `transport_routes_school_id_fkey` FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `student_routes` ADD CONSTRAINT `student_routes_school_id_fkey` FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `student_routes` ADD CONSTRAINT `student_routes_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `student_routes` ADD CONSTRAINT `student_routes_route_id_fkey` FOREIGN KEY (`route_id`) REFERENCES `transport_routes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
