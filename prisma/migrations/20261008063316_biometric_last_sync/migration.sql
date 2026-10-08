-- Phase 3 #21: align the device sync timestamp with the `last_sync_at`
-- name used by the sync endpoint (was `last_seen_at`). Data-preserving.
ALTER TABLE `biometric_devices` RENAME COLUMN `last_seen_at` TO `last_sync_at`;
