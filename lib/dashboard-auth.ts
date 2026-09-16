import { getSupabaseAdmin } from '@/lib/supabase'
import * as crypto from 'crypto'
import { gerarCracha } from './cracha'

// Salto próprio, diferente do usado em usuarios_sistema (módulo de
// Terapeutas) — sistemas independentes, sem relação entre si.
export function hashSenhaDashboard(senha: string): string {
  return crypto.createHash('sha256').update(senha + 'spr-dashboard-salt-2026').digest('hex')
}

export async function verificarSenhaDashboard(
  email: string,
  senha: string
): Promise<{ valido: boolean; usuario?: { id: string; nome: string; email: string; role: string; token: string | null } }> {
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

  // Emite o cracha no login. Falha ao gravar NAO derruba o login: a pessoa
  // entra e as telas seguem funcionando como antes - so nao ganha cracha desta
  // vez. Derrubar aqui trocaria um problema pequeno por ninguem conseguir entrar.
  const u = data as { id: string; nome: string; email: string; role: string }
  const { token, expiraEm } = gerarCracha()
  const { error: erroToken } = await client
    .from('usuarios_dashboard')
    .update({ session_token: token, session_token_expira_em: expiraEm })
    .eq('id', u.id)
  if (erroToken) console.error('[dashboard-auth] cracha nao gravado:', erroToken.message)

  return { valido: true, usuario: { ...u, token: erroToken ? null : token } }
}
