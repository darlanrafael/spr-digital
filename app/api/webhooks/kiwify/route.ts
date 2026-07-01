import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

const PROJECT_ID = 'proj_1'

function validateToken(req: NextRequest, body: Record<string, unknown>): boolean {
  const order = (body.order as Record<string, unknown>) ?? body
  const signature = (order?.signature as string) ?? (body.signature as string) ?? ''

  // Aceita token correto na URL ou header (para testes manuais via curl)
  const expected = process.env.KIWIFY_WEBHOOK_TOKEN
  if (expected) {
    const fromQuery = new URL(req.url).searchParams.get('token') ?? ''
    const fromHeader = req.headers.get('x-kiwify-token') ?? ''
    if (fromQuery === expected || fromHeader === expected || signature === expected) return true
  }

  // Aceita SEMPRE se a signature é SHA1 válida (40 chars hex) — padrão real da Kiwify
  if (/^[0-9a-f]{40}$/i.test(signature)) return true

  // Se não tem token configurado, aceita tudo
  if (!expected) return true

  return false
}

export async function POST(req: NextRequest) {
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

      const orderId = (order.order_id as string) ?? null

      const sale = {
        id:                 crypto.randomUUID(),
        project_id:         PROJECT_ID,
        plataforma:         'kiwify',
        status:             'aprovada',
        order_id:           orderId,
        data_hora:          (order.approved_date as string)
                              ? new Date(order.approved_date as string).toISOString()
                              : new Date().toISOString(),
        nome:               (customer?.full_name as string) ?? '',
        email:              (customer?.email as string) ?? '',
        telefone:           (customer?.mobile as string) ?? '',
        produto:            (product?.product_name as string) ?? '',
        preco_base:         ((commissions?.product_base_price as number) ?? 0) / 100,
        valor_pago_cliente: ((commissions?.charge_amount as number) ?? 0) / 100,
        valor_com_juros:    ((commissions?.charge_amount as number) ?? 0) / 100,
        valor_liquido:      ((commissions?.my_commission as number) ?? 0) / 100,
        utm_source:         (tracking?.utm_source as string) ?? '',
        utm_medium:         (tracking?.utm_medium as string) ?? '',
        utm_campaign:       (tracking?.utm_campaign as string) ?? '',
        utm_content:        (tracking?.utm_content as string) ?? '',
        utm_term:           (tracking?.utm_term as string) ?? '',
      }

      const client = getSupabaseAdmin()

      if (orderId) {
        const { data: existingRows } = await client
          .from('sales')
          .select('id')
          .eq('order_id', orderId)
          .limit(1)
        if (existingRows && existingRows.length > 0) {
          console.log('[Kiwify Webhook] duplicata ignorada por order_id:', orderId)
          return NextResponse.json({ success: true, event: 'duplicate_ignored' })
        }
      } else {
        const { data: existingRows } = await client
          .from('sales')
          .select('id')
          .eq('plataforma', 'kiwify')
          .eq('email', sale.email)
          .eq('produto', sale.produto)
          .limit(1)
        if (existingRows && existingRows.length > 0) {
          console.log('[Kiwify Webhook] duplicata ignorada por email+produto:', sale.email, sale.produto)
          return NextResponse.json({ success: true, event: 'duplicate_ignored' })
        }
      }

      console.log('[Kiwify Webhook] inserindo venda:', JSON.stringify(sale, null, 2))

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
