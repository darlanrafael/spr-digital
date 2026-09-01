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
