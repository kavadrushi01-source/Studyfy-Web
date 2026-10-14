-- Read-only demo sessions (§13.11): mint key for read-only owner tokens.
-- Idempotent (INSERT ... ON DUPLICATE KEY): safe on dev, test, e2e, and
-- production (which never runs prisma/seed.ts). Mirrors
-- seedPermissions() — keep both in sync.

INSERT INTO `permissions` (`id`, `key`, `description`) VALUES
  ('perm-readonly', 'platform.readonly', 'Mint read-only Platform Owner demo sessions (Platform Owner only, §13.11)')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `roles` r CROSS JOIN `permissions` p
WHERE r.`name` = 'PLATFORM_OWNER'
  AND p.`key` IN ('platform.readonly')
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);
