-- Chunk 4 (Transport + Payroll): RBAC permission keys + role mappings.
-- Idempotent (INSERT ... ON DUPLICATE KEY): safe on dev, test, e2e, and
-- production (which never runs prisma/seed.ts). Mirrors
-- seedPermissions() — keep both in sync.

INSERT INTO `permissions` (`id`, `key`, `description`) VALUES
  ('perm-chunk4-transport-read', 'transport.read', 'Read routes, vehicles and assignments (all school roles; pupils/parents narrowed to own)'),
  ('perm-chunk4-transport-manage', 'transport.manage', 'Manage routes, stops, vehicles and assignments (School Admin, Transport Manager)'),
  ('perm-chunk4-payroll-read', 'payroll.read', 'Read payroll (managers see all; staff see own slips only)'),
  ('perm-chunk4-payroll-manage', 'payroll.manage', 'Set salaries, generate months, mark paid (School Admin, Accountant)')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `roles` r CROSS JOIN `permissions` p
WHERE r.`name` = 'SCHOOL_ADMIN'
  AND p.`key` IN ('transport.read', 'transport.manage', 'payroll.read', 'payroll.manage')
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `roles` r CROSS JOIN `permissions` p
WHERE r.`name` = 'TRANSPORT_MANAGER'
  AND p.`key` IN ('students.read', 'transport.read', 'transport.manage', 'payroll.read')
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `roles` r CROSS JOIN `permissions` p
WHERE r.`name` = 'ACCOUNTANT'
  AND p.`key` IN ('payroll.read', 'payroll.manage')
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `roles` r CROSS JOIN `permissions` p
WHERE r.`name` IN ('TEACHER', 'STUDENT', 'PARENT')
  AND p.`key` IN ('transport.read')
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `roles` r CROSS JOIN `permissions` p
WHERE r.`name` IN ('TEACHER', 'LIBRARIAN')
  AND p.`key` IN ('payroll.read')
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);
