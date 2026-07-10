import { getSupabaseAdmin } from '@/lib/supabase'
import * as crypto from 'crypto'

// Salto próprio, diferente do usado em usuarios_sistema (módulo de
// Terapeutas) — sistemas independentes, sem relação entre si.
export function hashSenhaDashboard(senha: string): string {
  return crypto.createHash('sha256').update(senha + 'spr-dashboard-salt-2026').digest('hex')
}

export async function verificarSenhaDashboard(
  email: string,
  senha: string
): Promise<{ valido: boolean; usuario?: { id: string; nome: string; email: string; role: string } }> {
  const client = getSupabaseAdmin()
  const hash = hashSenhaDashboard(senha)
  const { data } = await client
    .from('usuarios_dashboard')
    .select('id,nome,email,role')
    .eq('email', email.toLowerCase().trim())
    .eq('senha_hash', hash)
    .eq('ativo', true)
    .single()
  if (!data) return { valido: false }
  return { valido: true, usuario: data as { id: string; nome: string; email: string; role: string } }
}
