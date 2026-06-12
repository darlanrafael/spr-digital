import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseClient } from '@/lib/supabase'
import { findSaleByEmailAndProduct, findSaleByPlatformId, updateSaleStatus } from '@/lib/services'
import type { Sale, SaleStatus } from '@/types'

const PROJECT_ID = 'proj_1'
const debugMode = true // TEMPORÁRIO — desabilitar após diagnóstico

function validateSignature(req: NextRequest): boolean {
  if (debugMode) return true // TEMPORÁRIO — validação desabilitada para debug
  const secret = process.env.HUBLA_WEBHOOK_SECRET
  if (!secret) return true
  const sig =
    req.headers.get('x-hubla-signature') ??
    req.headers.get('authorization')?.replace('Bearer ', '') ??
    req.headers.get('x-webhook-secret') ?? ''
  return sig === secret
}

// ─── Detecção de formato ────────────────────────────────────────────────────

type HublaFormat = 'A' | 'B' | 'C' | 'unknown'

function detectFormat(payload: Record<string, unknown>): HublaFormat {
  const event = payload.event as Record<string, unknown> | undefined
  if (payload.type && event?.userId) return 'A'
  if (payload.type && event?.product) return 'B'
  if (payload.order_id && !payload.type) return 'C'
  return 'unknown'
}

