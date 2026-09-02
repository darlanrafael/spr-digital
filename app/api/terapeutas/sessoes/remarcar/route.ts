import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarAcesso, erroAcesso, registrarAtividade, brasiliaLocalToISO, isHojeBrasilia, normalizarTelefoneBR } from '@/lib/terapeutas-auth'
import { buscarConflitosAgenda, mensagemConflito } from '@/lib/agenda-conflitos'
import { criarEventoComMeet, cancelarEvento } from '@/lib/google-meet'
import { notificarEncaixe } from '@/lib/notificar-encaixe'
import { quebraIntervalo, formatoDaVenda } from '@/lib/diagnostico-guiado'

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const { sessao_id, nova_data, motivo, solicitado_por, usuario_email, senha, token } = body as {
    sessao_id: string
    nova_data: string
    motivo?: string
    solicitado_por?: string
    usuario_email: string
    senha?: string
    token?: string
  }

  if (!sessao_id || !nova_data || !usuario_email || (!senha && !token)) {
    return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 })
  }

  // try/catch externo: antes qualquer falha de rede no meio da rota (consulta
  // de vizinhas, Google, prontuário) subia como exceção não tratada e derrubava
  // a remarcação de QUALQUER produto, sem resposta legível pra tela.
  try {
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

  if (sessao.status === 'entregue' || sessao.status === 'cancelada') {
    return NextResponse.json({ error: `Não é possível remarcar sessão com status "${sessao.status}"` }, { status: 400 })
  }

  const usuarioNome = (usuario as Record<string, unknown>)?.nome as string ?? usuario_email

  const novaDataISO = brasiliaLocalToISO(nova_data)

  // Mesma trava do agendar: o horário novo não pode já ter paciente ou
  // compromisso. Ignora a própria sessão — senão remarcar pro mesmo horário
  // (ex: mudando só o dia numa data que ela já ocupa) bateria consigo mesma.
  const conflitos = await buscarConflitosAgenda({
    terapeuta_id: sessao.terapeuta_id as string,
    datasISO: [novaDataISO],
    ignorarSessaoId: sessao_id,
  })
  if (conflitos.length > 0) {
    return NextResponse.json({ error: mensagemConflito(conflitos), conflitos }, { status: 409 })
  }

  // Aviso do intervalo de 7 dias: SÓ pro Diagnóstico Guiado. A régua é regra
  // desse produto, não do sistema - medido no banco em 01/09/2026, 123 pacotes
  // de outros produtos têm 2+ sessões e 41 deles (33%) já têm um par com menos
  // de 7 dias. Enquanto o cálculo era genérico, remarcar uma Mentoria
  // Particular disparava o modal "manter ou empurrar" com frequência, oferecendo
  // ao comercial uma ação que não faz sentido nenhum naquele produto.
  // Não bloqueia nada, quem decide se mantém ou empurra é o comercial, na tela.
  //
  // O erro dessas consultas é engolido de propósito (avisoIntervalo vira null):
  // o aviso é informativo e não pode derrubar a remarcação de NENHUM produto se
  // uma delas falhar. Antes rodavam soltas antes do update, sem try/catch
  // externo, e uma falha de rede aqui virava 500 - a remarcação nem acontecia.
  let avisoIntervalo: string | null = null
  try {
    const { data: venda } = await client
      .from('sales').select('id,order_id').eq('id', sessao.sale_id).maybeSingle()
    if (venda && formatoDaVenda(venda as { id: string; order_id?: string })) {
      // maybeSingle porque a primeira sessão não tem anterior e a última não
      // tem seguinte.
      const numeroSessaoAtual = sessao.numero_sessao as number
      const [{ data: sessaoAnterior }, { data: sessaoSeguinte }] = await Promise.all([
        client.from('sessoes').select('data_agendada')
          .eq('sale_id', sessao.sale_id).eq('numero_sessao', numeroSessaoAtual - 1).maybeSingle(),
        client.from('sessoes').select('data_agendada')
          .eq('sale_id', sessao.sale_id).eq('numero_sessao', numeroSessaoAtual + 1).maybeSingle(),
      ])
      if (quebraIntervalo({
        novaDataISO,
        anteriorISO: sessaoAnterior?.data_agendada ?? undefined,
        seguinteISO: sessaoSeguinte?.data_agendada ?? undefined,
      })) {
        avisoIntervalo = 'Esta data deixa menos de 7 dias entre as sessões. Você pode manter assim ou empurrar as seguintes.'
      }
    }
  } catch (err) {
    console.error('[remarcar] falha ao calcular o aviso de intervalo:', err)
  }

  // A tabela sessoes não tem coluna "observacoes" — motivo/histórico fica
  // só em ocorrencias_prontuario (inserido abaixo). Referenciar uma coluna
  // inexistente aqui fazia esse update falhar com 500 sempre, silenciosamente
  // deixado passar pelo front-end (por isso "remarco e não muda nada").
  const { error: updateErr } = await client.from('sessoes').update({
    data_agendada: novaDataISO,
    status: 'agendada',
    updated_at: new Date().toISOString(),
  }).eq('id', sessao_id)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  // Remarcação cancela o evento antigo e cria um novo — não só atualiza o
  // horário do existente (link continuar "válido" com o horário errado
  // seria pior que não ter link).
  if (sessao.google_event_id) {
    await cancelarEvento(sessao.google_event_id as string)
  }
  const evento = await criarEventoComMeet({
    titulo: `Sessão — ${sessao.paciente_nome}`,
    inicioISO: novaDataISO,
    fimISO: new Date(new Date(novaDataISO).getTime() + 60 * 60 * 1000).toISOString(),
  })
  const { error: linkErr } = await client.from('sessoes')
    .update({
      link_meet: evento?.meetLink ?? null,
      google_event_id: evento?.eventId ?? null,
    })
    .eq('id', sessao_id)
  // Evento novo já foi criado no Google nesse ponto — se salvar falhar, o
  // evento fica órfão (existe no Calendar mas sem referência no banco).
  // Loga pra dar pra achar/limpar depois; não trava a remarcação.
  if (linkErr) console.error('[remarcar] falha ao salvar link_meet:', linkErr)

  // Remarcada pro mesmo dia — "venda de encaixe": alguém preencheu um
  // horário vago de última hora. O fluxo normal de véspera não pega isso.
  if (isHojeBrasilia(novaDataISO)) {
    const { data: terapeutaEncaixe } = await client.from('terapeutas')
      .select('grupo_whatsapp_id').eq('id', sessao.terapeuta_id).single()
    const { data: saleEncaixe } = await client.from('sales')
      .select('telefone').eq('id', sessao.sale_id).single()
    await notificarEncaixe({
      sessao_id,
      terapeuta_id: sessao.terapeuta_id as string,
      grupo_whatsapp_id: terapeutaEncaixe?.grupo_whatsapp_id ?? null,
      paciente_nome: sessao.paciente_nome as string,
      paciente_telefone: normalizarTelefoneBR(saleEncaixe?.telefone ?? null),
      numero_sessao: sessao.numero_sessao as number,
      total_sessoes: sessao.total_sessoes as number,
      data_agendada: novaDataISO,
      link_meet: evento?.meetLink ?? null,
    })
  }

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
    sessao_id,
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

  return NextResponse.json({ success: true, avisoIntervalo })
  } catch (err) {
    console.error('[remarcar]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
