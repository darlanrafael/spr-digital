import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { lerIdentidade, podeAdministrar } from '@/lib/identidade-da-chamada'
import { validarFunil } from '@/lib/funis/validar-funil'

export const dynamic = 'force-dynamic'

function guard(req: NextRequest) {
  const quem = lerIdentidade(req)
  if (!quem) return { status: 401 as const, error: 'Você precisa entrar no sistema.' }
  if (!podeAdministrar(quem)) return { status: 403 as const, error: 'Só um administrador pode fazer isso.' }
  return null
}

export async function GET(req: NextRequest) {
  const g = guard(req); if (g) return NextResponse.json({ error: g.error }, { status: g.status })
  const sb = getSupabaseAdmin()
  const { data: funis, error } = await sb.from('funis').select('*').order('nome')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const { data: vinculos, error: e2 } = await sb.from('funil_produtos').select('funil_id,plataforma,produto_id')
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })
  const porFunil = new Map<string, { plataforma: string; produto_id: string }[]>()
  for (const v of vinculos ?? []) {
    const arr = porFunil.get(v.funil_id) ?? []; arr.push({ plataforma: v.plataforma, produto_id: v.produto_id }); porFunil.set(v.funil_id, arr)
  }
  return NextResponse.json((funis ?? []).map(f => ({ ...f, produtos: porFunil.get(f.id) ?? [] })))
}

export async function POST(req: NextRequest) {
  const g = guard(req); if (g) return NextResponse.json({ error: g.error }, { status: g.status })
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }
  const v = validarFunil(body)
  if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 })
  const sb = getSupabaseAdmin()
  const { data: funil, error } = await sb.from('funis')
    .insert({ nome: v.funil.nome, termos_campanha: v.funil.termos_campanha }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (v.funil.produtos.length) {
    const linhas = v.funil.produtos.map(p => ({ funil_id: funil.id, plataforma: p.plataforma, produto_id: p.produto_id }))
    const { error: e2 } = await sb.from('funil_produtos').insert(linhas)
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })
  }
  return NextResponse.json({ ...funil, produtos: v.funil.produtos }, { status: 201 })
}
