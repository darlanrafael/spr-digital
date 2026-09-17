import { parseHublaSale, type SaleInsert } from './hubla-sale'
import { parseKiwifySale } from './kiwify-sale'

// `id` e o id da linha em `webhook_events` (o evento falho original) - o
// route usa ele pra marcar a linha como tratada depois de decidir o que
// fazer com ela, pra ela nao ser varrida de novo na proxima rodada.
export type EventoFalho = { id: string; plataforma: 'hubla' | 'kiwify'; payload: Record<string, unknown> }

/** Uma venda reconstruida, presa ao evento de origem (pro route marcar a
 *  linha certa em `webhook_events` depois de decidir o que fazer). */
export type CandidatoReinsercao = { eventoId: string; sale: SaleInsert }

/** Um evento cujo parse lancou excecao (ex.: Kiwify com `approved_date`
 *  invalida faz `new Date(...).toISOString()` lancar `RangeError`). Guarda
 *  so a plataforma (nao depende do parse) e o motivo, pra reportar sem
 *  derrubar o resto do lote. */
export type EventoComErro = { eventoId: string; plataforma: 'hubla' | 'kiwify'; motivo: string }

/** Reconstroi a venda do payload de um webhook que falhou. `null` quando o evento
 *  nao gera venda (ex.: fatura pai da Hubla). Pode LANCAR (payload malformado -
 *  ex.: data invalida na Kiwify); quem chama em lote precisa isolar por evento
 *  (ver `decidirReinsercoes`), senao um payload ruim derruba o lote inteiro. */
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
 *  Vendas sem `order_id` vao para `semOrderId` (nao da pra dedup com seguranca; reportar).
 *  Evento cujo parse lanca vai para `erros`, sem interromper os demais do lote. */
export function decidirReinsercoes(eventos: EventoFalho[], orderIdsExistentes: Set<string>): { inserir: CandidatoReinsercao[]; semOrderId: CandidatoReinsercao[]; erros: EventoComErro[] } {
  const inserir: CandidatoReinsercao[] = []
  const semOrderId: CandidatoReinsercao[] = []
  const erros: EventoComErro[] = []
  const vistos = new Set<string>()
  for (const ev of eventos) {
    let sale: SaleInsert | null
    try {
      sale = reconstruirVenda(ev)
    } catch (err) {
      erros.push({ eventoId: ev.id, plataforma: ev.plataforma, motivo: err instanceof Error ? err.message : String(err) })
      continue
    }
    if (!sale) continue
    if (!sale.order_id) { semOrderId.push({ eventoId: ev.id, sale }); continue }
    if (orderIdsExistentes.has(sale.order_id) || vistos.has(sale.order_id)) continue
    vistos.add(sale.order_id)
    inserir.push({ eventoId: ev.id, sale })
  }
  return { inserir, semOrderId, erros }
}
