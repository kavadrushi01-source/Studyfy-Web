-- CreateIndex
CREATE UNIQUE INDEX `timetable_slots_teacher_id_day_of_week_period_key` ON `timetable_slots`(`teacher_id`, `day_of_week`, `period`);
