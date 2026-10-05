import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { lerIdentidade, podeAdministrar } from '@/lib/identidade-da-chamada'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const quem = lerIdentidade(req)
  if (!quem) return NextResponse.json({ error: 'Você precisa entrar no sistema.' }, { status: 401 })
  if (!podeAdministrar(quem)) return NextResponse.json({ error: 'Só um administrador pode fazer isso.' }, { status: 403 })
  const { data, error } = await getSupabaseAdmin()
    .from('produtos_catalogo').select('id,plataforma,produto_id,nome_exibicao,nomes').order('nome_exibicao')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const quem = lerIdentidade(req)
  if (!quem) return NextResponse.json({ error: 'Você precisa entrar no sistema.' }, { status: 401 })
  if (!podeAdministrar(quem)) return NextResponse.json({ error: 'Só um administrador pode fazer isso.' }, { status: 403 })
  let body: { id?: string; nome_exibicao?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }
  if (!body.id || typeof body.nome_exibicao !== 'string') return NextResponse.json({ error: 'id e nome_exibicao obrigatórios' }, { status: 400 })
  const { data, error } = await getSupabaseAdmin().from('produtos_catalogo')
    .update({ nome_exibicao: body.nome_exibicao, updated_at: new Date().toISOString() }).eq('id', body.id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
