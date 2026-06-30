import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

const PROJECT_ID = 'proj_1'

function validateToken(req: NextRequest): boolean {
  const secret = process.env.HUBLA_WEBHOOK_SECRET
  if (!secret) return true
  const token =
    req.headers.get('x-hubla-token') ??
    req.headers.get('x-hubla-signature') ??
    req.headers.get('authorization')?.replace('Bearer ', '') ?? ''
  return token === secret
}

export async function POST(req: NextRequest) {
  if (!validateToken(req)) {
    console.warn('[Hubla Webhook] token inválido — rejeitado')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  console.log('[Hubla Webhook] payload recebido:', JSON.stringify(body, null, 2))

  const type = body.type as string
  const event = body.event as Record<string, unknown> | undefined

  if (!event) {
    console.warn('[Hubla Webhook] payload sem campo event — ignorado')
    return NextResponse.json({ success: true, event: 'ignored' })
  }

  if (type === 'invoice.payment_succeeded') {
    try {
      const invoice = event.invoice as Record<string, unknown>

      const hasParentInvoice = !!(invoice?.parentInvoiceId)
      const hasChildInvoices = ((invoice?.childInvoiceIds as unknown[]) ?? []).length > 0
      if (hasChildInvoices && !hasParentInvoice) {
        console.log('[Hubla Webhook] fatura pai ignorada — aguardando webhooks dos produtos filhos')
        return NextResponse.json({ success: true, event: 'parent_invoice_ignored' })
      }

      const payer = invoice?.payer as Record<string, unknown>
      const product = event.product as Record<string, unknown>
      const amount = invoice?.amount as Record<string, unknown>
      const receivers = (invoice?.receivers as Record<string, unknown>[]) ?? []
      const paymentSession = invoice?.paymentSession as Record<string, unknown>
      const utm = (paymentSession?.utm as Record<string, unknown>) ?? {}

      const sellerReceiver = receivers.find((r) => r.role === 'seller')
      const sellerTotalCents = (sellerReceiver?.totalCents as number) ?? 0

      const invoiceId = (invoice?.id as string) ?? null
      const productId = (product?.id as string) ?? null

      // Hubla dispara dois webhooks por produto em pedidos multi-produto (bundle):
      //   offer format:   invoice.id = "{parentId}-offer-N"  →  subtotalCents = preço individual ✅
      //   simples format: invoice.id = "{parentId}"           →  subtotalCents = soma inflada de todos ❌
      // Ambos carregam o mesmo productId. Remove "-offer-N" do invoiceId para obter o canonicalParentId,
      // fazendo offer e simples colidirem no mesmo orderId — permitindo dedup e correção de valor.
      // Produto único legítimo também tem invoice.id sem "-offer-N" mas com valor individual correto;
      // é indistinguível do simples no payload. Por isso usamos offer como autoritativo: se offer
      // chega e já existe uma linha (gravada pelo simples com valor somado/inflado), corrigimos o valor.
      const isOfferFormat = !!invoiceId && /-offer-\d+$/.test(invoiceId)
      const canonicalParentId = invoiceId?.replace(/-offer-\d+$/, '') ?? invoiceId
      const orderId = canonicalParentId && productId ? `${canonicalParentId}-${productId}` : canonicalParentId

      const sale = {
        id:                 crypto.randomUUID(),
        project_id:         PROJECT_ID,
        plataforma:         'hubla',
        status:             'aprovada',
        order_id:           orderId,
        data_hora:          (invoice?.saleDate as string) ?? new Date().toISOString(),
        nome:               `${payer?.firstName ?? ''} ${payer?.lastName ?? ''}`.trim(),
        email:              (payer?.email as string) ?? '',
        telefone:           (payer?.phone as string) ?? '',
        produto:            (product?.name as string) ?? '',
        preco_base:         ((amount?.subtotalCents as number) ?? 0) / 100,
        valor_pago_cliente: ((amount?.subtotalCents as number) ?? 0) / 100,
        valor_liquido:      Math.round(sellerTotalCents) / 100,
        utm_source:         (utm?.source as string) ?? '',
        utm_medium:         (utm?.medium as string) ?? '',
        utm_campaign:       (utm?.campaign as string) ?? '',
        utm_content:        (utm?.content as string) ?? '',
        utm_term:           (utm?.term as string) ?? '',
      }

      const client = getSupabaseAdmin()

      if (orderId) {
        const { data: existingRows } = await client
          .from('sales')
          .select('id')
          .eq('order_id', orderId)
          .limit(1)
        if (existingRows && existingRows.length > 0) {
          if (isOfferFormat) {
            // Offer chegou depois do simples: o simples gravou valor somado/inflado.
            // Offer é sempre autoritativo — atualizar para o valor individual correto.
            const { error: updateError } = await client
              .from('sales')
              .update({
                preco_base:         sale.preco_base,
                valor_pago_cliente: sale.valor_pago_cliente,
                valor_liquido:      sale.valor_liquido,
              })
              .eq('order_id', orderId)
            if (updateError) {
              console.error('[Hubla Webhook] erro ao corrigir valor (offer priority):', updateError)
              return NextResponse.json({ error: updateError.message }, { status: 500 })
            }
            console.log('[Hubla Webhook] valor corrigido para offer individual:', orderId, 'valor:', sale.valor_pago_cliente)
            return NextResponse.json({ success: true, event: 'sale_updated_offer_priority' })
          }
          console.log('[Hubla Webhook] duplicata ignorada por order_id:', orderId)
          return NextResponse.json({ success: true, event: 'duplicate_ignored' })
        }
      } else {
        const { data: existingRows } = await client
          .from('sales')
          .select('id')
          .eq('plataforma', 'hubla')
          .eq('email', sale.email)
          .eq('produto', sale.produto)
          .limit(1)
        if (existingRows && existingRows.length > 0) {
          console.log('[Hubla Webhook] duplicata ignorada por email+produto:', sale.email, sale.produto)
          return NextResponse.json({ success: true, event: 'duplicate_ignored' })
        }
      }

      console.log('[Hubla Webhook] inserindo venda:', JSON.stringify(sale, null, 2))

      const { error } = await client.from('sales').insert(sale)

      if (error) {
        console.error('[Hubla Webhook] erro no insert:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      console.log('[Hubla Webhook] venda salva com sucesso:', sale.id)
      return NextResponse.json({ success: true, event: 'sale_created', id: sale.id })

    } catch (err) {
      console.error('[Hubla Webhook] exceção ao processar pagamento:', err)
      return NextResponse.json({ error: String(err) }, { status: 500 })
    }
  }

  if (type === 'invoice.refunded') {
    try {
      const invoice = event.invoice as Record<string, unknown>
      const payer = invoice?.payer as Record<string, unknown>
      const email = (payer?.email as string) ?? ''

      if (!email) {
        console.warn('[Hubla Webhook] reembolso sem email — ignorado')
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
        .eq('plataforma', 'hubla')
        .eq('status', 'aprovada')

      if (error) {
        console.error('[Hubla Webhook] erro ao atualizar reembolso:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      console.log('[Hubla Webhook] reembolso processado para:', email)
      return NextResponse.json({ success: true, event: 'sale_refunded' })

    } catch (err) {
      console.error('[Hubla Webhook] exceção ao processar reembolso:', err)
      return NextResponse.json({ error: String(err) }, { status: 500 })
    }
  }

  console.log('[Hubla Webhook] evento ignorado:', type)
  return NextResponse.json({ success: true, event: 'ignored', type })
}
