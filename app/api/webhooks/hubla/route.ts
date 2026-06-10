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

function validateSignature(req: NextRequest): boolean {
  const secret = process.env.HUBLA_WEBHOOK_SECRET
  if (!secret) return true // sem secret configurado, permite tudo (dev)
  const sig =
    req.headers.get('x-hubla-signature') ??
    req.headers.get('authorization')?.replace('Bearer ', '') ?? ''
  return sig === secret
}

export async function POST(req: NextRequest) {
  if (!validateSignature(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Payload inválido' }, { status: 400 })
  }

  // Hubla pode enviar { event, data } ou { type, ... } dependendo da versão
  const event = String(body.event ?? body.type ?? '')
  const data = (body.data ?? body) as Record<string, unknown>

  console.log('[Hubla webhook] evento recebido:', event, JSON.stringify(body).slice(0, 300))

  try {
    if (event === 'payment.approved') {
      const sale = normalizeHubla(data)
      await addSale(sale)
      console.log('[Hubla webhook] venda inserida:', sale.id)
      return NextResponse.json({ success: true, action: 'sale_created' })
    }

    if (event === 'payment.refunded') {
      const id = getSaleId(data)
      if (id) {
        await updateSaleStatus(id, 'reembolso', todayBRT())
        console.log('[Hubla webhook] reembolso registrado:', id)
      }
      return NextResponse.json({ success: true, action: 'refund_processed' })
    }

    if (event === 'payment.chargedback') {
      const id = getSaleId(data)
      if (id) {
        await updateSaleStatus(id, 'reembolso', todayBRT())
        console.log('[Hubla webhook] chargeback registrado:', id)
      }
      return NextResponse.json({ success: true, action: 'chargeback_processed' })
    }

    // Evento desconhecido — retornar 200 para a plataforma não reenviar
    console.log('[Hubla webhook] evento ignorado:', event)
    return NextResponse.json({ success: true, action: 'ignored' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Hubla webhook] erro ao processar:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

function getSaleId(data: Record<string, unknown>): string | null {
  const payment = (data.payment ?? data) as Record<string, unknown>
  const id = payment.id ?? payment.payment_id ?? data.id
  return id ? String(id) : null
}

function todayBRT(): string {
  return toBRT(new Date().toISOString()).slice(0, 10)
}

function normalizeHubla(data: Record<string, unknown>): Sale {
  const payment  = (data.payment  ?? data)         as Record<string, unknown>
  const buyer    = (payment.buyer ?? data.buyer ?? {}) as Record<string, unknown>
  const product  = (payment.product ?? data.product ?? data.offer ?? {}) as Record<string, unknown>
  const utms     = (payment.utms  ?? data.utms ?? payment.utm ?? data.utm ?? {}) as Record<string, string>

  const saleId      = String(payment.id ?? payment.payment_id ?? data.id ?? `hubla_${Date.now()}`)
  const nome        = String(buyer.name ?? buyer.full_name ?? buyer.nome ?? '')
  const email       = String(buyer.email ?? '')
  const telefone    = String(buyer.phone ?? buyer.telefone ?? buyer.mobile ?? '')
  const produtoNome = String(product.name ?? product.nome ?? product.title ?? product.product_name ?? 'Produto Hubla')

  const valorBruto   = toReais(payment.amount ?? payment.gross_amount ?? payment.valor_bruto ?? product.price ?? 0)
  const valorPago    = toReais(payment.amount ?? payment.total_amount ?? payment.valor_pago ?? valorBruto)
  const valorLiquido = toReais(payment.net_amount ?? payment.valor_liquido ?? payment.net ?? valorPago * 0.87)

  const dataHora = toBRT(String(payment.created_at ?? payment.paid_at ?? payment.approved_at ?? new Date().toISOString()))

  return {
    id: saleId,
    nome,
    email,
    telefone,
    produto: produtoNome,
    plataforma: 'hubla',
    preco_base: valorBruto,
    valor_pago_cliente: valorPago,
    valor_liquido: valorLiquido,
    data_hora: dataHora,
    utm_source:   utms.utm_source   ?? '',
    utm_medium:   utms.utm_medium   ?? '',
    utm_campaign: utms.utm_campaign ?? '',
    utm_content:  utms.utm_content  ?? '',
    utm_term:     utms.utm_term     ?? '',
    status: 'aprovado',
    projetoId: PROJECT_ID,
  }
}
