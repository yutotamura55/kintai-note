export interface Env { DB: D1Database; RP_ID?: string; BOOTSTRAP_TOKEN?: string }

export interface User {
  id: string; employee_code: string; display_name: string; role: 'admin' | 'member'; status: 'invited' | 'active' | 'disabled'
}
