-- Chunk 4 follow-up (school-side tickets, §7 #27): staff roles gain the
-- existing support keys (no new keys — same read/write pair). Idempotent
-- (INSERT ... ON DUPLICATE KEY): safe on dev, test, e2e, and production.
-- Mirrors seedPermissions() — keep both in sync.

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `roles` r CROSS JOIN `permissions` p
WHERE r.`name` IN ('TEACHER', 'ACCOUNTANT', 'LIBRARIAN', 'TRANSPORT_MANAGER')
  AND p.`key` IN ('support.read', 'support.write')
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);
