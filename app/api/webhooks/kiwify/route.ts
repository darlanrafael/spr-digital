import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseClient } from '@/lib/supabase'
import type { SaleStatus } from '@/types'

const PROJECT_ID = 'proj_1'

function validateToken(req: NextRequest): boolean {
  const expected = process.env.KIWIFY_WEBHOOK_TOKEN
  if (!expected) return true
  const fromHeader = req.headers.get('x-kiwify-token') ?? ''
  const fromQuery = new URL(req.url).searchParams.get('token') ?? ''
  return (fromHeader || fromQuery) === expected
}

export async function POST(req: NextRequest) {
  if (!validateToken(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Payload inválido' }, { status: 400 })
  }

  // Detectar event type: campo explícito ou derivado do order_status
  const eventType = String(
    payload.webhook_event_type ?? payload.type ?? payload.order_status ?? ''
  )

  console.log('[Kiwify webhook] evento recebido:', eventType)
  console.log('[Kiwify webhook] payload completo:', JSON.stringify(payload, null, 2))

  try {
    if (eventType === 'order_approved' || eventType === 'paid') {
      await insertKiwifySale(payload)
      return NextResponse.json({ success: true, event: eventType }, { status: 200 })
    }

    if (eventType === 'order_refunded' || eventType === 'refunded') {
      const orderId = String(payload.order_id ?? '')
      if (orderId) {
        const updated = await updateSaleByPlatformId(orderId, 'kiwify', 'reembolsada')
        if (!updated) console.warn('[Kiwify webhook] venda não encontrada para reembolso:', orderId)
        else console.log('[Kiwify webhook] reembolso registrado:', orderId)
      }
      return NextResponse.json({ success: true, event: eventType }, { status: 200 })
    }

    if (eventType === 'chargeback' || eventType === 'chargedback') {
      const orderId = String(payload.order_id ?? '')
      if (orderId) {
        const updated = await updateSaleByPlatformId(orderId, 'kiwify', 'chargeback')
        if (!updated) console.warn('[Kiwify webhook] venda não encontrada para chargeback:', orderId)
        else console.log('[Kiwify webhook] chargeback registrado:', orderId)
      }
      return NextResponse.json({ success: true, event: eventType }, { status: 200 })
    }

    console.log('[Kiwify webhook] evento desconhecido ignorado:', eventType)
    return NextResponse.json({ success: true, event: 'ignored', type: eventType }, { status: 200 })
  } catch (error) {
    console.error('[Kiwify webhook] erro:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function insertKiwifySale(payload: Record<string, unknown>): Promise<void> {
  const client = getSupabaseClient()
  if (!client) return

  const Customer = (payload.Customer ?? payload.customer ?? {}) as Record<string, unknown>
  const Product  = (payload.Product  ?? payload.product  ?? {}) as Record<string, unknown>
  const tracking = (payload.TrackingParameters ?? payload.tracking ?? {}) as Record<string, unknown>

  const precoBase    = Number(Product.base_price  ?? payload.base_price  ?? 0)
  const valorPago    = Number(payload.amount ?? payload.total_amount ?? precoBase)
  const valorLiquido = Number(payload.net_amount ?? payload.liquid_amount ?? 0)

  const { error } = await client.from('sales').insert({
    id:                crypto.randomUUID(),
    project_id:        PROJECT_ID,
    plataforma:        'kiwify',
    plataforma_sale_id: String(payload.order_id ?? ''),
    status:            'aprovada' as SaleStatus,
    data_hora:         String(payload.created_at ?? new Date().toISOString()),
    nome:              String(Customer.full_name ?? Customer.name ?? payload.customer_name ?? ''),
    email:             String(Customer.email ?? payload.customer_email ?? ''),
    telefone:          String(Customer.mobile ?? Customer.phone ?? ''),
    cpf:               String(Customer.cpf ?? '') || null,
    produto:           String(Product.name ?? payload.product_name ?? ''),
    preco_base:        precoBase,
    valor_pago_cliente: valorPago,
    valor_liquido:     valorLiquido,
    utm_source:        (tracking.utm_source  ?? payload.utm_source  ?? null) || null,
    utm_medium:        (tracking.utm_medium  ?? payload.utm_medium  ?? null) || null,
    utm_campaign:      (tracking.utm_campaign ?? payload.utm_campaign ?? null) || null,
    utm_content:       (tracking.utm_content ?? payload.utm_content ?? null) || null,
    utm_term:          (tracking.utm_term    ?? payload.utm_term    ?? null) || null,
  })
  if (error) throw error
  console.log('[Kiwify webhook] venda inserida:', payload.order_id)
}

async function updateSaleByPlatformId(
  platformSaleId: string,
  plataforma: string,
  status: SaleStatus,
): Promise<boolean> {
  const client = getSupabaseClient()
  if (!client) return false

  const { data, error } = await client
    .from('sales')
    .select('id')
    .eq('plataforma_sale_id', platformSaleId)
    .eq('plataforma', plataforma)
    .limit(1)

  if (error || !data || data.length === 0) return false

  const { error: updErr } = await client
    .from('sales')
    .update({
      status,
      data_reembolso: new Date().toISOString().slice(0, 10),
    })
    .eq('id', (data[0] as Record<string, unknown>).id)

  if (updErr) throw updErr
  return true
}
