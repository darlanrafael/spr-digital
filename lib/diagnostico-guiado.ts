import type { Sale } from '@/types'

// O formato vem da OFERTA da Hubla, nunca do preco nem do nome.
//
// Nome: identico nos tres formatos.
// Preco: nao serve de identificador. Conferido nas 7 vendas reais,
// valor_pago_cliente e preco_base sao iguais em todas do mesmo formato
// (4997 no F1), mas valor_com_juros e valor_liquido variam com parcelamento -
// Francisco fechou 6.201,72 com juros e Bruno 4.997,00 no mesmo Formato 1, e a
// Paula 5.813,20. Filtrar por qualquer campo de valor quebra: os de juros
// variam por venda, e preco_base quebra com cupom ou promocao.
// Oferta: estavel. Na Hubla o order_id e "{idDaFatura}-{idDaOferta}".
//
// Aceita varios IDs por formato de proposito: uma oferta nova (promocao, outra
// turma) nasce com ID diferente e precisa caber sem trocar codigo.
export const OFERTAS_DIAGNOSTICO: Record<string, 1 | 2 | 3> = {
  WXwmPZfJxGqeXerA6dkO: 1,
  H8DA8U21x7Lmv3NreVMs: 2,
  qVvads7GKaI7lN1Kctrr: 3,
}

// Vendas avulsas que sao Diagnostico apesar da oferta dizer outra coisa.
//
// A chave e a VENDA, nunca a oferta. Uma oferta e um link reutilizavel: quando
// o comercial fecha um Diagnostico por engano dentro de outro produto, mapear
// aquela oferta declararia que ela SIGNIFICA Diagnostico, e a proxima venda
// legitima feita pelo mesmo link viraria um pacote de 9 sessoes com a Denise,
// em silencio. A excecao morre com a venda que a originou.
//
// Cada entrada precisa de: quem, quando, por que, e quem confirmou.
export const EXCECOES_DIAGNOSTICO: Record<string, 1 | 2 | 3> = {
  // Paula Caroline, 28/08/2026, R$ 4.997. O Felipe criou uma oferta dentro do
  // produto "Mentoria Particular - Pedro Roncada" (4pv79AgzdiRoWeLm5gyT) e
  // fechou o Diagnostico por ela. Formato confirmado pelo usuario em
  // 02/09/2026 - a oferta nao diz nada aqui, e o preco nao serve de
  // identificador (ela tem valor_com_juros de R$ 5.813,20).
  '27a669a3-dad9-4c8f-ae93-bca82bb13e90': 1,
}

// A oferta "Padrao" (wd6AwMQIJGAekPCGCRsb, R$ 10,00) existe no mesmo produto e
// NAO e mapeada de proposito: nao corresponde a formato nenhum. Compra por ela
// cai no aviso de oferta desconhecida em vez de montar um pacote errado.

/** Regra do PRODUTO, nao da terapeuta: nos demais produtos a Denise segue com os 30%. */
export const PAGAMENTO_DENISE_POR_SESSAO = 95

const SESSOES_POR_FORMATO: Record<1 | 2 | 3, { totalSessoes: number; sessoesPedro: number }> = {
  1: { totalSessoes: 9, sessoesPedro: 2 },
  2: { totalSessoes: 4, sessoesPedro: 1 },
  3: { totalSessoes: 2, sessoesPedro: 1 },
}

export type FormatoDiagnostico = { formato: 1 | 2 | 3; totalSessoes: number; sessoesPedro: number }

/** order_id da Hubla e "{uuidDaFatura}-{idDaOferta}". Devolve so a oferta. */
export function ofertaDoOrderId(orderId?: string | null): string | null {
  if (!orderId) return null
  const partes = String(orderId).split('-')
  return partes.length > 5 ? partes.slice(5).join('-') : null
}

export function formatoDaVenda(sale: Pick<Sale, 'id' | 'order_id'>): FormatoDiagnostico | null {
  // Excecao por venda vem primeiro: e o unico caso em que a oferta esta errada
  // e nao ha o que consultar nela.
  const excecao = sale.id ? EXCECOES_DIAGNOSTICO[sale.id] : undefined
  if (excecao) return { formato: excecao, ...SESSOES_POR_FORMATO[excecao] }

  const oferta = ofertaDoOrderId(sale.order_id)
  if (!oferta) return null
  const formato = OFERTAS_DIAGNOSTICO[oferta]
  if (!formato) return null
  return { formato, ...SESSOES_POR_FORMATO[formato] }
}

