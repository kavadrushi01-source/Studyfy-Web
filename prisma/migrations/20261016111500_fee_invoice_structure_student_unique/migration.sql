-- CreateIndex
CREATE UNIQUE INDEX `fee_invoices_school_id_structure_id_student_id_key` ON `fee_invoices`(`school_id`, `structure_id`, `student_id`);
