import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { hashSenhaDashboard } from '@/lib/dashboard-auth'

export async function GET() {
  const client = getSupabaseAdmin()
  const { data, error } = await client
    .from('usuarios_dashboard')
    .select('id, nome, email, role, ativo, created_at')
    .order('nome')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const { nome, email, senha, role } = body as {
    nome: string
    email: string
    senha: string
    role: string
  }

  if (!nome || !email || !senha || !role) {
    return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 })
  }

  const client = getSupabaseAdmin()
  const { data, error } = await client.from('usuarios_dashboard').insert({
    nome,
    email: email.toLowerCase().trim(),
    senha_hash: hashSenhaDashboard(senha),
    role,
    ativo: true,
  }).select('id, nome, email, role').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

export async function PUT(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const { id, nome, email, role, ativo, senha } = body as {
    id: string
    nome?: string
    email?: string
    role?: string
    ativo?: boolean
    senha?: string
  }

  if (!id) return NextResponse.json({ error: 'ID obrigatório' }, { status: 400 })

  const client = getSupabaseAdmin()
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (nome !== undefined) updates.nome = nome
  if (email !== undefined) updates.email = email.toLowerCase().trim()
  if (role !== undefined) updates.role = role
  if (ativo !== undefined) updates.ativo = ativo
  if (senha) updates.senha_hash = hashSenhaDashboard(senha)

  const { data, error } = await client.from('usuarios_dashboard')
    .update(updates).eq('id', id).select('id, nome, email, role, ativo').single()
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
    .from('usuarios_dashboard')
    .update({ senha_hash: hashSenhaDashboard(senha), updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
