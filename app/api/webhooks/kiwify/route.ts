import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { logWebhookEvent } from '@/lib/webhook-log'
import { resolveRefundTargets, type SaleRow } from '@/lib/refund-target'
import { kiwifyRefundDate } from '@/lib/refund-date'

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
          await logWebhookEvent({ plataforma: 'kiwify', tipoEvento: eventType, resultado: 'duplicate_ignored', saleId: existingRows[0].id as string, detalhe: orderId, payload: body })
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
          // Caminho de risco: sem order_id no payload pra desempatar, cai pra
          // email+produto — se o mesmo cliente comprar o mesmo produto DUAS
          // VEZES de verdade, a segunda venda é descartada aqui como se fosse
          // duplicata. Resultado marcado à parte pra dar pra auditar depois.
          console.log('[Kiwify Webhook] duplicata ignorada por email+produto (sem order_id):', sale.email, sale.produto)
          await logWebhookEvent({ plataforma: 'kiwify', tipoEvento: eventType, resultado: 'duplicate_ignored_email_produto_fallback', saleId: existingRows[0].id as string, detalhe: `${sale.email} / ${sale.produto}`, payload: body })
          return NextResponse.json({ success: true, event: 'duplicate_ignored' })
        }
      }

      // Kiwify permite checkout em outras moedas (ex: USD) para clientes
      // internacionais, mas o campo `charge_amount`/`my_commission` vem no
      // valor original cobrado — sem indicar a moeda. Já identificamos 27
      // vendas históricas (mai-jun/2026) com valor_pago_cliente em USD
      // gravado como se fosse BRL. product_base_price é sempre o preço de
      // catálogo em BRL, então uma razão pago/base muito baixa é o sinal
      // de alerta.
      if (sale.preco_base > 0 && sale.valor_pago_cliente / sale.preco_base < 0.4) {
        console.warn(
          '[Kiwify Webhook] ALERTA moeda suspeita — valor_pago_cliente muito abaixo do preco_base ' +
          '(possível venda em moeda estrangeira não convertida):',
          JSON.stringify({ produto: sale.produto, email: sale.email, preco_base: sale.preco_base, valor_pago_cliente: sale.valor_pago_cliente, valor_liquido: sale.valor_liquido, data_hora: sale.data_hora, order_id: orderId })
        )
      }

      // O produtor não pode receber mais do que o cliente pagou. Quando
      // `my_commission` > `charge_amount`, algum dos dois veio numa base
      // diferente (parcela vs. total, ou desconto aplicado só num deles) e o
      // faturamento líquido sai inflado. Aconteceu em 5 vendas de 20-21/05/2026
      // (razão 1,10 a 1,19 — nas vendas normais dos mesmos produtos a razão é
      // 0,88 a 0,92), somando R$ 74,18 a mais. O detector de moeda acima não
      // pega: ele olha pago/base, que nesses casos estava dentro do normal.
      if (sale.valor_liquido > sale.valor_pago_cliente && sale.valor_pago_cliente > 0) {
        console.warn(
          '[Kiwify Webhook] ALERTA líquido maior que o pago pelo cliente ' +
          '(my_commission > charge_amount — valores em bases diferentes?):',
          JSON.stringify({ produto: sale.produto, email: sale.email, preco_base: sale.preco_base, valor_pago_cliente: sale.valor_pago_cliente, valor_liquido: sale.valor_liquido, data_hora: sale.data_hora, order_id: orderId })
        )
      }

      console.log('[Kiwify Webhook] inserindo venda:', JSON.stringify(sale, null, 2))

      const { error } = await client.from('sales').insert(sale)

      if (error) {
        console.error('[Kiwify Webhook] erro no insert:', error)
        await logWebhookEvent({ plataforma: 'kiwify', tipoEvento: eventType, resultado: 'insert_error', detalhe: error.message, payload: body })
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      console.log('[Kiwify Webhook] venda salva com sucesso:', sale.id)
      await logWebhookEvent({ plataforma: 'kiwify', tipoEvento: eventType, resultado: 'sale_created', saleId: sale.id, payload: body })
      return NextResponse.json({ success: true, event: 'sale_created', id: sale.id })

    } catch (err) {
      console.error('[Kiwify Webhook] exceção ao processar venda:', err)
      await logWebhookEvent({ plataforma: 'kiwify', tipoEvento: eventType, resultado: 'exception', detalhe: String(err), payload: body })
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
        await logWebhookEvent({ plataforma: 'kiwify', tipoEvento: eventType, resultado: 'refund_no_email', payload: body })
        return NextResponse.json({ success: true, event: 'ignored' })
      }

      const client = getSupabaseAdmin()

      // Mesma trava da rota da Hubla: o alvo é o pedido, nunca o cliente inteiro.
      // Ver lib/refund-target.ts.
      const { data: approvedRows } = await client
        .from('sales')
        .select('id, order_id, produto')
        .eq('email', email)
        .eq('plataforma', 'kiwify')
        .eq('status', 'aprovada')

      const refundOrderId = (order.order_id as string) ?? null
      const decision = resolveRefundTargets({
        invoiceId: refundOrderId,
        approvedSales: (approvedRows ?? []) as SaleRow[],
      })

      if (decision.action === 'block') {
        console.warn(`[Kiwify Webhook] estorno BLOQUEADO (${decision.reason}):`, email, refundOrderId)
        await logWebhookEvent({ plataforma: 'kiwify', tipoEvento: eventType, resultado: `refund_blocked_${decision.reason}`, detalhe: `${email} | order=${refundOrderId} | aprovadas=${approvedRows?.length ?? 0}`, payload: body })
        return NextResponse.json({ success: true, event: 'refund_blocked', reason: decision.reason })
      }

      const dataReembolso = kiwifyRefundDate(order, new Date())

      const { error } = await client
        .from('sales')
        .update({
          status: 'reembolsada',
          data_reembolso: dataReembolso,
        })
        .in('id', decision.rows.map(r => r.id))

      if (error) {
        console.error('[Kiwify Webhook] erro ao atualizar reembolso:', error)
        await logWebhookEvent({ plataforma: 'kiwify', tipoEvento: eventType, resultado: 'refund_update_error', detalhe: `${email}: ${error.message}`, payload: body })
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      console.log(`[Kiwify Webhook] reembolso processado (${decision.matchedBy}):`, email, decision.rows.map(r => r.produto))
      await logWebhookEvent({ plataforma: 'kiwify', tipoEvento: eventType, resultado: 'sale_refunded', detalhe: `${email} | order=${refundOrderId} | ${decision.matchedBy} | ${decision.rows.length} item(ns) | reembolso=${dataReembolso}`, payload: body })
      return NextResponse.json({ success: true, event: 'sale_refunded', refunded: decision.rows.length })

    } catch (err) {
      console.error('[Kiwify Webhook] exceção ao processar reembolso:', err)
      await logWebhookEvent({ plataforma: 'kiwify', tipoEvento: eventType, resultado: 'exception', detalhe: String(err), payload: body })
      return NextResponse.json({ error: String(err) }, { status: 500 })
    }
  }

  console.log('[Kiwify Webhook] evento ignorado:', eventType)
  await logWebhookEvent({ plataforma: 'kiwify', tipoEvento: eventType || 'unknown', resultado: 'ignored_unknown_type', payload: body })
  return NextResponse.json({ success: true, event: 'ignored', type: eventType })
}
