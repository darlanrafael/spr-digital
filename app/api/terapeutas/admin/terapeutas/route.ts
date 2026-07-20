import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { hashSenha } from '@/lib/terapeutas-auth'

export async function GET() {
  const client = getSupabaseAdmin()
  const { data, error } = await client
    .from('terapeutas')
    .select('*')
    .order('nome')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const { nome, email, percentual_comissao, ativo } = body as {
    nome: string
    email: string
    percentual_comissao: number
    ativo?: boolean
  }

  if (!nome || !email) {
    return NextResponse.json({ error: 'Nome e email são obrigatórios' }, { status: 400 })
  }

  const client = getSupabaseAdmin()
  const { data, error } = await client.from('terapeutas').insert({
    nome,
    email,
    percentual_comissao: percentual_comissao ?? 30,
    ativo: ativo ?? true,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

export async function PUT(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const { id, nome, email, percentual_comissao, ativo } = body as {
    id: string
    nome?: string
    email?: string
    percentual_comissao?: number
    ativo?: boolean
  }

  if (!id) return NextResponse.json({ error: 'ID obrigatório' }, { status: 400 })

  const client = getSupabaseAdmin()
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (nome !== undefined) updates.nome = nome
  if (email !== undefined) updates.email = email
  if (percentual_comissao !== undefined) updates.percentual_comissao = percentual_comissao
  if (ativo !== undefined) updates.ativo = ativo

  const { data, error } = await client.from('terapeutas').update(updates).eq('id', id).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }
  const { id, senha } = body as { id: string; senha: string }
  if (!id || !senha) return NextResponse.json({ error: 'ID e senha obrigatórios' }, { status: 400 })
  const client = getSupabaseAdmin()
  const { error } = await client
    .from('usuarios_sistema')
    .update({ senha_hash: hashSenha(senha), updated_at: new Date().toISOString() })
    .eq('terapeuta_id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
