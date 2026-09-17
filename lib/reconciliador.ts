import { parseHublaSale, type SaleInsert } from './hubla-sale'
import { parseKiwifySale } from './kiwify-sale'

export type EventoFalho = { plataforma: 'hubla' | 'kiwify'; payload: Record<string, unknown> }

/** Reconstroi a venda do payload de um webhook que falhou. `null` quando o evento
 *  nao gera venda (ex.: fatura pai da Hubla). */
export function reconstruirVenda(ev: EventoFalho): SaleInsert | null {
  if (ev.plataforma === 'hubla') {
    const event = (ev.payload?.event as Record<string, unknown>) ?? {}
    const parsed = parseHublaSale(event)
    return parsed ? parsed.sale : null
  }
  const order = (ev.payload?.order as Record<string, unknown>) ?? ev.payload
  return parseKiwifySale(order)
}

/** Decide quais vendas re-inserir: as que faltam (order_id nao esta em `orderIdsExistentes`).
 *  Vendas sem `order_id` vao para `semOrderId` (nao da pra dedup com seguranca; reportar). */
export function decidirReinsercoes(eventos: EventoFalho[], orderIdsExistentes: Set<string>): { inserir: SaleInsert[]; semOrderId: SaleInsert[] } {
  const inserir: SaleInsert[] = []
  const semOrderId: SaleInsert[] = []
  const vistos = new Set<string>()
  for (const ev of eventos) {
    const sale = reconstruirVenda(ev)
    if (!sale) continue
    if (!sale.order_id) { semOrderId.push(sale); continue }
    if (orderIdsExistentes.has(sale.order_id) || vistos.has(sale.order_id)) continue
    vistos.add(sale.order_id)
    inserir.push(sale)
  }
  return { inserir, semOrderId }
}
