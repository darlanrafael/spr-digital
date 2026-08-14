// Decide QUAIS vendas um evento de estorno pode marcar como reembolsadas.
//
// Existe por causa de um bug real (reconciliação de 13/08/2026): os handlers de
// reembolso casavam a venda só por e-mail (`.eq('email', …).eq('status','aprovada')`),
// sem olhar a fatura. Um cliente que comprou duas vezes em faturas diferentes e
// estornou só uma teve as DUAS marcadas como reembolsadas — faturamento real
// desaparecendo em silêncio. Caso confirmado: fatura 326b48df (Imersão, R$ 39,90)
// arrastada junto com o estorno legítimo de outra fatura do mesmo cliente.
//
// Regra: o alvo é a FATURA, nunca o cliente. Sem conseguir identificar a fatura
// com segurança, o estorno é BLOQUEADO e registrado para conferência manual —
// deixar de estornar é um erro visível e reversível; estornar a venda errada
// apaga receita real e só aparece meses depois, numa reconciliação manual.

export type SaleRow = { id: string; order_id: string; produto: string }

export type RefundDecision =
  | { action: 'refund'; rows: SaleRow[]; matchedBy: 'invoice' | 'single_sale' }
  | { action: 'block'; reason: 'invoice_not_found' | 'ambiguous_multiple_invoices' | 'no_approved_sale' }

// A Hubla reenvia o mesmo estorno ora como "{id}", ora como "{id}-offer-N".
// A rota de criação já normaliza assim ao montar o order_id; aqui tem que casar.
export function canonicalInvoiceId(invoiceId: string | null | undefined): string | null {
  if (!invoiceId) return null
  return invoiceId.replace(/-offer-\d+$/, '')
}

// order_id é "{idDaFatura}-{idDoProduto}". Extrai a fatura para agrupar itens
// (order bumps) que legitimamente pertencem à mesma compra.
export function invoiceOf(orderId: string): string {
  const uuid = orderId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  return uuid ? uuid[0] : orderId
}

export function resolveRefundTargets(params: {
  invoiceId?: string | null
  approvedSales: SaleRow[]
}): RefundDecision {
  const { approvedSales } = params

  if (approvedSales.length === 0) {
    return { action: 'block', reason: 'no_approved_sale' }
  }

  const invoice = canonicalInvoiceId(params.invoiceId)

  if (invoice) {
    const rows = approvedSales.filter(
      s => s.order_id === invoice || s.order_id.startsWith(`${invoice}-`),
    )
    // Fatura informada mas ausente do banco: pode ser venda nunca capturada ou
    // produto de outro projeto. Varrer por e-mail aqui é exatamente o bug antigo.
    if (rows.length === 0) return { action: 'block', reason: 'invoice_not_found' }
    return { action: 'refund', rows, matchedBy: 'invoice' }
  }

  // Sem fatura no payload, só é seguro agir se não houver ambiguidade: uma única
  // fatura aprovada para esse cliente (com quantos itens for).
  const invoices = new Set(approvedSales.map(s => invoiceOf(s.order_id)))
  if (invoices.size > 1) return { action: 'block', reason: 'ambiguous_multiple_invoices' }

  return { action: 'refund', rows: approvedSales, matchedBy: 'single_sale' }
}
