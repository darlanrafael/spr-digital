import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarSenhaUsuario } from '@/lib/terapeutas-auth'
import { datasDoLancamento, type PayloadLancamentoManual } from '@/lib/criar-lancamento-manual'
import { avisoDeDuplicata, type VendaExistente } from '@/lib/lancamento-manual-duplicata'
import { buscarConflitosAgenda } from '@/lib/agenda-conflitos'

// Lançamento manual: agora ele PEDE, não faz.
//
// Até 09/09/2026 esta rota criava venda, sessões, evento no Google e comissão
// de uma vez, sem passar por ninguém. Foi por aí que dois problemas reais
// entraram: em 04/08 um lançamento duplicou uma venda de plataforma que já
// existia (mesma paciente, mesmo produto, mesmo valor, dia seguinte), e em
// 04/09 outro criou sessão marcada como "já entregue" com data no futuro,
// ocupando horário na agenda.
//
// Decisão do usuário: "toda vez que alguém for lançar um agendamento manual
// precisa ir para aprovação. Eu aprovando, aí sim cria o fluxo restante do
// Meet, prontuário etc. Não quero deixar o sistema aberto para isso mais."
//
// O que esta rota faz agora, nesta ordem:
//   1. confere que as datas fazem sentido (a mesma trava do caso Buzetti);
//   2. avisa quem está lançando se o paciente JÁ TEM venda do mesmo produto;
//   3. PRÉ-RESERVA os horários futuros com um bloqueio na agenda, para que
//      ninguém marque por cima enquanto o pedido espera;
//   4. grava a solicitação com o payload inteiro.
//
// Nada de venda, sessão ou evento é criado aqui. Ver
// lib/criar-lancamento-manual.ts, que roda na aprovação.
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const { usuario_email, senha, confirmou_duplicata, ...resto } = body as Record<string, unknown> & {
    usuario_email: string; senha: string; confirmou_duplicata?: boolean
  }
  const payload = resto as unknown as PayloadLancamentoManual

  if (!payload.terapeuta_id || !usuario_email || !senha) {
    return NextResponse.json({ error: 'Terapeuta e senha são obrigatórios' }, { status: 400 })
  }

  const { valido, usuario } = await verificarSenhaUsuario(usuario_email, senha)
  if (!valido) return NextResponse.json({ error: 'Senha inválida' }, { status: 401 })

  const client = getSupabaseAdmin()
  const { data: terapeuta, error: terapErr } = await client
    .from('terapeutas').select('id,nome').eq('id', payload.terapeuta_id).single()
  if (terapErr || !terapeuta) return NextResponse.json({ error: 'Terapeuta não encontrado' }, { status: 404 })

  // 1. As datas precisam fazer sentido ANTES de virar pedido: recusar aqui
  // custa um aviso; recusar na aprovação desperdiça a ida e volta inteira.
  const datas = datasDoLancamento(payload)
  if (datas.erro) return NextResponse.json({ error: datas.erro }, { status: 400 })

  // 2. O paciente já tem venda do mesmo produto? Não bloqueia - comprar dois
  // pacotes é legítimo - mas exige que quem lança tenha VISTO antes. O caso da
  // Joicy aconteceu porque essa informação estava no sistema e não na frente
  // de quem decidia.
  const emailPaciente = (payload.email ?? '').trim().toLowerCase()
  let aviso = null as ReturnType<typeof avisoDeDuplicata> | null
  if (emailPaciente) {
    const { data: vendas } = await client
      .from('sales').select('id,produto,valor_pago_cliente,data_hora,status').eq('email', emailPaciente)
    const existentes: VendaExistente[] = []
    for (const v of (vendas ?? []) as unknown as VendaExistente[]) {
      const { count } = await client.from('sessoes').select('*', { count: 'exact', head: true }).eq('sale_id', v.id)
      existentes.push({ ...v, sessoes: count ?? 0 })
    }
    aviso = avisoDeDuplicata({ produto: payload.produto ?? '', vendasDoPaciente: existentes })
    if (aviso.texto && aviso.mesmoProduto.length > 0 && !confirmou_duplicata) {
      return NextResponse.json({
        precisa_confirmar: true, aviso: aviso.texto, vendas_existentes: aviso.mesmoProduto,
      }, { status: 409 })
    }
  }

  // 3. Conflito de horário, antes de reservar. Reservar em cima de sessão
  // existente criaria o problema que a reserva existe para evitar.
  if (datas.futuras.length > 0) {
    const conflitos = await buscarConflitosAgenda({
      terapeuta_id: payload.terapeuta_id, datasISO: datas.futuras,
    })
    if (conflitos.length > 0) {
      return NextResponse.json({
        error: `Horário ocupado: ${conflitos.map(c => c.descricao).join(' | ')}`,
        conflitos,
      }, { status: 409 })
    }
  }

  const usuarioNome = (usuario as Record<string, unknown>)?.nome as string ?? usuario_email

  // 4. PRÉ-RESERVA. Um bloqueio por sessão futura, para ninguém marcar por
  // cima enquanto o pedido espera decisão. Some na aprovação (vira sessão de
  // verdade) e na rejeição (o horário volta a ficar livre).
  const reservas: string[] = []
  for (const dataISO of datas.futuras) {
    const { data: comp, error: compErr } = await client.from('compromissos_terapeuta').insert({
      terapeuta_id: payload.terapeuta_id,
      titulo: `RESERVA - ${payload.nome || 'lançamento manual'} (aguardando aprovação)`,
      inicio: dataISO,
      fim: new Date(new Date(dataISO).getTime() + 60 * 60 * 1000).toISOString(),
      categoria: 'compromisso',
      criado_por_nome: usuarioNome,
      criado_por_tipo: (usuario as Record<string, unknown>)?.tipo as string ?? 'comercial',
      criado_por_email: usuario_email,
    }).select('id').single()
    if (compErr) {
      // Reserva pela metade é pior que reserva nenhuma: desfaz o que já entrou
      // e devolve o erro, para o comercial tentar de novo por inteiro.
      if (reservas.length > 0) await client.from('compromissos_terapeuta').delete().in('id', reservas)
      return NextResponse.json({ error: `Não foi possível reservar o horário: ${compErr.message}` }, { status: 500 })
    }
    reservas.push((comp as { id: string }).id)
  }

  const { data: sol, error: solErr } = await client.from('solicitacoes_lancamento_manual').insert({
    payload,
    paciente_nome: payload.nome ?? null,
    paciente_email: payload.email ?? null,
    produto: payload.produto ?? null,
    valor_pago_cliente: payload.valor_pago_cliente ?? null,
    total_sessoes: datas.totalSessoes,
    sessoes_entregues: datas.entregues.length,
    proxima_sessao_data: datas.futuras[0] ?? null,
    terapeuta_id: payload.terapeuta_id,
    terapeuta_nome: (terapeuta as { nome: string }).nome,
    compromissos_reservados: reservas,
    solicitado_por_nome: usuarioNome,
    solicitado_por_email: usuario_email,
  }).select('id').single()

  if (solErr) {
    // Sem solicitação gravada, a reserva vira bloqueio órfão na agenda: some
    // com ela, senão o horário fica preso sem nada explicando por quê.
    if (reservas.length > 0) await client.from('compromissos_terapeuta').delete().in('id', reservas)
    return NextResponse.json({ error: solErr.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    aguardando_aprovacao: true,
    solicitacao_id: (sol as { id: string }).id,
    horarios_reservados: reservas.length,
    sessoes_previstas: datas.entregues.length + datas.futuras.length,
    aviso: aviso?.texto ?? null,
  })
}
