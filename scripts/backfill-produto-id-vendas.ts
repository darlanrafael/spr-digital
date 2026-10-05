import { getSupabaseAdmin } from '@/lib/supabase'
import { eventoDoWebhook } from '@/lib/evento-do-webhook'
import { parseHublaSale } from '@/lib/hubla-sale'
import { parseKiwifySale } from '@/lib/kiwify-sale'

// Preenche sales.produto_id no historico a partir dos payloads logados em
// webhook_events. Reusa os parsers da ingestao (parseHublaSale/parseKiwifySale),
// entao order_id e produto_id saem EXATAMENTE como na gravacao original, e o
// update casa por order_id exato. Idempotente: so toca vendas com produto_id nulo.
//
// O payload logado e o corpo bruto do webhook; extrair event/order igual as rotas:
//   Hubla: type === 'invoice.payment_succeeded' e event = body.event
//   Kiwify: webhook_event_type === 'order_approved' e order = body.order ?? body

function alvoDoEvento(plataforma: string, body: Record<string, unknown>): { orderId: string; produtoId: string } | null {
  if (plataforma === 'hubla') {
    if (body.type !== 'invoice.payment_succeeded') return null
    if (!body.event) return null
    const event = eventoDoWebhook(plataforma, body)
    const r = parseHublaSale(event)
    if (!r) return null // fatura pai
    const { order_id, produto_id } = r.sale
    return order_id && produto_id ? { orderId: order_id, produtoId: produto_id } : null
  }
  if (plataforma === 'kiwify') {
    const order = eventoDoWebhook(plataforma, body)
    if (order.webhook_event_type !== 'order_approved') return null
    const { order_id, produto_id } = parseKiwifySale(order)
    return order_id && produto_id ? { orderId: order_id, produtoId: produto_id } : null
  }
  return null
}

async function main() {
  const sb = getSupabaseAdmin()
  let preenchidas = 0
  let falhas = 0
  const BATCH = 1000
  for (let from = 0; ; from += BATCH) {
    const { data, error } = await sb.from('webhook_events')
      .select('plataforma,payload')
      .order('created_at', { ascending: true }).order('id', { ascending: true })
      .range(from, from + BATCH - 1)
    if (error) throw error
    if (!data?.length) break
    for (const e of data) {
      const body = e.payload as Record<string, unknown> | null
      if (!body) continue
      let alvo: { orderId: string; produtoId: string } | null
      try {
        alvo = alvoDoEvento(e.plataforma, body)
      } catch (err) {
        falhas++
        console.error('payload nao parseavel:', err)
        continue
      }
      if (!alvo) continue
      const { data: atualizadas, error: upErr } = await sb.from('sales')
        .update({ produto_id: alvo.produtoId })
        .eq('plataforma', e.plataforma)
        .eq('order_id', alvo.orderId)
        .is('produto_id', null)
        .select('id')
      if (upErr) {
        falhas++
        console.error('falha ao atualizar order_id', alvo.orderId, upErr.message)
        continue
      }
      preenchidas += atualizadas?.length ?? 0
    }
    if (data.length < BATCH) break
  }
  console.log('vendas preenchidas com produto_id:', preenchidas)
  console.log('falhas:', falhas)
  if (falhas > 0) process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })
