-- Chunk 4 (In-app support/ticketing): support RBAC keys + mappings.
-- Idempotent (INSERT ... ON DUPLICATE KEY): safe on dev, test, e2e, and
-- production (which never runs prisma/seed.ts). Mirrors
-- seedPermissions() — keep both in sync.

INSERT INTO `permissions` (`id`, `key`, `description`) VALUES
  ('perm-chunk4-support-read', 'support.read', 'Read own school support tickets (School Admin; internal notes never shown)'),
  ('perm-chunk4-support-write', 'support.write', 'Open support tickets and reply (School Admin; internal notes stay owner-only)'),
  ('perm-chunk4-tickets-read', 'platform.tickets.read', 'Read support tickets across all schools, internal notes included (Platform Owner only)'),
  ('perm-chunk4-tickets-manage', 'platform.tickets.manage', 'Reply (internal or visible), set status, close support tickets (Platform Owner only)')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `roles` r CROSS JOIN `permissions` p
WHERE r.`name` = 'SCHOOL_ADMIN'
  AND p.`key` IN ('support.read', 'support.write')
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `permissions` p CROSS JOIN `roles` r
WHERE r.`name` = 'PLATFORM_OWNER'
  AND p.`key` IN ('platform.tickets.read', 'platform.tickets.manage')
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);
