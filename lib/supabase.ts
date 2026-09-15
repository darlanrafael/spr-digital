import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { fetchComRetry } from './fetch-com-retry'

// TODA consulta passa por um `fetch` que repete falha de CONEXAO.
//
// Causa raiz achada em 14/09/2026: o caminho Vercel -> Supabase falha o
// handshake SSL em torno de 5% das chamadas (Cloudflare 525), espalhado pelo
// dia. Isso derrubou o lembrete de vespera tres noites seguidas e, sem isto,
// atinge qualquer tela do sistema na mesma proporcao.
//
// Fica aqui e nao em cada chamada de proposito: embrulhar consulta a consulta
// depende de alguem lembrar, e quem esquecer nao recebe erro nenhum - so volta
// a falhar em silencio. Ver lib/fetch-com-retry.ts para por que repetir e
// seguro inclusive em escrita.

let supabaseInstance: SupabaseClient | null = null
let supabaseAdminInstance: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient | null {
  if (supabaseInstance) return supabaseInstance
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('Supabase env vars not found — running without database')
    return null
  }
  supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
    global: { fetch: fetchComRetry() },
  })
  return supabaseInstance
}

export function getSupabaseAdmin(): SupabaseClient {
  if (supabaseAdminInstance) return supabaseAdminInstance
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurada — necessária para webhooks')
  }
  supabaseAdminInstance = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: fetchComRetry() },
  })
  return supabaseAdminInstance
}

export const supabase = getSupabaseClient()