// ─── Handler principal ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Capturar headers para debug
  const debugHeaders: Record<string, string> = {}
  if (debugMode) req.headers.forEach((v, k) => { debugHeaders[k] = v })

  if (!validateSignature(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Payload inválido' }, { status: 400 })
  }

  console.log('[Hubla webhook] payload completo:', JSON.stringify(payload, null, 2))

  const format = detectFormat(payload)
  const eventLabel = String(payload.type ?? payload.order_status ?? 'desconhecido')
  console.log('[Hubla webhook] evento recebido:', eventLabel, '| formato detectado:', format)

  try {
    let result: NextResponse

    if (format === 'A') result = await handleFormatA(payload)
    else if (format === 'B') result = await handleFormatB(payload)
    else if (format === 'C') result = await handleFormatC(payload)
    else {
      console.log('[Hubla webhook] evento desconhecido ignorado:', eventLabel)
      result = NextResponse.json({ success: true, event: 'ignored' }, { status: 200 })
    }

    if (debugMode) {
      const body = await result.json()
      return NextResponse.json({
        ...body,
        debug: {
          formatoDetectado: format,
          evento: eventLabel,
          headersRecebidos: debugHeaders,
          payloadRecebido: payload,
        },
      }, { status: result.status })
    }

    return result
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[Hubla webhook] erro:', msg)
    if (debugMode) {
      return NextResponse.json({
        error: 'Internal server error',
        debug: {
          erroDetalhado: msg,
          formatoDetectado: detectFormat(payload),
          evento: eventLabel,
          headersRecebidos: debugHeaders,
          payloadRecebido: payload,
        },
      }, { status: 500 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ─── Formato A: CanceledSale / InProtestSale ────────────────────────────────

async function handleFormatA(payload: Record<string, unknown>): Promise<NextResponse> {
  const type  = String(payload.type ?? '')
  const event = (payload.event ?? {}) as Record<string, unknown>

  const email      = String(event.userEmail ?? '')
  const produtoNome = String(event.groupName ?? '')

  const statusMap: Record<string, SaleStatus> = {
    CanceledSale:  'cancelada',
    InProtestSale: 'em_protesto',
  }
  const newStatus = statusMap[type]

  if (!newStatus) {
    console.log('[Hubla webhook] Formato A: tipo ignorado:', type)
    return NextResponse.json({ success: true, event: 'ignored' }, { status: 200 })
  }

  const sale = await findSaleByEmailAndProduct(email, produtoNome, 'hubla')
  if (sale) {
    await updateSaleStatus(sale.id, newStatus)
    console.log(`[Hubla webhook] Formato A: status '${newStatus}' para venda:`, sale.id)
  } else {
    console.warn('[Hubla webhook] Formato A: venda não encontrada para', { email, produtoNome })
  }

  return NextResponse.json({ success: true, event: type }, { status: 200 })
}

// ─── Formato B: invoice.payment_succeeded / invoice.refunded ───────────────

async function handleFormatB(payload: Record<string, unknown>): Promise<NextResponse> {
  const type  = String(payload.type ?? '')
  const event = (payload.event ?? {}) as Record<string, unknown>

  if (type === 'invoice.payment_succeeded') {
    const sale = normalizeHublaFormatB(event)
    const client = getSupabaseClient()
    if (client) {
      const { error } = await client.from('sales').insert({
        id:                crypto.randomUUID(),
        project_id:        PROJECT_ID,
        plataforma:        'hubla',
        plataforma_sale_id: sale.plataforma_sale_id ?? null,
        status:            'aprovada' as SaleStatus,
        data_hora:         sale.data_hora,
        nome:              sale.nome,
        email:             sale.email,
        telefone:          sale.telefone,
        cpf:               sale.cpf ?? null,
        produto:           sale.produto,
        preco_base:        sale.preco_base,
        valor_pago_cliente: sale.valor_pago_cliente,
        valor_liquido:     sale.valor_liquido,
        utm_source:        sale.utm_source || null,
        utm_medium:        sale.utm_medium || null,
        utm_campaign:      sale.utm_campaign || null,
        utm_content:       sale.utm_content || null,
        utm_term:          sale.utm_term || null,
      })
      if (error) throw error
      console.log('[Hubla webhook] Formato B: venda inserida:', sale.plataforma_sale_id)
    }
    return NextResponse.json({ success: true, event: type }, { status: 200 })
  }

  if (type === 'invoice.refunded') {
    const saleId = String(event.id ?? event.invoiceId ?? event.saleId ?? '')
    if (saleId) {
      const sale = await findSaleByPlatformId(saleId, 'hubla')
      if (sale) {
        await updateSaleStatus(sale.id, 'reembolsada', new Date().toISOString().slice(0, 10))
        console.log('[Hubla webhook] Formato B: reembolso registrado:', saleId)
      } else {
        console.warn('[Hubla webhook] Formato B: venda não encontrada para reembolso:', saleId)
      }
    }
    return NextResponse.json({ success: true, event: type }, { status: 200 })
  }

  console.log('[Hubla webhook] Formato B: tipo ignorado:', type)
  return NextResponse.json({ success: true, event: 'ignored' }, { status: 200 })
}

function normalizeHublaFormatB(event: Record<string, unknown>): Partial<Sale> & { plataforma_sale_id?: string } {
  const customer = (event.customer ?? event.buyer ?? {}) as Record<string, unknown>
  const product  = (event.product  ?? (event.products as unknown[])?.[0] ?? {}) as Record<string, unknown>

  return {
    plataforma_sale_id: String(event.id ?? event.invoiceId ?? event.saleId ?? ''),
    nome:    String(customer.name  ?? event.userName  ?? ''),
    email:   String(customer.email ?? event.userEmail ?? ''),
    telefone: String(customer.phone ?? event.userPhone ?? ''),
    cpf:     String(customer.document ?? event.userDocument ?? '') || undefined,
    produto: String(product.name ?? (event.products as Array<Record<string, unknown>>)?.[0]?.name ?? ''),
    preco_base:         Number(event.basePrice   ?? event.base_price ?? event.price ?? 0),
    valor_pago_cliente: Number(event.amount      ?? event.totalAmount ?? event.price ?? 0),
    valor_liquido:      Number(event.netAmount   ?? event.liquidAmount ?? event.net_amount ?? 0),
    data_hora:    String(event.createdAt ?? event.created_at ?? new Date().toISOString()),
    utm_source:   String(event.utm_source  ?? event.utmSource  ?? ''),
    utm_medium:   String(event.utm_medium  ?? event.utmMedium  ?? ''),
    utm_campaign: String(event.utm_campaign ?? event.utmCampaign ?? ''),
    utm_content:  String(event.utm_content ?? event.utmContent ?? ''),
    utm_term:     String(event.utm_term    ?? event.utmTerm    ?? ''),
  }
}

// ─── Formato C: payload no estilo Kiwify (order_id + order_status) ──────────

async function handleFormatC(payload: Record<string, unknown>): Promise<NextResponse> {
  const orderStatus = String(payload.order_status ?? '')
  const orderId     = String(payload.order_id ?? '')

  if (orderStatus === 'paid') {
    const client = getSupabaseClient()
    if (client) {
      const Customer = (payload.Customer ?? payload.customer ?? {}) as Record<string, unknown>
      const Product  = (payload.Product  ?? payload.product  ?? {}) as Record<string, unknown>
      const tracking = (payload.TrackingParameters ?? payload.tracking ?? {}) as Record<string, unknown>

      const precoBase    = Number(Product.base_price  ?? payload.base_price  ?? 0)
      const valorPago    = Number(payload.amount ?? payload.total_amount ?? precoBase)
      const valorLiquido = Number(payload.net_amount ?? payload.liquid_amount ?? 0)

      const { error } = await client.from('sales').insert({
        id:                crypto.randomUUID(),
        project_id:        PROJECT_ID,
        plataforma:        'hubla',
        plataforma_sale_id: orderId,
        status:            'aprovada' as SaleStatus,
        data_hora:         String(payload.created_at ?? new Date().toISOString()),
        nome:              String(Customer.full_name ?? Customer.name ?? ''),
        email:             String(Customer.email ?? ''),
        telefone:          String(Customer.mobile ?? Customer.phone ?? ''),
        cpf:               String(Customer.cpf ?? '') || null,
        produto:           String(Product.name ?? ''),
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
      console.log('[Hubla webhook] Formato C: venda inserida:', orderId)
    }
    return NextResponse.json({ success: true, event: orderStatus }, { status: 200 })
  }

  if (orderStatus === 'refunded') {
    if (orderId) {
      const sale = await findSaleByPlatformId(orderId, 'hubla')
      if (sale) {
        await updateSaleStatus(sale.id, 'reembolsada', new Date().toISOString().slice(0, 10))
        console.log('[Hubla webhook] Formato C: reembolso registrado:', orderId)
      } else {
        console.warn('[Hubla webhook] Formato C: venda não encontrada para reembolso:', orderId)
      }
    }
    return NextResponse.json({ success: true, event: orderStatus }, { status: 200 })
  }

  if (orderStatus === 'chargedback') {
    if (orderId) {
      const sale = await findSaleByPlatformId(orderId, 'hubla')
      if (sale) {
        await updateSaleStatus(sale.id, 'chargeback', new Date().toISOString().slice(0, 10))
        console.log('[Hubla webhook] Formato C: chargeback registrado:', orderId)
      } else {
        console.warn('[Hubla webhook] Formato C: venda não encontrada para chargeback:', orderId)
      }
    }
    return NextResponse.json({ success: true, event: orderStatus }, { status: 200 })
  }

  console.log('[Hubla webhook] Formato C: order_status ignorado:', orderStatus)
  return NextResponse.json({ success: true, event: 'ignored', type: orderStatus }, { status: 200 })
}
