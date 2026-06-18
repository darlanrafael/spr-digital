import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarSenhaUsuario, registrarAtividade } from '@/lib/terapeutas-auth'

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const { sessao_id, nova_data, motivo, usuario_email, senha } = body as {
    sessao_id: string
    nova_data: string
    motivo?: string
    usuario_email: string
    senha: string
  }

  if (!sessao_id || !nova_data || !usuario_email || !senha) {
    return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 })
  }

  const { valido, usuario } = await verificarSenhaUsuario(usuario_email, senha)
  if (!valido) return NextResponse.json({ error: 'Senha inválida' }, { status: 401 })

  const client = getSupabaseAdmin()

  const { data: sessao, error: fetchErr } = await client
    .from('sessoes').select('*').eq('id', sessao_id).single()
  if (fetchErr || !sessao) return NextResponse.json({ error: 'Sessão não encontrada' }, { status: 404 })

  if (sessao.status === 'entregue' || sessao.status === 'cancelada') {
    return NextResponse.json({ error: `Não é possível remarcar sessão com status "${sessao.status}"` }, { status: 400 })
  }

  const usuarioNome = (usuario as Record<string, unknown>)?.nome as string ?? usuario_email

  const { error: updateErr } = await client.from('sessoes').update({
    data_agendada: new Date(nova_data).toISOString(),
    status: 'agendada',
    observacoes: motivo ? `Remarcado: ${motivo}` : sessao.observacoes,
    updated_at: new Date().toISOString(),
  }).eq('id', sessao_id)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  await registrarAtividade({
    usuario_nome: usuarioNome,
    usuario_tipo: (usuario as Record<string, unknown>)?.tipo as string ?? 'comercial',
    tipo_acao: 'remarcacao',
    sessao_id,
    sale_id: sessao.sale_id as string,
    descricao: `Sessão ${sessao.numero_sessao}/${sessao.total_sessoes} de ${sessao.paciente_nome} remarcada para ${new Date(nova_data).toLocaleDateString('pt-BR')}${motivo ? ` — motivo: ${motivo}` : ''}`,
    dados_anteriores: { data_agendada: sessao.data_agendada, status: sessao.status },
    dados_novos: { data_agendada: nova_data, status: 'agendada' },
  })

  return NextResponse.json({ success: true })
}
