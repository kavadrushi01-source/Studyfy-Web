-- Settings screen (§7 #23, read-only): platform settings RBAC key.
-- Idempotent (INSERT ... ON DUPLICATE KEY): safe on dev, test, e2e, and
-- production (which never runs prisma/seed.ts). Mirrors
-- seedPermissions() — keep both in sync.

INSERT INTO `permissions` (`id`, `key`, `description`) VALUES
  ('perm-settings-read', 'platform.settings.read', 'Read platform configuration status (Platform Owner only; booleans, never secret values)')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `roles` r CROSS JOIN `permissions` p
WHERE r.`name` = 'PLATFORM_OWNER'
  AND p.`key` IN ('platform.settings.read')
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);
