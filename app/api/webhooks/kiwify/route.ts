import { NextRequest, NextResponse } from 'next/server'
import { addSale, updateSaleStatus } from '@/lib/services'
import type { Sale } from '@/types'

// Kiwify envia eventos: order_approved, order_refunded, order_chargeback
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { event, data } = body

    if (!event || !data) {
      return NextResponse.json({ error: 'Payload inválido' }, { status: 400 })
    }

    if (event === 'order_approved') {
      const sale = normalizeKiwify(data)
      await addSale(sale)
      return NextResponse.json({ received: true, action: 'sale_created' })
    }

    if (event === 'order_refunded') {
      const orderId = data?.order?.id ?? data?.id
      if (orderId) {
        await updateSaleStatus(orderId, 'reembolso', new Date().toISOString().split('T')[0])
      }
      return NextResponse.json({ received: true, action: 'refund_processed' })
    }

    return NextResponse.json({ received: true, action: 'ignored' })
  } catch (err) {
    console.error('[Kiwify webhook]', err)
    return NextResponse.json({ error: 'Erro ao processar webhook' }, { status: 500 })
  }
}

function normalizeKiwify(data: Record<string, unknown>): Sale {
  const order = (data.order ?? data) as Record<string, unknown>
  const customer = (order.customer ?? {}) as Record<string, unknown>
  const utms = (order.utms ?? {}) as Record<string, string>
  const product = (order.product ?? {}) as Record<string, unknown>
  const productId = String(order.product_id ?? product.id ?? 'prod_1')
  const priceRaw = Number(order.amount ?? order.product_price ?? 0)
  const price = priceRaw > 100 ? priceRaw / 100 : priceRaw // centavos → reais

  return {
    id: String(order.id ?? `kiwify_${Date.now()}`),
    nome: String(customer.name ?? customer.full_name ?? ''),
    email: String(customer.email ?? ''),
    telefone: String(customer.phone ?? customer.mobile ?? ''),
    produto: productId,
    plataforma: 'kiwify',
    preco_base: price,
    valor_pago_cliente: price,
    valor_liquido: price * 0.87, // Taxa aproximada Kiwify ~13%
    data_hora: String(order.created_at ?? new Date().toISOString()),
    utm_source: utms.utm_source ?? '',
    utm_medium: utms.utm_medium ?? '',
    utm_campaign: utms.utm_campaign ?? '',
    utm_content: utms.utm_content ?? '',
    utm_term: utms.utm_term ?? '',
    status: 'aprovado',
    projetoId: 'proj_1',
  }
}
