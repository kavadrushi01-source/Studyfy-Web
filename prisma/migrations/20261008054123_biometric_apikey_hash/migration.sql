-- Phase 3 #21: align the device key column with spec §9.1's
-- `api_key_hash` name (was `key_hash`). Data-preserving rename; the
-- unique index follows the column.
ALTER TABLE `biometric_devices` RENAME COLUMN `key_hash` TO `api_key_hash`;
ALTER TABLE `biometric_devices` RENAME INDEX `biometric_devices_key_hash_key` TO `biometric_devices_api_key_hash_key`;
