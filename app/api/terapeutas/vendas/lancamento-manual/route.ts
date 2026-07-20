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
// Nenhum campo é obrigatório além de terapeuta_id/usuario_email/senha — o
// resto (nome, valores, sessões...) pode ficar incompleto e ser preenchido
// depois pelo prontuário. Informa-se a data da PRÓXIMA sessão: as sessões
// entregues (se houver) são preenchidas de 7 em 7 dias pra trás a partir
// dela, e as sessões futuras (total - entregues) de 7 em 7 dias pra frente
// — sem a data da próxima sessão, nenhuma sessão é criada, só a venda.
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const {
    terapeuta_id, nome, email, telefone, produto, plataforma,
    valor_pago_cliente, valor_liquido, preco_base, data_hora,
    total_sessoes, sessoes_entregues, proxima_sessao_data, datas_futuras,
    usuario_email, senha,
  } = body as {
    terapeuta_id: string
    nome?: string
    email?: string
    telefone?: string
    produto?: string
    plataforma?: string
    valor_pago_cliente?: number
    valor_liquido?: number
    preco_base?: number
    data_hora?: string
    total_sessoes?: number
    sessoes_entregues?: number
    proxima_sessao_data?: string
    datas_futuras?: string[]
    usuario_email: string
    senha: string
  }

  if (!terapeuta_id || !usuario_email || !senha) {
    return NextResponse.json({ error: 'Terapeuta e senha são obrigatórios' }, { status: 400 })
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
    nome: nome ?? '',
    email: email ?? '',
    telefone: telefone ?? '',
    produto: produto ?? '',
    plataforma: plataforma ?? 'manual',
    valor_pago_cliente: valor_pago_cliente ?? 0,
    valor_liquido: valor_liquido ?? 0,
    preco_base: preco_base ?? valor_pago_cliente ?? 0,
    data_hora: data_hora ? brasiliaLocalToISO(data_hora) : new Date().toISOString(),
    status: 'aprovada',
  })
  if (saleErr) return NextResponse.json({ error: saleErr.message }, { status: 500 })

  const totalSessoes = Math.max(total_sessoes ?? 1, 1)
  const entregues = Math.min(Math.max(sessoes_entregues ?? 0, 0), totalSessoes)
  const futuras = totalSessoes - entregues

  const { comissao_por_sessao } = calcularComissao({
    valor_liquido: valor_liquido ?? 0,
    percentual: terapeuta.percentual_comissao as number,
    numero_sessoes: totalSessoes,
  })

  const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000
  const usuarioNome = (usuario as Record<string, unknown>)?.nome as string ?? usuario_email
  const proximaMs = proxima_sessao_data ? new Date(brasiliaLocalToISO(proxima_sessao_data)).getTime() : null

  function baseSessao(numero: number, dataIso: string, entregue: boolean) {
    return {
      sale_id: saleId,
      terapeuta_id,
      numero_sessao: numero,
      total_sessoes: totalSessoes,
      status: entregue ? 'entregue' : 'agendada',
      status_consulta: entregue ? 'concluida' : 'aguardando',
      data_agendada: dataIso,
      data_entrega: entregue ? dataIso : null,
      link_meet: null,
      comissao_valor: comissao_por_sessao,
      comissao_paga: false,
      paciente_nome: nome ?? '',
      paciente_email: email ?? '',
      agendado_por: usuarioNome,
      entregue_confirmado_por: entregue ? usuarioNome : null,
      vendedor_nome: usuarioNome,
      vendedor_email: usuario_email,
    }
  }

  const sessoes: ReturnType<typeof baseSessao>[] = []
  let puladas = 0

  if (proximaMs !== null) {
    // Entregues — de 7 em 7 dias pra trás a partir da próxima sessão.
    for (let k = entregues; k >= 1; k--) {
      const numero = entregues - k + 1
      const dataIso = new Date(proximaMs - k * SETE_DIAS_MS).toISOString()
      sessoes.push(baseSessao(numero, dataIso, true))
    }
    // Futuras — de 7 em 7 dias pra frente a partir da próxima sessão,
    // ou nas datas editadas manualmente se informadas.
    const datasExplicitas = datas_futuras && datas_futuras.length === futuras
      ? datas_futuras.map(d => new Date(brasiliaLocalToISO(d)).toISOString())
      : null
    for (let i = 0; i < futuras; i++) {
      const numero = entregues + i + 1
      const dataIso = datasExplicitas ? datasExplicitas[i] : new Date(proximaMs + i * SETE_DIAS_MS).toISOString()
      sessoes.push(baseSessao(numero, dataIso, false))
    }
  } else {
    // Sem data de referência não dá pra calcular nenhuma sessão — só a
    // venda é criada; o resto entra depois pelo prontuário.
    puladas = totalSessoes
  }

  if (sessoes.length > 0) {
    const { error: insertErr } = await client.from('sessoes').insert(sessoes)
    if (insertErr) {
      // Sem sessão nenhuma criada, a venda manual fica órfã — melhor remover
      // do que deixar um registro de faturamento sem paciente/sessão associada.
      await client.from('sales').delete().eq('id', saleId)
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }
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
      const { error: linkErr } = await client.from('sessoes')
        .update({ link_meet: evento.meetLink, google_event_id: evento.eventId })
        .eq('sale_id', saleId).eq('numero_sessao', s.numero_sessao)
      // Evento já foi criado no Google nesse ponto — se salvar falhar, o
      // evento fica órfão (existe no Calendar mas sem referência no banco).
      // Loga pra dar pra achar/limpar depois; não trava o lançamento.
      if (linkErr) console.error('[lancamento-manual] falha ao salvar link_meet:', linkErr)
    }
  }

  await registrarAtividade({
    usuario_nome: usuarioNome,
    usuario_tipo: (usuario as Record<string, unknown>)?.tipo as string ?? 'admin',
    tipo_acao: 'lancamento_manual',
    sale_id: saleId,
    descricao: `Lançamento manual: ${nome || '(sem nome)'} — ${entregues} entregues + ${futuras} futuras de ${totalSessoes} sessões${proxima_sessao_data ? ` (próxima em ${new Date(proximaMs as number).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })})` : ''}${puladas > 0 ? ` — ${puladas} sessão(ões) não lançada(s) por falta de data de referência` : ''}`,
    dados_novos: { nome, email, produto, valor_pago_cliente, valor_liquido, total_sessoes: totalSessoes, sessoes_entregues: entregues, proxima_sessao_data },
  })

  return NextResponse.json({ success: true, sale_id: saleId, sessoes_criadas: sessoes.length, sessoes_puladas: puladas })
}
