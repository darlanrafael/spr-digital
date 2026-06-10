import { NextRequest, NextResponse } from 'next/server'
import { addSale, updateSaleStatus } from '@/lib/services'
import type { Sale } from '@/types'

const PROJECT_ID = 'proj_1'

// UTC → UTC-3 (Brasília), sem timezone no string final
function toBRT(isoString: string): string {
  try {
    const date = new Date(isoString)
    const brt = new Date(date.getTime() - 3 * 60 * 60 * 1000)
    return brt.toISOString().slice(0, 19)
  } catch {
    return new Date().toISOString().slice(0, 19)
  }
}

// Converte centavos para reais quando necessário
function toReais(raw: unknown): number {
  const n = Number(raw ?? 0)
  if (Number.isInteger(n) && n > 10000) return n / 100
  return n
}

function validateToken(req: NextRequest): boolean {
  const expected = process.env.KIWIFY_WEBHOOK_TOKEN
  if (!expected) return true // sem token configurado, permite tudo (dev)
  const received = req.nextUrl.searchParams.get('token') ?? ''
  return received === expected
}

export async function POST(req: NextRequest) {
  if (!validateToken(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Payload inválido' }, { status: 400 })
  }

  // Kiwify pode enviar { event, data } ou campos diretamente no root
  const event = String(body.event ?? body.webhook_event_type ?? '')
  const data  = (body.data ?? body) as Record<string, unknown>

  console.log('[Kiwify webhook] evento recebido:', event, JSON.stringify(body).slice(0, 300))

  try {
    if (event === 'order.approved') {
      const sale = normalizeKiwify(data)
      await addSale(sale)
      console.log('[Kiwify webhook] venda inserida:', sale.id)
      return NextResponse.json({ success: true, action: 'sale_created' })
    }

    if (event === 'order.refunded') {
      const id = getSaleId(data)
      if (id) {
        await updateSaleStatus(id, 'reembolso', todayBRT())
        console.log('[Kiwify webhook] reembolso registrado:', id)
      }
      return NextResponse.json({ success: true, action: 'refund_processed' })
    }

    if (event === 'order.chargedback') {
      const id = getSaleId(data)
      if (id) {
        await updateSaleStatus(id, 'reembolso', todayBRT())
        console.log('[Kiwify webhook] chargeback registrado:', id)
      }
      return NextResponse.json({ success: true, action: 'chargeback_processed' })
    }

    // Evento desconhecido — retornar 200 para a plataforma não reenviar
    console.log('[Kiwify webhook] evento ignorado:', event)
    return NextResponse.json({ success: true, action: 'ignored' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Kiwify webhook] erro ao processar:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

function getSaleId(data: Record<string, unknown>): string | null {
  const order = (data.order ?? data) as Record<string, unknown>
  const id = order.id ?? order.order_id ?? data.id
  return id ? String(id) : null
}

function todayBRT(): string {
  return toBRT(new Date().toISOString()).slice(0, 10)
}

function normalizeKiwify(data: Record<string, unknown>): Sale {
  const order    = (data.order    ?? data)                       as Record<string, unknown>
  const customer = (order.Customer ?? order.customer ?? data.Customer ?? data.customer ?? {}) as Record<string, unknown>
  const product  = (order.Product  ?? order.product  ?? data.Product  ?? data.product  ?? {}) as Record<string, unknown>
  const utms     = (order.TrackingParameters ?? order.tracking_parameters ?? order.utms ?? data.utms ?? {}) as Record<string, string>

  const saleId      = String(order.id ?? order.order_id ?? data.id ?? `kiwify_${Date.now()}`)
  const nome        = String(customer.full_name ?? customer.name ?? customer.nome ?? '')
  const email       = String(customer.email ?? '')
  const telefone    = String(customer.mobile ?? customer.phone ?? customer.telefone ?? '')
  const produtoNome = String(product.name ?? product.nome ?? product.product_name ?? order.product_name ?? 'Produto Kiwify')

  const valorBase    = toReais(product.base_price ?? order.product_base_price ?? order.product_price ?? 0)
  const valorPago    = toReais(order.amount ?? order.total_amount ?? order.order_value ?? valorBase)
  const valorLiquido = toReais(order.net_amount ?? order.commission_as_producer ?? valorPago * 0.87)

  const dataHora = toBRT(String(order.created_at ?? order.approved_date ?? data.created_at ?? new Date().toISOString()))

  return {
    id: saleId,
    nome,
    email,
    telefone,
    produto: produtoNome,
    plataforma: 'kiwify',
    preco_base: valorBase || valorPago,
    valor_pago_cliente: valorPago,
    valor_liquido: valorLiquido,
    data_hora: dataHora,
    utm_source:   utms.utm_source   ?? utms.src ?? '',
    utm_medium:   utms.utm_medium   ?? utms.medium ?? '',
    utm_campaign: utms.utm_campaign ?? utms.campaign ?? '',
    utm_content:  utms.utm_content  ?? utms.content ?? '',
    utm_term:     utms.utm_term     ?? utms.term ?? '',
    status: 'aprovado',
    projetoId: PROJECT_ID,
  }
}
