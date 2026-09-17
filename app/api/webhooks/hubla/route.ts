import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { logWebhookEvent } from '@/lib/webhook-log'
import { resolveRefundTargets, type SaleRow } from '@/lib/refund-target'
import { hublaRefundDate } from '@/lib/refund-date'
import { correcaoAutoritativaDoOffer } from '@/lib/oferta-do-webhook'
import { parseHublaSale } from '@/lib/hubla-sale'

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
    await logWebhookEvent({ plataforma: 'hubla', tipoEvento: type ?? 'unknown', resultado: 'no_event_field', payload: body })
    return NextResponse.json({ success: true, event: 'ignored' })
  }

  if (type === 'invoice.payment_succeeded') {
    try {
      const parsed = parseHublaSale(event)
      if (!parsed) {
        console.log('[Hubla Webhook] fatura pai ignorada — aguardando webhooks dos produtos filhos')
        await logWebhookEvent({ plataforma: 'hubla', tipoEvento: type, resultado: 'parent_invoice_ignored', payload: body })
        return NextResponse.json({ success: true, event: 'parent_invoice_ignored' })
      }
      const { sale, isOfferFormat } = parsed
      const orderId = sale.order_id

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
              // O offer e autoritativo tambem no nome da oferta, e esse campo
              // decide a QUANTIDADE DE SESSOES do pacote: ver
              // correcaoAutoritativaDoOffer em lib/oferta-do-webhook.ts.
              .update(correcaoAutoritativaDoOffer(sale))
              .eq('order_id', orderId)
            if (updateError) {
              console.error('[Hubla Webhook] erro ao corrigir valor (offer priority):', updateError)
              await logWebhookEvent({ plataforma: 'hubla', tipoEvento: type, resultado: 'update_error', detalhe: `${orderId}: ${updateError.message}`, payload: body })
              return NextResponse.json({ error: updateError.message }, { status: 500 })
            }
            console.log('[Hubla Webhook] valor corrigido para offer individual:', orderId, 'valor:', sale.valor_pago_cliente)
            await logWebhookEvent({ plataforma: 'hubla', tipoEvento: type, resultado: 'sale_updated_offer_priority', saleId: existingRows[0].id as string, detalhe: orderId, payload: body })
            return NextResponse.json({ success: true, event: 'sale_updated_offer_priority' })
          }
          console.log('[Hubla Webhook] duplicata ignorada por order_id:', orderId)
          await logWebhookEvent({ plataforma: 'hubla', tipoEvento: type, resultado: 'duplicate_ignored', saleId: existingRows[0].id as string, detalhe: orderId, payload: body })
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
          // Caminho de risco: sem order_id no payload pra desempatar, cai pra
          // email+produto — se o mesmo cliente comprar o mesmo produto DUAS
          // VEZES de verdade, a segunda venda é descartada aqui como se fosse
          // duplicata. Resultado marcado à parte pra dar pra auditar depois.
          console.log('[Hubla Webhook] duplicata ignorada por email+produto (sem order_id):', sale.email, sale.produto)
          await logWebhookEvent({ plataforma: 'hubla', tipoEvento: type, resultado: 'duplicate_ignored_email_produto_fallback', saleId: existingRows[0].id as string, detalhe: `${sale.email} / ${sale.produto}`, payload: body })
          return NextResponse.json({ success: true, event: 'duplicate_ignored' })
        }
      }

      console.log('[Hubla Webhook] inserindo venda:', JSON.stringify(sale, null, 2))

      // Mesma checagem do webhook da Kiwify: o produtor não pode receber mais
      // do que o cliente pagou. Se `sellerTotal` > `subtotal`, os dois vieram
      // em bases diferentes e o faturamento líquido sai inflado. Nenhum caso
      // detectado na Hubla até 10/08/2026 — preventivo.
      if (sale.valor_liquido > sale.valor_pago_cliente && sale.valor_pago_cliente > 0) {
        console.warn(
          '[Hubla Webhook] ALERTA líquido maior que o pago pelo cliente:',
          JSON.stringify({ produto: sale.produto, email: sale.email, valor_pago_cliente: sale.valor_pago_cliente, valor_liquido: sale.valor_liquido, data_hora: sale.data_hora })
        )
      }

      const { error } = await client.from('sales').insert(sale)

      if (error) {
        console.error('[Hubla Webhook] erro no insert:', error)
        await logWebhookEvent({ plataforma: 'hubla', tipoEvento: type, resultado: 'insert_error', detalhe: error.message, payload: body })
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      console.log('[Hubla Webhook] venda salva com sucesso:', sale.id)
      await logWebhookEvent({ plataforma: 'hubla', tipoEvento: type, resultado: 'sale_created', saleId: sale.id, payload: body })
      return NextResponse.json({ success: true, event: 'sale_created', id: sale.id })

    } catch (err) {
      console.error('[Hubla Webhook] exceção ao processar pagamento:', err)
      await logWebhookEvent({ plataforma: 'hubla', tipoEvento: type, resultado: 'exception', detalhe: String(err), payload: body })
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
        await logWebhookEvent({ plataforma: 'hubla', tipoEvento: type, resultado: 'refund_no_email', payload: body })
        return NextResponse.json({ success: true, event: 'ignored' })
      }

      const client = getSupabaseAdmin()

      // Trava contra estorno em massa: o alvo é a FATURA, nunca o cliente.
      // Ver lib/refund-target.ts para o caso real que originou isso.
      const { data: approvedRows } = await client
        .from('sales')
        .select('id, order_id, produto')
        .eq('email', email)
        .eq('plataforma', 'hubla')
        .eq('status', 'aprovada')

      const invoiceId = (invoice?.id as string) ?? null
      const decision = resolveRefundTargets({
        invoiceId,
        approvedSales: (approvedRows ?? []) as SaleRow[],
      })

      if (decision.action === 'block') {
        console.warn(`[Hubla Webhook] estorno BLOQUEADO (${decision.reason}):`, email, invoiceId)
        await logWebhookEvent({ plataforma: 'hubla', tipoEvento: type, resultado: `refund_blocked_${decision.reason}`, detalhe: `${email} | invoice=${invoiceId} | aprovadas=${approvedRows?.length ?? 0}`, payload: body })
        return NextResponse.json({ success: true, event: 'refund_blocked', reason: decision.reason })
      }

      const dataReembolso = hublaRefundDate(invoice ?? {}, new Date())

      const { error } = await client
        .from('sales')
        .update({
          status: 'reembolsada',
          data_reembolso: dataReembolso,
        })
        .in('id', decision.rows.map(r => r.id))

      if (error) {
        console.error('[Hubla Webhook] erro ao atualizar reembolso:', error)
        await logWebhookEvent({ plataforma: 'hubla', tipoEvento: type, resultado: 'refund_update_error', detalhe: `${email}: ${error.message}`, payload: body })
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      console.log(`[Hubla Webhook] reembolso processado (${decision.matchedBy}):`, email, decision.rows.map(r => r.produto))
      await logWebhookEvent({ plataforma: 'hubla', tipoEvento: type, resultado: 'sale_refunded', detalhe: `${email} | invoice=${invoiceId} | ${decision.matchedBy} | ${decision.rows.length} item(ns) | reembolso=${dataReembolso}`, payload: body })
      return NextResponse.json({ success: true, event: 'sale_refunded', refunded: decision.rows.length })

    } catch (err) {
      console.error('[Hubla Webhook] exceção ao processar reembolso:', err)
      await logWebhookEvent({ plataforma: 'hubla', tipoEvento: type, resultado: 'exception', detalhe: String(err), payload: body })
      return NextResponse.json({ error: String(err) }, { status: 500 })
    }
  }

  console.log('[Hubla Webhook] evento ignorado:', type)
  await logWebhookEvent({ plataforma: 'hubla', tipoEvento: type ?? 'unknown', resultado: 'ignored_unknown_type', payload: body })
  return NextResponse.json({ success: true, event: 'ignored', type })
}
