import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decidirReinsercoes } from './reconciliador'

const evHubla = (fat: string, prod='PROD1') => ({ plataforma: 'hubla' as const, payload: { event: {
  invoice: { id: fat, saleDate: '2026-09-12T01:15:00Z', payer: { firstName: 'F', lastName: 'T', email: 'f@x.local' },
    amount: { subtotalCents: 29700, totalCents: 29700 }, receivers: [{ role: 'seller', totalCents: 28514 }], paymentSession: { utm: {} } },
  product: { id: prod, name: 'COMO SER PERDOADO' }, products: [{ offers: [{ id: prod }] }] } } })

test('insere so o que falta; pula o que ja existe', () => {
  const eventos = [evHubla('f1'), evHubla('f2')]
  const { inserir } = decidirReinsercoes(eventos, new Set(['f1-PROD1']))
  assert.equal(inserir.length, 1)
  assert.equal(inserir[0].order_id, 'f2-PROD1')
})
