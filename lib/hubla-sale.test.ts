import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHublaSale } from './hubla-sale'

const eventBase = () => ({
  invoice: { id: 'fatura-1', saleDate: '2026-09-12T01:15:00Z',
    payer: { firstName: 'Fulano', lastName: 'Teste', email: 'f@x.local', phone: '' },
    amount: { subtotalCents: 29700, totalCents: 29700 },
    receivers: [{ role: 'seller', totalCents: 28514 }],
    paymentSession: { utm: { source: 'FB' } } },
  product: { id: 'PROD1', name: 'COMO SER PERDOADO' },
  products: [{ offers: [{ id: 'PROD1' }] }],
})

test('parseHublaSale monta a venda com os valores certos', () => {
  const { sale } = parseHublaSale(eventBase())!
  assert.equal(sale.produto, 'COMO SER PERDOADO')
  assert.equal(sale.email, 'f@x.local')
  assert.equal(sale.valor_pago_cliente, 297)
  assert.equal(sale.valor_liquido, 285.14)
  assert.equal(sale.order_id, 'fatura-1-PROD1')
  assert.equal(sale.plataforma, 'hubla')
  assert.equal(sale.status, 'aprovada')
})

test('parseHublaSale devolve null para fatura pai com filhos', () => {
  const ev: any = eventBase()
  ev.invoice.childInvoiceIds = ['a', 'b']
  assert.equal(parseHublaSale(ev), null)
})
