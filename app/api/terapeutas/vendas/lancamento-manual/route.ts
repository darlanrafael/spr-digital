import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarSenhaUsuario, registrarAtividade, calcularComissao, brasiliaLocalToISO } from '@/lib/terapeutas-auth'
import { criarEventoComMeet } from '@/lib/google-meet'

// Cadastro manual de paciente — cria a venda E as sessões numa tacada só,
// pro admin lançar quem já está em atendimento fora do sistema (ex: Pedro,
// calendário que já rodava fora daqui) sem depender de reconciliar contra
// uma venda antiga importada. Preenche os mesmos campos que uma venda real
// da Hubla/Kiwify teria, só que digitados à mão.
//
// A regra de sessões segue exatamente o lançamento retroativo: informa-se a
// última sessão já realizada (número + data) e o sistema preenche as
// anteriores de 7 em 7 dias pra trás como entregues — sessões depois da
// última informada não são criadas até ter uma data real confirmada.
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const {
    terapeuta_id, nome, email, telefone, produto, plataforma,
    valor_pago_cliente, valor_liquido, preco_base, data_hora,
    total_sessoes, ultima_sessao_numero, ultima_sessao_data,
    usuario_email, senha,
  } = body as {
    terapeuta_id: string
    nome: string
    email: string
    telefone?: string
    produto: string
    plataforma: string
    valor_pago_cliente: number
    valor_liquido: number
    preco_base?: number
    data_hora: string
    total_sessoes: number
    ultima_sessao_numero: number
    ultima_sessao_data: string
    usuario_email: string
    senha: string
  }

  if (!terapeuta_id || !nome || !email || !produto || !plataforma || !valor_pago_cliente || !valor_liquido
    || !data_hora || !total_sessoes || !ultima_sessao_numero || !ultima_sessao_data || !usuario_email || !senha) {
    return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 })
  }
  if (ultima_sessao_numero < 1 || ultima_sessao_numero > total_sessoes) {
    return NextResponse.json({ error: 'A última sessão informada precisa estar entre 1 e o total de sessões do pacote' }, { status: 400 })
  }

  const { valido, usuario } = await verificarSenhaUsuario(usuario_email, senha)
  if (!valido) return NextResponse.json({ error: 'Senha inválida' }, { status: 401 })

  const client = getSupabaseAdmin()

  const { data: terapeuta, error: terapErr } = await client
    .from('terapeutas').select('id,percentual_comissao').eq('id', terapeuta_id).single()
  if (terapErr || !terapeuta) return NextResponse.json({ error: 'Terapeuta não encontrado' }, { status: 404 })

  const saleId = `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  const { error: saleErr } = await client.from('sales').insert({
    id: saleId,
    project_id: 'proj_1',
    nome,
    email,
    telefone: telefone ?? '',
    produto,
    plataforma,
    valor_pago_cliente,
    valor_liquido,
    preco_base: preco_base ?? valor_pago_cliente,
    data_hora: brasiliaLocalToISO(data_hora),
    status: 'aprovada',
  })
  if (saleErr) return NextResponse.json({ error: saleErr.message }, { status: 500 })

  const { comissao_por_sessao } = calcularComissao({
    valor_liquido,
    percentual: terapeuta.percentual_comissao as number,
    numero_sessoes: total_sessoes,
  })

  const ultimaDataMs = new Date(brasiliaLocalToISO(ultima_sessao_data)).getTime()
  const nowMs = Date.now()
  const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000
  const usuarioNome = (usuario as Record<string, unknown>)?.nome as string ?? usuario_email

  const sessoes = Array.from({ length: ultima_sessao_numero }, (_, i) => {
    const numero = i + 1
    const dataMs = ultimaDataMs - (ultima_sessao_numero - numero) * SETE_DIAS_MS
    const dataIso = new Date(dataMs).toISOString()
    const entregue = dataMs < nowMs
    return {
      sale_id: saleId,
      terapeuta_id,
      numero_sessao: numero,
      total_sessoes,
      status: entregue ? 'entregue' : 'agendada',
      status_consulta: entregue ? 'concluida' : 'aguardando',
      data_agendada: dataIso,
      data_entrega: entregue ? dataIso : null,
      link_meet: null,
      comissao_valor: comissao_por_sessao,
      comissao_paga: false,
      paciente_nome: nome,
      paciente_email: email,
      agendado_por: usuarioNome,
      entregue_confirmado_por: entregue ? usuarioNome : null,
      vendedor_nome: usuarioNome,
      vendedor_email: usuario_email,
    }
  })

  const { error: insertErr } = await client.from('sessoes').insert(sessoes)
  if (insertErr) {
    // Sem sessão nenhuma criada, a venda manual fica órfã — melhor remover
    // do que deixar um registro de faturamento sem paciente/sessão associada.
    await client.from('sales').delete().eq('id', saleId)
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  // Link do Meet — não trava o lançamento se a API do Google falhar (ver
  // lib/google-meet.ts: sem credenciais configuradas, isso é um no-op).
  // Só faz sentido para sessões futuras (agendadas) — sessões já entregues
  // não precisam de link de reunião.
  for (const s of sessoes) {
    if (s.status !== 'agendada') continue
    const evento = await criarEventoComMeet({
      titulo: `Sessão — ${s.paciente_nome}`,
      inicioISO: s.data_agendada,
      fimISO: new Date(new Date(s.data_agendada).getTime() + 60 * 60 * 1000).toISOString(),
    })
    if (evento) {
      await client.from('sessoes')
        .update({ link_meet: evento.meetLink, google_event_id: evento.eventId })
        .eq('sale_id', saleId).eq('numero_sessao', s.numero_sessao)
    }
  }

  const puladas = total_sessoes - ultima_sessao_numero

  await registrarAtividade({
    usuario_nome: usuarioNome,
    usuario_tipo: (usuario as Record<string, unknown>)?.tipo as string ?? 'admin',
    tipo_acao: 'lancamento_manual',
    sale_id: saleId,
    descricao: `Lançamento manual: ${nome} — ${ultima_sessao_numero} de ${total_sessoes} sessões (última em ${new Date(ultimaDataMs).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })})${puladas > 0 ? ` — ${puladas} sessão(ões) futura(s) não lançada(s) por falta de data confirmada` : ''}`,
    dados_novos: { nome, email, produto, valor_pago_cliente, valor_liquido, total_sessoes, ultima_sessao_numero, ultima_sessao_data },
  })

  return NextResponse.json({ success: true, sale_id: saleId, sessoes_criadas: ultima_sessao_numero, sessoes_puladas: puladas })
}
