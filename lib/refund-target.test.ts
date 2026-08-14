import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveRefundTargets, type SaleRow } from './refund-target'

// Cenário real que originou esta trava (reconciliação de 13/08/2026):
// Roger comprou duas vezes na Hubla, em faturas DIFERENTES, e estornou só uma.
// O handler antigo casava por e-mail e marcava as duas como reembolsadas.
const ROGER: SaleRow[] = [
  { id: 'b08d9917', order_id: '326b48df-3ff0-4e89-a84a-4453533aed0f-lPOE29bN7CVAL57GlUCC', produto: 'Imersão - A reaproximação' },
  { id: 'a1000000', order_id: 'e58855c4-1111-2222-3333-444444444444-hQDdIiz1jjuM9jtWwMjk', produto: 'O RESGATE' },
]

// Bruno comprou dois produtos na MESMA fatura (order bump). Estornar os dois é correto.
const BRUNO: SaleRow[] = [
  { id: 'c1', order_id: '666f6bfe-a410-4bc7-8b96-7f2683e947ce-lPOE29bN7CVAL57GlUCC', produto: 'Imersão - A reaproximação' },
  { id: 'c2', order_id: '666f6bfe-a410-4bc7-8b96-7f2683e947ce-hQDdIiz1jjuM9jtWwMjk', produto: 'Combo: Primeiros Passos da Restauração - OB' },
]

test('estorna apenas a fatura informada, preservando outra compra do mesmo cliente', () => {
  const r = resolveRefundTargets({
    invoiceId: 'e58855c4-1111-2222-3333-444444444444',
    approvedSales: ROGER,
  })

  assert.equal(r.action, 'refund')
  if (r.action !== 'refund') return
  assert.deepEqual(r.rows.map(x => x.produto), ['O RESGATE'])
  assert.equal(r.matchedBy, 'invoice')
})

test('estorna todos os itens quando compartilham a mesma fatura (order bump)', () => {
  const r = resolveRefundTargets({
    invoiceId: '666f6bfe-a410-4bc7-8b96-7f2683e947ce',
    approvedSales: BRUNO,
  })

  assert.equal(r.action, 'refund')
  if (r.action !== 'refund') return
  assert.equal(r.rows.length, 2)
})

test('normaliza invoice.id no formato "-offer-N" antes de casar', () => {
  // A Hubla reenvia o mesmo estorno ora como "{id}" ora como "{id}-offer-1".
  const r = resolveRefundTargets({
    invoiceId: '666f6bfe-a410-4bc7-8b96-7f2683e947ce-offer-1',
    approvedSales: BRUNO,
  })

  assert.equal(r.action, 'refund')
  if (r.action !== 'refund') return
  assert.equal(r.rows.length, 2)
})

test('bloqueia quando a fatura informada não existe no banco, em vez de varrer por e-mail', () => {
  const r = resolveRefundTargets({
    invoiceId: 'ffffffff-0000-0000-0000-000000000000',
    approvedSales: ROGER,
  })

  assert.equal(r.action, 'block')
  if (r.action !== 'block') return
  assert.equal(r.reason, 'invoice_not_found')
})

test('sem invoice.id, bloqueia se o cliente tem mais de uma fatura aprovada', () => {
  const r = resolveRefundTargets({ invoiceId: null, approvedSales: ROGER })

  assert.equal(r.action, 'block')
  if (r.action !== 'block') return
  assert.equal(r.reason, 'ambiguous_multiple_invoices')
})

test('sem invoice.id, estorna quando o cliente tem uma única fatura aprovada', () => {
  const r = resolveRefundTargets({ invoiceId: null, approvedSales: [ROGER[0]] })

  assert.equal(r.action, 'refund')
  if (r.action !== 'refund') return
  assert.equal(r.rows.length, 1)
  assert.equal(r.matchedBy, 'single_sale')
})

test('sem invoice.id, order bumps da mesma fatura ainda são estornados juntos', () => {
  const r = resolveRefundTargets({ invoiceId: null, approvedSales: BRUNO })

  assert.equal(r.action, 'refund')
  if (r.action !== 'refund') return
  assert.equal(r.rows.length, 2)
})

test('bloqueia quando não há nenhuma venda aprovada para o cliente', () => {
  const r = resolveRefundTargets({ invoiceId: 'qualquer', approvedSales: [] })

  assert.equal(r.action, 'block')
  if (r.action !== 'block') return
  assert.equal(r.reason, 'no_approved_sale')
})
