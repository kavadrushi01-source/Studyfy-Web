-- Chunk 2 (subscription & billing): RBAC permission keys + role mappings.
-- Idempotent (INSERT ... ON DUPLICATE KEY): safe on dev, test, e2e, and
-- production (which never runs prisma/seed.ts). Mirrors
-- seedPermissions() — keep both in sync.
-- billing.read goes to the suspended-admin exception path (§13.4): a
-- suspended School Admin keeps billing reads + pay-order, nothing else.

INSERT INTO `permissions` (`id`, `key`, `description`) VALUES
  ('perm-chunk2-platform-billing-manage', 'platform.billing.manage', 'Suspend/reactivate schools, set plans, extend trials, issue invoices, mark paid (Platform Owner only)'),
  ('perm-chunk2-billing-read', 'billing.read', 'Read own school subscription and invoices; pay outstanding invoices (School Admin)')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `roles` r CROSS JOIN `permissions` p
WHERE r.`name` = 'PLATFORM_OWNER'
  AND p.`key` IN ('platform.billing.manage')
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `roles` r CROSS JOIN `permissions` p
WHERE r.`name` = 'SCHOOL_ADMIN'
  AND p.`key` IN ('billing.read')
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);
