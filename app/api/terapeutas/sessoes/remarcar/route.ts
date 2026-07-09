import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarSenhaUsuario, registrarAtividade, brasiliaLocalToISO } from '@/lib/terapeutas-auth'

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const { sessao_id, nova_data, motivo, solicitado_por, usuario_email, senha } = body as {
    sessao_id: string
    nova_data: string
    motivo?: string
    solicitado_por?: string
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

  const novaDataISO = brasiliaLocalToISO(nova_data)

  const { error: updateErr } = await client.from('sessoes').update({
    data_agendada: novaDataISO,
    status: 'agendada',
    observacoes: motivo ? `Remarcado: ${motivo}` : sessao.observacoes,
    updated_at: new Date().toISOString(),
  }).eq('id', sessao_id)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  const dataAnteriorFmt = sessao.data_agendada
    ? new Date(sessao.data_agendada as string).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    : 'sem data'
  const novaDataFmt = new Date(novaDataISO).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  const usuarioTipo = (usuario as Record<string, unknown>)?.tipo as string ?? 'comercial'
  const descricaoCompleta = `${solicitado_por ? `Solicitado por: ${solicitado_por}. ` : ''}Remarcada de ${dataAnteriorFmt} para ${novaDataFmt}${motivo ? `. Motivo: ${motivo}` : ''}`

  // Insere no histórico visível do prontuário (aba "Ocorrências") — antes só
  // o front-end fingia isso via um POST solto que nunca chamava esse
  // endpoint, então a sessão nunca era realmente atualizada.
  await client.from('ocorrencias_prontuario').insert({
    sale_id: sessao.sale_id,
    tipo: 'remarcacao',
    titulo: `Remarcação — Sessão ${sessao.numero_sessao}`,
    descricao: descricaoCompleta,
    dados_extras: { sessao_id, motivo: motivo ?? null, solicitado_por: solicitado_por ?? null, data_anterior: sessao.data_agendada, nova_data: novaDataISO },
    criado_por_nome: usuarioNome,
    criado_por_tipo: usuarioTipo,
    criado_por_email: usuario_email,
  })

  await registrarAtividade({
    usuario_nome: usuarioNome,
    usuario_tipo: usuarioTipo,
    tipo_acao: 'remarcacao',
    sessao_id,
    sale_id: sessao.sale_id as string,
    descricao: `Sessão ${sessao.numero_sessao}/${sessao.total_sessoes} de ${sessao.paciente_nome} remarcada de ${dataAnteriorFmt} para ${novaDataFmt}${motivo ? ` — motivo: ${motivo}` : ''}`,
    dados_anteriores: { data_agendada: sessao.data_agendada, status: sessao.status },
    dados_novos: { data_agendada: novaDataISO, status: 'agendada' },
  })

  return NextResponse.json({ success: true })
}
