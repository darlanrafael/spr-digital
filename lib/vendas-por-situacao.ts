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

/**
 * O Diagnóstico Guiado, que não traz nome de terapeuta no produto.
 *
 * As três telas de Pendentes escolhiam de quem é a venda por "o nome do produto
 * contém o primeiro nome do terapeuta". "Diagnóstico Guiado: Programa de
 * acompanhamento Individual" não contém nem "pedro" nem "denise", então a tela
 * do comercial (que abre exceção por este termo) mostrava a venda e o dashboard
 * e a tela do terapeuta não - discordância medida em 03/09/2026 sobre a venda
 * do Francisco Geraldo, R$ 4.997.
 *
 * O pacote é dividido entre os dois terapeutas por formato, mas quem o INICIA é
 * sempre o Pedro: agendar pela venda cria as sessões dos dois. Por isso ele
 * aparece nos Pendentes do Pedro, como a tela dele já fazia.
 */
export const TERMO_DIAGNOSTICO = 'diagnóstico guiado'

export function ehDiagnosticoGuiado(produto: string): boolean {
  return produto.toLowerCase().includes(TERMO_DIAGNOSTICO)
}

/** Se esta venda entra nos Pendentes deste terapeuta, pelo nome do produto. */
export function ehDoTerapeuta(produto: string, primeiroNome: string): boolean {
  if (ehDiagnosticoGuiado(produto)) return primeiroNome.toLowerCase() === 'pedro'
  return produto.toLowerCase().includes(primeiroNome.toLowerCase())
}

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

/**
 * O dinheiro desta venda entrou no caixa e continua lá.
 *
 * É a mesma pergunta que a tela faz para montar a lista de aprovadas
 * (`!status || status === 'aprovada'`), isolada aqui porque a rota de agendar
 * também precisa dela: a comissão soma o líquido das vendas do pacote, e uma
 * filha reembolsada some da tela mas seguia somando na comissão - o terapeuta
 * recebia sobre dinheiro que voltou para o cliente.
 */
export function entrouNoCaixa(status: string | null | undefined): boolean {
  return !status || status === 'aprovada'
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
    // Sai de `vendas`, não de `aprovadas`: uma segunda compra estornada
    // continua com o `pacote_pai_id` gravado e o pacote continua agendado.
    // Filtrando por aprovada, o prontuário do pai perdia o aviso de "pago em
    // mais de uma compra" e o botão de separar, e a filha aparecia na aba de
    // Reembolsos sem nada dizendo que fazia parte de um pacote de 8 sessões.
    // Chargeback de uma das duas parcelas é justamente o motivo pelo qual
    // alguém paga em duas compras. Quem decide se ela vale DINHEIRO é
    // `filhasDoPacote`, em lib/dinheiro-do-pacote.ts, não esta lista.
    filhas: vendas.filter(ehVendaFilha),
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
  'id,email,valor_pago_cliente,valor_liquido,preco_base,produto,data_hora,status,plataforma,valor_com_juros,pacote_pai_id,oferta_nome'
