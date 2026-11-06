import type { SupabaseClient } from '@supabase/supabase-js'
import { registrarAtividade, calcularComissao, brasiliaLocalToISO } from './terapeutas-auth'
import { criarEventoComMeet } from './google-meet'

// A CRIAÇÃO de um lançamento manual: venda, sessões, evento no Google e log.
//
// Vive aqui, e não dentro da rota, porque desde 09/09/2026 quem dispara isso é
// a APROVAÇÃO do CEO, não mais o comercial. Decisão dele: "toda vez que alguém
// for lançar um agendamento manual precisa ir para aprovação. Eu aprovando, aí
// sim cria o fluxo restante do Meet, prontuário etc."
//
// A rota de lançar passou a só registrar a solicitação e segurar os horários;
// esta função é o que roda depois, uma vez, quando o pedido é aprovado.

export const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000

export type PayloadLancamentoManual = {
  terapeuta_id: string
  nome?: string | null
  email?: string | null
  telefone?: string | null
  produto?: string | null
  plataforma?: string | null
  valor_pago_cliente?: number | null
  valor_liquido?: number | null
  preco_base?: number | null
  data_hora?: string | null
  total_sessoes?: number | null
  sessoes_entregues?: number | null
  proxima_sessao_data?: string | null
  datas_futuras?: string[] | null
  /** Decidida no servidor por prepararPedido. Ver lib/produtos-do-lancamento-manual.ts. */
  oferta_nome?: string | null
  formato_diagnostico?: 1 | 2 | 3 | null
}

export type ResultadoCriacao =
  | { ok: true; saleId: string; sessoesCriadas: number; sessoesPuladas: number; jaExistia?: boolean }
  | { ok: false; erro: string; status: number }

/**
 * O id da venda vem do pedido, e nao do relogio. A chave primaria de `sales`
 * passa a garantir uma venda por pedido, inclusive com dois cliques juntos ou
 * queda no meio da aprovacao. Com id aleatorio, um pedido so virou duas vendas
 * no Gerson (22/10/2026) e na Maisa (06/11/2026), com 1 segundo de diferenca.
 */
export function idDaVendaDoPedido(solicitacaoId: string): string {
  return `manual_${solicitacaoId}`
}

/**
 * A oferta gravada na venda. Pedido antigo, ainda na fila, nao tem o campo: a
 * quantidade pedida vira oferta para o agendamento nao cair na tabela de precos.
 */
export function ofertaDoLancamento(p: PayloadLancamentoManual): string {
  if (p.oferta_nome) return p.oferta_nome
  const total = Math.max(p.total_sessoes ?? 1, 1)
  return `${total} ${total === 1 ? 'sessão' : 'sessões'}`
}

/**
 * As datas das sessões, sem tocar no banco.
 *
 * Separada da gravação porque é ela que precisa ser conferida ANTES: a
 * pré-reserva de horário e a checagem de conflito na aprovação usam
 * exatamente estas datas.
 */
