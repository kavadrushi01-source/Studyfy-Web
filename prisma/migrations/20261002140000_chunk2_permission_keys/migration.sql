-- Chunk 2 (CRM + certificates): new RBAC permission keys + role mappings.
-- Idempotent (INSERT ... ON DUPLICATE KEY): safe to apply on dev, test,
-- e2e, and production (which never runs prisma/seed.ts). Mirrors
-- seedPermissions() in prisma/seed.ts — keep both in sync.

INSERT INTO `permissions` (`id`, `key`, `description`) VALUES
  ('perm-chunk2-crm-read', 'crm.read', 'Read the admission enquiry pipeline (School Admin, Accountant)'),
  ('perm-chunk2-crm-manage', 'crm.manage', 'Work the pipeline: statuses, assignees, follow-up notes (School Admin)'),
  ('perm-chunk2-certificates-read', 'certificates.read', 'Read issued certificates (School Admin, Accountant)'),
  ('perm-chunk2-certificates-manage', 'certificates.manage', 'Issue certificates (School Admin, Accountant)')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `roles` r CROSS JOIN `permissions` p
WHERE r.`name` = 'SCHOOL_ADMIN'
  AND p.`key` IN ('crm.read', 'crm.manage', 'certificates.read', 'certificates.manage')
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `roles` r CROSS JOIN `permissions` p
WHERE r.`name` = 'ACCOUNTANT'
  AND p.`key` IN ('crm.read', 'certificates.read', 'certificates.manage')
ON DUPLICATE KEY UPDATE `role_id` = VALUES(`role_id`);
