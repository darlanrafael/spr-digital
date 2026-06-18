import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

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
    nome: string
    email: string
    percentual_comissao: number
    ativo: boolean
  }

  if (!id) return NextResponse.json({ error: 'ID obrigatório' }, { status: 400 })

  const client = getSupabaseAdmin()
  const { data, error } = await client.from('terapeutas').update({
    nome, email, percentual_comissao, ativo,
    updated_at: new Date().toISOString(),
  }).eq('id', id).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
