-- Impersonation (§13.9): Platform Owner support sessions. Single new key
-- (start + end share it — both are the same trust level).
-- Idempotent (INSERT ... ON DUPLICATE KEY): safe on dev, test, e2e, and
-- production (which never runs prisma/seed.ts). Mirrors
-- seedPermissions() — keep both in sync.

INSERT INTO `permissions` (`id`, `key`, `description`) VALUES
  ('perm-impersonate', 'platform.impersonate', 'Start/end read-only impersonation sessions as staff (Platform Owner only, §13.9)')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `roles` r CROSS JOIN `permissions` p
WHERE r.`name` = 'PLATFORM_OWNER'
  AND p.`key` IN ('platform.impersonate')
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);
