import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarAcesso, erroAcesso, registrarAtividade } from '@/lib/terapeutas-auth'

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const { sessao_id, usuario_email, senha, token } = body as {
    sessao_id: string
    usuario_email: string
    senha?: string
    token?: string
  }

  if (!sessao_id || !usuario_email || (!senha && !token)) {
    return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 })
  }

  const acesso = await verificarAcesso({ usuario_email, senha, token })
  const { valido, usuario } = acesso
  if (!valido) {
    const { error, status } = erroAcesso(acesso)
    return NextResponse.json({ error }, { status })
  }

  const client = getSupabaseAdmin()

  const { data: sessao, error: fetchErr } = await client
    .from('sessoes').select('*').eq('id', sessao_id).single()
  if (fetchErr || !sessao) return NextResponse.json({ error: 'Sessão não encontrada' }, { status: 404 })

  if (sessao.status === 'entregue') {
    return NextResponse.json({ error: 'Sessão já confirmada como entregue' }, { status: 400 })
  }

  const usuarioNome = (usuario as Record<string, unknown>)?.nome as string ?? usuario_email

  const { error: updateErr } = await client.from('sessoes').update({
    status: 'entregue',
    data_entrega: new Date().toISOString(),
    entregue_confirmado_por: usuarioNome,
    updated_at: new Date().toISOString(),
  }).eq('id', sessao_id)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  await registrarAtividade({
    usuario_nome: usuarioNome,
    usuario_tipo: (usuario as Record<string, unknown>)?.tipo as string ?? 'terapeuta',
    tipo_acao: 'confirmacao_entrega',
    sessao_id,
    sale_id: sessao.sale_id as string,
    descricao: `Sessão ${sessao.numero_sessao}/${sessao.total_sessoes} confirmada como entregue para ${sessao.paciente_nome}`,
    dados_anteriores: { status: sessao.status },
    dados_novos: { status: 'entregue', data_entrega: new Date().toISOString() },
  })

  return NextResponse.json({ success: true })
}
