export interface Env extends Cloudflare.Env { RP_ID?: string; BOOTSTRAP_TOKEN?: string }

export interface User {
  id: string; employee_code: string; display_name: string; role: 'admin' | 'member'; status: 'invited' | 'active' | 'disabled'
}
