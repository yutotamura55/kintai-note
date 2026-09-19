-- Removes only the fixed identifiers created by db/seed.local.sql.
DELETE FROM sessions WHERE id = 'local-test-attendance-session';
DELETE FROM attendance_records WHERE user_id = 'local-test-attendance-user';
DELETE FROM users WHERE id = 'local-test-attendance-user';
