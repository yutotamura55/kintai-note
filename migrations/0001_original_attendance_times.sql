-- Existing values may have been edited. Never backfill them as original punches.
ALTER TABLE attendance_records ADD COLUMN original_clock_in_at TEXT;
ALTER TABLE attendance_records ADD COLUMN original_clock_out_at TEXT;