export type SessaoDoPacote = {
  numero_sessao: number
  terapeuta_id: string
  data_agendada: string
  comissao_valor: number
}

const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Monta o pacote inteiro a partir de UMA data. O Pedro sempre comeca; a Denise
 * pega o restante. Os 7 dias valem entre todas as sessoes, inclusive na virada
 * de um terapeuta para o outro.
 */
export function montarPacote(params: {
  formato: FormatoDiagnostico
  primeiraDataISO: string
  pedroId: string
  deniseId: string
  /**
   * Datas escolhidas a mao pelo comercial, uma por sessao, na ordem.
   *
   * A regua de 7 dias e o PADRAO, nao uma amarra: o comercial precisa poder
   * acomodar viagem, feriado e indisponibilidade do paciente (decisao do
   * usuario em 02/09/2026, depois de ver a tela funcionando). Quando vem
   * preenchido, manda; quando nao vem, o pacote sai na regua a partir da
   * primeira data.
   *
   * O que NAO e negociavel, e por isso nao entra aqui: a QUANTIDADE de sessoes
   * e QUEM atende cada uma. As duas sao derivadas do formato, e deixar o
   * comercial mexer nelas criaria pacote que o resto do sistema (comissao da
   * Denise, etiqueta de progresso, empurrar as seguintes) nao sabe interpretar.
   */
  datasISO?: string[] | null
}): SessaoDoPacote[] {
  const { formato, primeiraDataISO, pedroId, deniseId, datasISO } = params
  const inicio = new Date(primeiraDataISO).getTime()
  // So aceita a lista se ela cobrir o pacote inteiro. Lista parcial cairia em
  // `undefined` numa das sessoes e gravaria data invalida.
  const explicitas = datasISO && datasISO.length === formato.totalSessoes ? datasISO : null

  return Array.from({ length: formato.totalSessoes }, (_, i) => {
    const doPedro = i < formato.sessoesPedro
    return {
      numero_sessao: i + 1,
      terapeuta_id: doPedro ? pedroId : deniseId,
      data_agendada: explicitas ? explicitas[i] : new Date(inicio + i * SETE_DIAS_MS).toISOString(),
      comissao_valor: doPedro ? 0 : PAGAMENTO_DENISE_POR_SESSAO,
    }
  })
}

/**
 * Pares de sessoes consecutivas cujo intervalo nao e de 7 dias. Serve para a
 * tela AVISAR, nunca para bloquear: fora da regua e escolha legitima do
 * comercial. Devolve o numero da sessao seguinte de cada par, para a mensagem
 * poder dizer "entre a 2 e a 3".
 */
export function intervalosForaDaRegua(datasISO: string[]): number[] {
  const fora: number[] = []
  for (let i = 1; i < datasISO.length; i++) {
    const a = new Date(datasISO[i - 1]).getTime()
    const b = new Date(datasISO[i]).getTime()
    if (Number.isNaN(a) || Number.isNaN(b)) continue
    if (b - a !== SETE_DIAS_MS) fora.push(i + 1)
  }
  return fora
}

/**
 * Diz se mover uma sessao para `novaDataISO` deixa menos de 7 dias entre ela e
 * a sessao anterior ou a seguinte do mesmo pacote. Nao decide nada: quem decide
 * e o comercial, na tela.
 */
export function quebraIntervalo(params: {
  novaDataISO: string
  anteriorISO?: string
  seguinteISO?: string
}): boolean {
  const nova = new Date(params.novaDataISO).getTime()
  if (params.anteriorISO) {
    if (nova - new Date(params.anteriorISO).getTime() < SETE_DIAS_MS) return true
  }
  if (params.seguinteISO) {
    if (new Date(params.seguinteISO).getTime() - nova < SETE_DIAS_MS) return true
  }
  return false
}

/**
 * Datas das sessoes seguintes quando o comercial escolhe empurrar a cadeia.
 * A base e a data NOVA da sessao remarcada, que ja foi salva: por isso ela
 * nunca aparece no resultado.
 */
export function novasDatasSeguintes(params: { baseISO: string; quantidade: number }): string[] {
  const base = new Date(params.baseISO).getTime()
  return Array.from({ length: Math.max(0, params.quantidade) }, (_, i) =>
    new Date(base + (i + 1) * SETE_DIAS_MS).toISOString())
}
