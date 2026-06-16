import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

const PROJECT_ID = 'proj_1'

function validateToken(req: NextRequest, body: Record<string, unknown>): boolean {
  const expected = process.env.KIWIFY_WEBHOOK_TOKEN
  if (!expected) return true

  const fromQuery = new URL(req.url).searchParams.get('token') ?? ''
  const fromHeader = req.headers.get('x-kiwify-token') ?? ''

  // Signature pode estar na raiz (formato real) ou dentro de order{} (formato dos testes)
  const orderObj = (body.order as Record<string, unknown>) ?? body
  const orderSignature = (orderObj?.signature as string) ?? (body.signature as string) ?? ''

  if (fromQuery === expected || fromHeader === expected || orderSignature === expected) return true

  // Webhooks do tipo "Todos que sou produtor" enviam signature SHA1 (40 hex chars) em vez do token fixo
  if (/^[0-9a-f]{40}$/i.test(orderSignature)) return true
  if (/^[0-9a-f]{40}$/i.test((body.signature as string) ?? '')) return true

  return false
}

export async function POST(req: NextRequest) {
  console.log('[Kiwify Debug] url completa:', req.url)
  console.log('[Kiwify Debug] method:', req.method)
  console.log('[Kiwify Debug] headers:', JSON.stringify(Object.fromEntries(req.headers.entries()), null, 2))

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  console.log('[Kiwify Webhook] payload recebido:', JSON.stringify(body, null, 2))

  if (!validateToken(req, body)) {
    console.warn('[Kiwify Webhook] token inválido — rejeitado')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Aceita payload com wrapper order{} (testes) ou na raiz (formato real da Kiwify)
  const order = (body.order as Record<string, unknown>) ?? body

  const eventType = (order.webhook_event_type as string) ?? ''
  console.log('[Kiwify Webhook] evento:', eventType)

  if (eventType === 'order_approved') {
    try {
      const product     = order.Product as Record<string, unknown>
      const customer    = order.Customer as Record<string, unknown>
      const commissions = order.Commissions as Record<string, unknown>
      const tracking    = (order.TrackingParameters as Record<string, unknown>) ?? {}

      const sale = {
        id:                 crypto.randomUUID(),
        project_id:         PROJECT_ID,
        plataforma:         'kiwify',
        status:             'aprovada',
        data_hora:          (order.approved_date as string)
                              ? new Date(order.approved_date as string).toISOString()
                              : new Date().toISOString(),
        nome:               (customer?.full_name as string) ?? '',
        email:              (customer?.email as string) ?? '',
        telefone:           (customer?.mobile as string) ?? '',
        produto:            (product?.product_name as string) ?? '',
        preco_base:         ((commissions?.product_base_price as number) ?? 0) / 100,
        valor_pago_cliente: ((commissions?.charge_amount as number) ?? 0) / 100,
        valor_liquido:      ((commissions?.my_commission as number) ?? 0) / 100,
        utm_source:         (tracking?.utm_source as string) ?? '',
        utm_medium:         (tracking?.utm_medium as string) ?? '',
        utm_campaign:       (tracking?.utm_campaign as string) ?? '',
        utm_content:        (tracking?.utm_content as string) ?? '',
        utm_term:           (tracking?.utm_term as string) ?? '',
      }

      console.log('[Kiwify Webhook] inserindo venda:', JSON.stringify(sale, null, 2))

      const client = getSupabaseAdmin()
      const { error } = await client.from('sales').insert(sale)

      if (error) {
        console.error('[Kiwify Webhook] erro no insert:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      console.log('[Kiwify Webhook] venda salva com sucesso:', sale.id)
      return NextResponse.json({ success: true, event: 'sale_created', id: sale.id })

    } catch (err) {
      console.error('[Kiwify Webhook] exceção ao processar venda:', err)
      return NextResponse.json({ error: String(err) }, { status: 500 })
    }
  }

  if (
    eventType === 'order_refunded' ||
    eventType === 'refunded' ||
    eventType === 'chargeback'
  ) {
    try {
      const customer = order.Customer as Record<string, unknown>
      const email = (customer?.email as string) ?? ''

      if (!email) {
        console.warn('[Kiwify Webhook] reembolso sem email — ignorado')
        return NextResponse.json({ success: true, event: 'ignored' })
      }

      const client = getSupabaseAdmin()
      const { error } = await client
        .from('sales')
        .update({
          status: 'reembolsada',
          data_reembolso: new Date().toISOString().split('T')[0],
        })
        .eq('email', email)
        .eq('plataforma', 'kiwify')
        .eq('status', 'aprovada')

      if (error) {
        console.error('[Kiwify Webhook] erro ao atualizar reembolso:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      console.log('[Kiwify Webhook] reembolso processado para:', email)
      return NextResponse.json({ success: true, event: 'sale_refunded' })

    } catch (err) {
      console.error('[Kiwify Webhook] exceção ao processar reembolso:', err)
      return NextResponse.json({ error: String(err) }, { status: 500 })
    }
  }

  console.log('[Kiwify Webhook] evento ignorado:', eventType)
  return NextResponse.json({ success: true, event: 'ignored', type: eventType })
}
