-- Deterministic data used only by npm run test:local.
-- Wrangler executes this file with --local, so it never writes to Cloudflare D1.
INSERT INTO users (id, employee_code, display_name, role, status)
VALUES ('local-test-attendance-user', '__local_test_attendance__', 'Local Test User', 'member', 'active')
ON CONFLICT(id) DO UPDATE SET
  employee_code=excluded.employee_code,
  display_name=excluded.display_name,
  role=excluded.role,
  status=excluded.status;

INSERT INTO sessions (id, user_id, expires_at)
VALUES ('local-test-attendance-session', 'local-test-attendance-user', '2030-01-01T00:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at;

INSERT INTO attendance_records (id, user_id, work_date, clock_in_at, clock_out_at, updated_at)
VALUES ('local-test-attendance-record', 'local-test-attendance-user', '2026-09-16', '2026-09-16T00:00:00.000Z', '2026-09-16T09:00:00.000Z', '2026-09-16T09:00:00.000Z')
ON CONFLICT(id) DO UPDATE SET
  clock_in_at=excluded.clock_in_at,
  clock_out_at=excluded.clock_out_at,
  updated_at=excluded.updated_at;
