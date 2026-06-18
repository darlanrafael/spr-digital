import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { hashSenha, registrarAtividade } from '@/lib/terapeutas-auth'

export async function GET() {
  const client = getSupabaseAdmin()
  const { data, error } = await client
    .from('usuarios_sistema')
    .select('id, nome, email, tipo, terapeuta_id, permissoes, ativo, created_at, terapeutas(nome)')
    .order('nome')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const { nome, email, senha, tipo, terapeuta_id, permissoes } = body as {
    nome: string
    email: string
    senha: string
    tipo: string
    terapeuta_id?: string
    permissoes: Record<string, boolean>
  }

  if (!nome || !email || !senha || !tipo) {
    return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 })
  }

  const client = getSupabaseAdmin()
  const { data, error } = await client.from('usuarios_sistema').insert({
    nome,
    email,
    senha_hash: hashSenha(senha),
    tipo,
    terapeuta_id: terapeuta_id ?? null,
    permissoes: permissoes ?? {},
    ativo: true,
  }).select('id, nome, email, tipo').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await registrarAtividade({
    usuario_nome: 'Admin',
    usuario_tipo: 'admin',
    tipo_acao: 'cadastro_usuario',
    descricao: `Usuário "${nome}" (${tipo}) cadastrado`,
    dados_novos: { nome, email, tipo, terapeuta_id, permissoes },
  })

  return NextResponse.json(data, { status: 201 })
}

export async function PUT(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const { id, nome, email, tipo, terapeuta_id, permissoes, ativo, senha, acao_admin_nome } = body as {
    id: string
    nome?: string
    email?: string
    tipo?: string
    terapeuta_id?: string | null
    permissoes?: Record<string, boolean>
    ativo?: boolean
    senha?: string
    acao_admin_nome?: string
  }

  if (!id) return NextResponse.json({ error: 'ID obrigatório' }, { status: 400 })

  const client = getSupabaseAdmin()
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (nome !== undefined) updates.nome = nome
  if (email !== undefined) updates.email = email
  if (tipo !== undefined) updates.tipo = tipo
  if (terapeuta_id !== undefined) updates.terapeuta_id = terapeuta_id
  if (permissoes !== undefined) updates.permissoes = permissoes
  if (ativo !== undefined) updates.ativo = ativo
  if (senha) updates.senha_hash = hashSenha(senha)

  const { data, error } = await client.from('usuarios_sistema')
    .update(updates).eq('id', id).select('id, nome, email, tipo, ativo').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const tipoAcao = ativo === false ? 'desativacao_usuario' : 'edicao_usuario'
  await registrarAtividade({
    usuario_nome: acao_admin_nome ?? 'Admin',
    usuario_tipo: 'admin',
    tipo_acao: tipoAcao,
    descricao: ativo === false
      ? `Usuário "${data.nome}" desativado`
      : `Usuário "${data.nome}" editado`,
    dados_novos: updates,
  })

  return NextResponse.json(data)
}