export function datasDoLancamento(p: PayloadLancamentoManual): {
  entregues: string[]
  futuras: string[]
  totalSessoes: number
  erro?: string
} {
  const totalSessoes = Math.max(p.total_sessoes ?? 1, 1)
  const entregues = Math.min(Math.max(p.sessoes_entregues ?? 0, 0), totalSessoes)
  const qtdFuturas = totalSessoes - entregues
  const proximaMs = p.proxima_sessao_data ? new Date(brasiliaLocalToISO(p.proxima_sessao_data)).getTime() : null

  if (proximaMs === null) return { entregues: [], futuras: [], totalSessoes }

  // Sessão marcada como JÁ ENTREGUE não pode cair no futuro. As entregues são
  // contadas de 7 em 7 dias para trás a partir da próxima sessão; com a próxima
  // longe o bastante, a subtração ainda cai no futuro. Caso real (04/09/2026):
  // lançado com próxima em 17/09 e 1 entregue, a conta deu 10/09 - seis dias
  // no futuro. A sessão nascia "entregue", ocupava horário na agenda e contava
  // nas métricas antes de acontecer.
  if (entregues > 0) {
    const maisRecenteEntregue = proximaMs - SETE_DIAS_MS
    if (maisRecenteEntregue > Date.now()) {
      const brt = (ms: number) => new Date(ms - 3 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ')
      return {
        entregues: [], futuras: [], totalSessoes,
        erro: `As sessões já entregues sairiam com data no futuro (a mais recente cairia em ${brt(maisRecenteEntregue)}), porque são contadas de 7 em 7 dias para trás a partir da próxima sessão. Informe a data da próxima sessão mais próxima, ou reduza a quantidade de sessões já entregues.`,
      }
    }
  }

  const listaEntregues: string[] = []
  for (let k = entregues; k >= 1; k--) {
    listaEntregues.push(new Date(proximaMs - k * SETE_DIAS_MS).toISOString())
  }

  const explicitas = p.datas_futuras && p.datas_futuras.length === qtdFuturas
    ? p.datas_futuras.map(d => new Date(brasiliaLocalToISO(d)).toISOString())
    : null
  const listaFuturas: string[] = []
  for (let i = 0; i < qtdFuturas; i++) {
    listaFuturas.push(explicitas ? explicitas[i] : new Date(proximaMs + i * SETE_DIAS_MS).toISOString())
  }

  return { entregues: listaEntregues, futuras: listaFuturas, totalSessoes }
}

/**
 * Monta as linhas de sessao do lancamento manual. PURA de proposito.
 *
 * Estava embutida dentro de `criarLancamentoManual`, que precisa de banco para
 * rodar - e por isso nenhum teste alcancava esta parte. O teste de mutacao de
 * 15/09/2026 mediu a consequencia: o modulo pegava 34% dos defeitos, e entre os
 * que passavam estavam a NUMERACAO das sessoes (`i + 1` e
 * `entregues.length + i + 1`) e a duracao de uma hora do evento no Google.
 *
 * Numerar errado nao quebra nada na hora: a venda e criada, as sessoes
 * aparecem, e so muito depois alguem repara que o pacote tem duas sessoes "1"
 * ou pula da 2 para a 4.
 */
export function montarSessoesDoLancamento(params: {
  saleId: string
  terapeutaId: string
  /** Datas ja passadas, que entram como entregues. */
  entregues: string[]
  /** Datas futuras, que entram como agendadas. */
  futuras: string[]
  totalSessoes: number
  comissaoPorSessao: number
  pacienteNome: string
  pacienteEmail: string
  usuarioNome: string
}) {
  const base = (numero: number, dataIso: string, entregue: boolean) => ({
    sale_id: params.saleId,
    terapeuta_id: params.terapeutaId,
    numero_sessao: numero,
    total_sessoes: params.totalSessoes,
    status: entregue ? 'entregue' : 'agendada',
    status_consulta: entregue ? 'concluida' : 'aguardando',
    data_agendada: dataIso,
    data_entrega: entregue ? dataIso : null,
    link_meet: null,
    comissao_valor: params.comissaoPorSessao,
    comissao_paga: false,
    paciente_nome: params.pacienteNome,
    paciente_email: params.pacienteEmail,
    agendado_por: params.usuarioNome,
    entregue_confirmado_por: entregue ? params.usuarioNome : null,
    vendedor_nome: params.usuarioNome,
    vendedor_email: '',
  })

  // As entregues vem PRIMEIRO e numeram a partir de 1; as futuras continuam a
  // contagem. Trocar a ordem ou o deslocamento gera pacote com numero repetido
  // ou com buraco, e nada reclama na hora.
  return [
    ...params.entregues.map((d, i) => base(i + 1, d, true)),
    ...params.futuras.map((d, i) => base(params.entregues.length + i + 1, d, false)),
  ]
}

/** Uma sessao dura uma hora. Usado para o evento no Google Calendar. */
export function fimDaSessaoISO(inicioISO: string): string {
  return new Date(new Date(inicioISO).getTime() + 60 * 60 * 1000).toISOString()
}

export async function criarLancamentoManual(params: {
  client: SupabaseClient
  solicitacaoId: string
  payload: PayloadLancamentoManual
  usuarioNome: string
  usuarioTipo: string
  /** Trocado no teste: o log real abre o proprio cliente do banco. */
  registrar?: typeof registrarAtividade
}): Promise<ResultadoCriacao> {
  const { client, solicitacaoId, payload: p, usuarioNome, usuarioTipo, registrar = registrarAtividade } = params

  const { data: terapeuta, error: terapErr } = await client
    .from('terapeutas').select('id,percentual_comissao').eq('id', p.terapeuta_id).single()
  if (terapErr || !terapeuta) return { ok: false, erro: 'Terapeuta não encontrado', status: 404 }

  const datas = datasDoLancamento(p)
  if (datas.erro) return { ok: false, erro: datas.erro, status: 400 }

  const saleId = idDaVendaDoPedido(solicitacaoId)
  const { error: saleErr } = await client.from('sales').insert({
    id: saleId,
    project_id: 'proj_1',
    nome: p.nome ?? '',
    email: p.email ?? '',
    telefone: p.telefone ?? '',
    produto: p.produto ?? '',
    plataforma: p.plataforma ?? 'manual',
    valor_pago_cliente: p.valor_pago_cliente ?? 0,
    valor_liquido: p.valor_liquido ?? 0,
    preco_base: p.preco_base ?? p.valor_pago_cliente ?? 0,
    data_hora: p.data_hora ? brasiliaLocalToISO(p.data_hora) : new Date().toISOString(),
    status: 'aprovada',
    oferta_nome: ofertaDoLancamento(p),
  })
  // 23505: a venda deste pedido ja existe, porque outra chamada esta criando ou
  // uma anterior caiu no meio. Nao e erro: segue para completar o que faltar. E
  // so apaga a venda, mais abaixo, quem a criou.
  const vendaJaExistia = (saleErr as { code?: string } | null)?.code === '23505'
  if (saleErr && !vendaJaExistia) return { ok: false, erro: saleErr.message, status: 500 }

  if (vendaJaExistia) {
    const { count, error: contarErr } = await client.from('sessoes').select('id', { count: 'exact', head: true }).eq('sale_id', saleId)
    if (contarErr) return { ok: false, erro: contarErr.message, status: 500 }
    const jaCriadas = count ?? 0
    // Nada a completar. Eventos que tenham faltado ficam como estao: refazer o
    // agendamento recria convite e link.
    if (jaCriadas > 0 || datas.entregues.length + datas.futuras.length === 0) {
      return { ok: true, saleId, sessoesCriadas: jaCriadas, sessoesPuladas: 0, jaExistia: true }
    }
  }

  const { comissao_por_sessao } = calcularComissao({
    valor_liquido: p.valor_liquido ?? 0,
    percentual: terapeuta.percentual_comissao as number,
    numero_sessoes: datas.totalSessoes,
  })

  const sessoes = montarSessoesDoLancamento({
    saleId,
    terapeutaId: p.terapeuta_id,
    entregues: datas.entregues,
    futuras: datas.futuras,
    totalSessoes: datas.totalSessoes,
    comissaoPorSessao: comissao_por_sessao,
    pacienteNome: p.nome ?? '',
    pacienteEmail: p.email ?? '',
    usuarioNome,
  })
  const puladas = sessoes.length === 0 ? datas.totalSessoes : 0

  if (sessoes.length > 0) {
    const { error: insertErr } = await client.from('sessoes').insert(sessoes)
    if (insertErr) {
      // unique (sale_id, numero_sessao): a outra chamada gravou primeiro, e os
      // eventos do Google sao dela.
      if ((insertErr as { code?: string }).code === '23505') {
        return { ok: true, saleId, sessoesCriadas: sessoes.length, sessoesPuladas: 0, jaExistia: true }
      }
      // Sem sessão nenhuma criada, a venda manual fica órfã - melhor remover do
      // que deixar um registro de faturamento sem paciente/sessão associada.
      // A venda de outra chamada não é desta remover.
      if (!vendaJaExistia) await client.from('sales').delete().eq('id', saleId)
      return { ok: false, erro: insertErr.message, status: 500 }
    }
  }

  // Link do Meet só para sessão futura: já entregue não precisa de reunião.
  // Falha aqui não trava - sem credenciais do Google isto é um no-op.
  for (const s of sessoes) {
    if (s.status !== 'agendada') continue
    const evento = await criarEventoComMeet({
      titulo: `Sessão - ${s.paciente_nome}`,
      inicioISO: s.data_agendada,
      fimISO: fimDaSessaoISO(s.data_agendada),
    })
    if (evento) {
      const { error: linkErr } = await client.from('sessoes')
        .update({ link_meet: evento.meetLink, google_event_id: evento.eventId })
        .eq('sale_id', saleId).eq('numero_sessao', s.numero_sessao)
      if (linkErr) console.error('[criar-lancamento-manual] falha ao salvar link_meet:', linkErr)
    }
  }

  await registrar({
    usuario_nome: usuarioNome,
    usuario_tipo: usuarioTipo,
    tipo_acao: 'lancamento_manual',
    sale_id: saleId,
    descricao: `Lançamento manual APROVADO: ${p.nome || '(sem nome)'} — ${datas.entregues.length} entregues + ${datas.futuras.length} futuras de ${datas.totalSessoes} sessões${puladas > 0 ? ` — ${puladas} sessão(ões) não lançada(s) por falta de data de referência` : ''}`,
    dados_novos: {
      nome: p.nome, email: p.email, produto: p.produto,
      valor_pago_cliente: p.valor_pago_cliente, valor_liquido: p.valor_liquido,
      total_sessoes: datas.totalSessoes, sessoes_entregues: datas.entregues.length,
      proxima_sessao_data: p.proxima_sessao_data,
    },
  })

  return { ok: true, saleId, sessoesCriadas: sessoes.length, sessoesPuladas: puladas }
}
