-- Break interval accumulation and manual override.
ALTER TABLE attendance_records ADD COLUMN break_started_at TEXT;
ALTER TABLE attendance_records ADD COLUMN total_break_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attendance_records ADD COLUMN original_total_break_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attendance_records ADD COLUMN break_minutes INTEGER;
