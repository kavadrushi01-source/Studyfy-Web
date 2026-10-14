-- Data export (§13.10, §7 #26): school export RBAC key (admin-only).
-- Idempotent (INSERT ... ON DUPLICATE KEY): safe on dev, test, e2e, and
-- production (which never runs prisma/seed.ts). Mirrors
-- seedPermissions() — keep both in sync.

INSERT INTO `permissions` (`id`, `key`, `description`) VALUES
  ('perm-exports-manage', 'exports.manage', 'Export own school''s data as ZIP (School Admin only; secrets excluded, audited, rate-limited)')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `roles` r CROSS JOIN `permissions` p
WHERE r.`name` = 'SCHOOL_ADMIN'
  AND p.`key` IN ('exports.manage')
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);
