-- Rename provider idempotency columns to Razorpay ids (§13.8, §9.1); add payment status. All existing values are NULL (counter-only history), and the new status defaults to CAPTURED which is truthful for every existing received-money row.
ALTER TABLE `fee_payments` RENAME COLUMN `provider_order_id` TO `razorpay_order_id`;
ALTER TABLE `fee_payments` RENAME COLUMN `provider_payment_id` TO `razorpay_payment_id`;
ALTER TABLE `fee_payments` RENAME INDEX `fee_payments_provider_order_id_key` TO `fee_payments_razorpay_order_id_key`;
ALTER TABLE `fee_payments` RENAME INDEX `fee_payments_provider_payment_id_key` TO `fee_payments_razorpay_payment_id_key`;
ALTER TABLE `fee_payments` ADD COLUMN `status` ENUM('PENDING','CAPTURED','FAILED','REFUNDED') NOT NULL DEFAULT 'CAPTURED';
