-- Chunk 3 (Super Admin panel): Users Management RBAC keys + mappings.
-- Idempotent (INSERT ... ON DUPLICATE KEY): safe on dev, test, e2e, and
-- production (which never runs prisma/seed.ts). Mirrors
-- seedPermissions() — keep both in sync.

INSERT INTO `permissions` (`id`, `key`, `description`) VALUES
  ('perm-chunk3-users-read', 'platform.users.read', 'List user accounts across schools (Platform Owner only; account administration, never academic data)'),
  ('perm-chunk3-users-manage', 'platform.users.manage', 'Deactivate/reactivate accounts and change roles (Platform Owner only; never Platform Owner assignments)')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `roles` r CROSS JOIN `permissions` p
WHERE r.`name` = 'PLATFORM_OWNER'
  AND p.`key` IN ('platform.users.read', 'platform.users.manage')
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);
