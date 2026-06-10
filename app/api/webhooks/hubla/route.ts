import { NextRequest, NextResponse } from 'next/server'
import { addSale, updateSaleStatus } from '@/lib/services'
import type { Sale } from '@/types'

// Hubla envia eventos: PAYMENT_PAID, REFUND, CHARGEBACK
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { event, data } = body

    if (!event || !data) {
      return NextResponse.json({ error: 'Payload inválido' }, { status: 400 })
    }

    if (event === 'PAYMENT_PAID') {
      const sale = normalizeHubla(data)
      await addSale(sale)
      return NextResponse.json({ received: true, action: 'sale_created' })
    }

    if (event === 'REFUND') {
      const orderId = data?.payment?.id ?? data?.id
      if (orderId) {
        await updateSaleStatus(String(orderId), 'reembolso', new Date().toISOString().split('T')[0])
      }
      return NextResponse.json({ received: true, action: 'refund_processed' })
    }

    if (event === 'CHARGEBACK') {
      const orderId = data?.payment?.id ?? data?.id
      if (orderId) {
        await updateSaleStatus(String(orderId), 'reembolso', new Date().toISOString().split('T')[0])
      }
      return NextResponse.json({ received: true, action: 'chargeback_processed' })
    }

    return NextResponse.json({ received: true, action: 'ignored' })
  } catch (err) {
    console.error('[Hubla webhook]', err)
    return NextResponse.json({ error: 'Erro ao processar webhook' }, { status: 500 })
  }
}

function normalizeHubla(data: Record<string, unknown>): Sale {
  const payment = (data.payment ?? data) as Record<string, unknown>
  const buyer = (payment.buyer ?? data.buyer ?? {}) as Record<string, unknown>
  const product = (payment.product ?? data.product ?? {}) as Record<string, unknown>
  const utms = (payment.utms ?? data.utms ?? {}) as Record<string, string>
  const priceRaw = Number(payment.amount ?? payment.price ?? product.price ?? 0)
  const price = priceRaw > 100 ? priceRaw / 100 : priceRaw

  return {
    id: String(payment.id ?? `hubla_${Date.now()}`),
    nome: String(buyer.name ?? buyer.full_name ?? ''),
    email: String(buyer.email ?? ''),
    telefone: String(buyer.phone ?? buyer.mobile ?? ''),
    produto: String(product.id ?? product.external_id ?? 'prod_2'),
    plataforma: 'hubla',
    preco_base: price,
    valor_pago_cliente: price,
    valor_liquido: price * 0.87, // Taxa aproximada Hubla ~13%
    data_hora: String(payment.created_at ?? payment.paid_at ?? new Date().toISOString()),
    utm_source: utms.utm_source ?? '',
    utm_medium: utms.utm_medium ?? '',
    utm_campaign: utms.utm_campaign ?? '',
    utm_content: utms.utm_content ?? '',
    utm_term: utms.utm_term ?? '',
    status: 'aprovado',
    projetoId: 'proj_1',
  }
}
