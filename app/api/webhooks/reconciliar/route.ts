import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarSecretCron } from '@/lib/whatsapp-pendentes'
import { decidirReinsercoes, type EventoFalho } from '@/lib/reconciliador'
import { alertarReconciliacao, type ResumoReconciliacao } from '@/lib/alerta-reconciliacao'
import { logWebhookEvent } from '@/lib/webhook-log'

const EVENTOS_PAGAMENTO = ['invoice.payment_succeeded', 'order_approved']

export async function POST(req: NextRequest) {
  if (!verificarSecretCron(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const client = getSupabaseAdmin()

  const { data: falhas } = await client
    .from('webhook_events')
    .select('plataforma, tipo_evento, payload')
    .in('resultado', ['insert_error', 'exception'])
    .in('tipo_evento', EVENTOS_PAGAMENTO)
  const eventos: EventoFalho[] = (falhas ?? []).map(f => ({ plataforma: f.plataforma, payload: f.payload as Record<string, unknown> }))

  // order_ids que ja existem, pra nao re-inserir (dedup)
  const { data: existentes } = await client.from('sales').select('order_id').not('order_id', 'is', null)
  const orderIdsExistentes = new Set((existentes ?? []).map(r => r.order_id as string))

  const { inserir, semOrderId } = decidirReinsercoes(eventos, orderIdsExistentes)

  const recuperadas: ResumoReconciliacao['recuperadas'] = []
  const naoRecuperadas: ResumoReconciliacao['naoRecuperadas'] = []
  for (const sale of inserir) {
    const { error } = await client.from('sales').insert(sale)
    if (error) {
      naoRecuperadas.push({ plataforma: sale.plataforma, cliente: sale.nome, produto: sale.produto, motivo: error.message })
      await logWebhookEvent({ plataforma: sale.plataforma as 'hubla' | 'kiwify', tipoEvento: 'reconciliacao', resultado: 'reconcile_insert_error', detalhe: `${sale.order_id}: ${error.message}`, payload: sale })
    } else {
      recuperadas.push({ plataforma: sale.plataforma, cliente: sale.nome, produto: sale.produto, valor: sale.valor_pago_cliente, order_id: sale.order_id as string })
      await logWebhookEvent({ plataforma: sale.plataforma as 'hubla' | 'kiwify', tipoEvento: 'reconciliacao', resultado: 'reconcile_recovered', saleId: sale.id, detalhe: sale.order_id, payload: sale })
    }
  }
  for (const sale of semOrderId) naoRecuperadas.push({ plataforma: sale.plataforma, cliente: sale.nome, produto: sale.produto, motivo: 'payload sem order_id' })

  await alertarReconciliacao({ recuperadas, naoRecuperadas })
  return NextResponse.json({ varridas: eventos.length, recuperadas: recuperadas.length, naoRecuperadas: naoRecuperadas.length })
}
