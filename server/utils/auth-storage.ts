export async function createInitialAdmin(database: D1Database, userId: string, employeeCode: string, displayName: string) {
  const result = await database.prepare(`INSERT INTO users (id, employee_code, display_name, role, status)
    SELECT ?, ?, ?, 'admin', 'active' WHERE NOT EXISTS (SELECT 1 FROM users)`)
    .bind(userId, employeeCode, displayName).run()
  return result.meta.changes === 1
}
