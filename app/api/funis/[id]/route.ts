import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { lerIdentidade, podeAdministrar } from '@/lib/identidade-da-chamada'
import { validarFunil } from '@/lib/funis/validar-funil'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

function guard(req: NextRequest) {
  const quem = lerIdentidade(req)
  if (!quem) return { status: 401 as const, error: 'Você precisa entrar no sistema.' }
  if (!podeAdministrar(quem)) return { status: 403 as const, error: 'Só um administrador pode fazer isso.' }
  return null
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const g = guard(req); if (g) return NextResponse.json({ error: g.error }, { status: g.status })
  const { id } = await params
  const sb = getSupabaseAdmin()
  const { data: funil, error } = await sb.from('funis').select('*').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!funil) return NextResponse.json({ error: 'Funil não encontrado' }, { status: 404 })
  const { data: vinculos, error: e2 } = await sb.from('funil_produtos').select('plataforma,produto_id').eq('funil_id', id)
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })
  return NextResponse.json({ ...funil, produtos: vinculos ?? [] })
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const g = guard(req); if (g) return NextResponse.json({ error: g.error }, { status: g.status })
  const { id } = await params
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }
  const v = validarFunil(body as never)
  if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 })
  const sb = getSupabaseAdmin()
  const { data: funil, error } = await sb.from('funis')
    .update({ nome: v.funil.nome, termos_campanha: v.funil.termos_campanha, updated_at: new Date().toISOString() })
    .eq('id', id).select().maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!funil) return NextResponse.json({ error: 'Funil não encontrado' }, { status: 404 })
  const { error: e2 } = await sb.from('funil_produtos').delete().eq('funil_id', id)
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })
  if (v.funil.produtos.length) {
    const { error: e3 } = await sb.from('funil_produtos')
      .insert(v.funil.produtos.map(p => ({ funil_id: id, plataforma: p.plataforma, produto_id: p.produto_id })))
    if (e3) return NextResponse.json({ error: e3.message }, { status: 500 })
  }
  return NextResponse.json({ ...funil, produtos: v.funil.produtos })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const g = guard(req); if (g) return NextResponse.json({ error: g.error }, { status: g.status })
  const { id } = await params
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('funis').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
