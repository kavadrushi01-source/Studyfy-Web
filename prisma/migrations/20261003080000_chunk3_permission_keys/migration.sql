-- Chunk 3 (Library): RBAC permission keys + role mappings. Idempotent
-- (INSERT ... ON DUPLICATE KEY): safe on dev, test, e2e, and production
-- (which never runs prisma/seed.ts). Mirrors seedPermissions() — keep both
-- in sync.

INSERT INTO `permissions` (`id`, `key`, `description`) VALUES
  ('perm-chunk3-library-read', 'library.read', 'Browse the catalog and read loans (all school roles; pupils/parents narrowed to own)'),
  ('perm-chunk3-library-manage', 'library.manage', 'Manage books, issue and take returns (School Admin, Librarian)')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `roles` r CROSS JOIN `permissions` p
WHERE r.`name` = 'SCHOOL_ADMIN'
  AND p.`key` IN ('library.read', 'library.manage')
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `roles` r CROSS JOIN `permissions` p
WHERE r.`name` = 'LIBRARIAN'
  AND p.`key` IN ('students.read', 'library.read', 'library.manage', 'dashboard.read')
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `roles` r CROSS JOIN `permissions` p
WHERE r.`name` IN ('TEACHER', 'STUDENT', 'PARENT')
  AND p.`key` IN ('library.read')
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);
