import type { Sale } from '@/types'

// O formato vem da OFERTA da Hubla, nunca do preco nem do nome.
//
// Nome: identico nos tres formatos.
// Preco: valor_pago_cliente varia com parcelamento e juros (Francisco pagou
// R$ 6.201,72 e Bruno R$ 4.997,00 no mesmo formato), e preco_base quebra com
// cupom ou promocao.
// Oferta: estavel. Na Hubla o order_id e "{idDaFatura}-{idDaOferta}".
//
// Aceita varios IDs por formato de proposito: uma oferta nova (promocao, outra
// turma) nasce com ID diferente e precisa caber sem trocar codigo.
export const OFERTAS_DIAGNOSTICO: Record<string, 1 | 2 | 3> = {
  WXwmPZfJxGqeXerA6dkO: 1,
  H8DA8U21x7Lmv3NreVMs: 2,
  qVvads7GKaI7lN1Kctrr: 3,
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
}): SessaoDoPacote[] {
  const { formato, primeiraDataISO, pedroId, deniseId } = params
  const inicio = new Date(primeiraDataISO).getTime()

  return Array.from({ length: formato.totalSessoes }, (_, i) => {
    const doPedro = i < formato.sessoesPedro
    return {
      numero_sessao: i + 1,
      terapeuta_id: doPedro ? pedroId : deniseId,
      data_agendada: new Date(inicio + i * SETE_DIAS_MS).toISOString(),
      comissao_valor: doPedro ? 0 : PAGAMENTO_DENISE_POR_SESSAO,
    }
  })
}
