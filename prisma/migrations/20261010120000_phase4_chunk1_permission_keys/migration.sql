-- Phase 4 Chunk 1 (audit logs): RBAC permission keys + role mappings.
-- Idempotent (INSERT ... ON DUPLICATE KEY): safe on dev, test, e2e, and
-- production (which never runs prisma/seed.ts). Mirrors
-- seedPermissions() — keep both in sync.

INSERT INTO `permissions` (`id`, `key`, `description`) VALUES
  ('perm-chunk1-audit-read', 'audit.read', 'Read own school''s audit logs (School Admin only; Platform Owner uses platform.audit.read)'),
  ('perm-chunk1-platform-audit-read', 'platform.audit.read', 'Read audit logs across all schools (Platform Owner only)')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `roles` r CROSS JOIN `permissions` p
WHERE r.`name` = 'SCHOOL_ADMIN'
  AND p.`key` IN ('audit.read')
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `roles` r CROSS JOIN `permissions` p
WHERE r.`name` = 'PLATFORM_OWNER'
  AND p.`key` IN ('platform.audit.read')
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);
