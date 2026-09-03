// Em que lista cada venda cai: Pendentes de Agendamento, Ativos, Filhas de
// outro pacote, Reembolsos.
//
// A regra vive aqui porque TRÊS lugares dependem dela e discordar entre eles é
// invisível: a rota /api/terapeutas/vendas (a tela do comercial), a rota
// /api/terapeutas/dashboard (as sessões e a comissão projetadas do terapeuta) e
// a tela /terapeutas/[id] (o Pendentes que o próprio terapeuta vê). Uma venda
// ligada a outro pacote que continue "pendente" em qualquer um dos três fica
// presa para sempre - as sessões dela estão na venda-pai, e a regra de pendente
// é "venda sem nenhuma sessão".
export type VendaClassificavel = {
  id: string
  produto: string
  status?: string | null
  pacote_pai_id?: string | null
}

export const STATUS_DE_REEMBOLSO = ['reembolsada', 'chargeback', 'cancelada', 'em_protesto']

/** Mentoria em Grupo não é agendamento individual. */
export function ehMentoriaEmGrupo(produto: string): boolean {
  return produto.toLowerCase().includes('grupo')
}

/**
 * Venda que já pertence a outro pacote: foi agendada junto da venda-pai.
 *
 * Caso real: Amanda da Silva Rios, 24 e 25/08/2026, duas ofertas de
 * "Formato - 4 Sessão" somando o pacote de 8.
 */
export function ehVendaFilha(v: VendaClassificavel): boolean {
  return !!v.pacote_pai_id
}

export type ContextoDaVenda<T> = {
  /** A venda tem ao menos uma sessão criada. */
  temSessao: (v: T) => boolean
  /** Passou no corte de `vendas_a_partir_de` do terapeuta. */
  aposCorte?: (v: T) => boolean
}

/** A regra de Pendentes de Agendamento, igual nos três lugares que a usam. */
export function ehPendenteDeAgendamento<T extends VendaClassificavel>(
  v: T, ctx: ContextoDaVenda<T>,
): boolean {
  if (ctx.temSessao(v)) return false
  if (ctx.aposCorte && !ctx.aposCorte(v)) return false
  if (ehMentoriaEmGrupo(v.produto)) return false
  if (ehVendaFilha(v)) return false
  return true
}

export type VendasPorSituacao<T> = {
  aprovadas: T[]
  pendentes: T[]
  ativos: T[]
  /**
   * Vendas ligadas a outro pacote. Saem de Pendentes (já foram agendadas junto)
   * mas PRECISAM chegar na tela: é delas que sai a soma de sessões e de valor do
   * pacote. Sem esta lista, a tela procurava as irmãs dentro de Pendentes - de
   * onde acabaram de ser removidas - e a soma virava código morto.
   */
  filhas: T[]
  reembolsos: T[]
}

export function classificarVendas<T extends VendaClassificavel>(params: {
  vendas: T[]
  aprovada: (v: T) => boolean
} & ContextoDaVenda<T>): VendasPorSituacao<T> {
  const { vendas, aprovada, temSessao, aposCorte } = params
  const aprovadas = vendas.filter(aprovada)
  return {
    aprovadas,
    pendentes: aprovadas.filter(v => ehPendenteDeAgendamento(v, { temSessao, aposCorte })),
    ativos: aprovadas.filter(temSessao),
    filhas: aprovadas.filter(ehVendaFilha),
    reembolsos: vendas.filter(v => STATUS_DE_REEMBOLSO.includes(v.status ?? '')),
  }
}

// As colunas que a tela de vendas precisa de cada venda. Constante porque um
// `select` que esquece uma coluna não dá erro nenhum: o campo chega `undefined`
// e a regra que depende dele apenas para de valer.
//   `oferta_nome`   -> a QUANTIDADE de sessões do pacote
//   `pacote_pai_id` -> esta venda já foi agendada junto de outra
//   `order_id`      -> sem ele, `formatoDaVenda()` nunca reconhece o Diagnóstico
export const COLUNAS_DA_TELA_DE_VENDAS =
  'id,nome,email,telefone,produto,plataforma,valor_pago_cliente,valor_liquido,preco_base,data_hora,status,order_id,oferta_nome,pacote_pai_id'

export const COLUNAS_DO_DASHBOARD =
  'id,email,valor_pago_cliente,valor_liquido,preco_base,produto,data_hora,status,plataforma,valor_com_juros,pacote_pai_id'
