import { test } from 'node:test'
import assert from 'node:assert/strict'
import { eventoDoWebhook } from './evento-do-webhook'

test('hubla: devolve payload.event', () => {
  const payload = { type: 'invoice.payment_succeeded', event: { product: { id: 'H1', name: 'P' } }, version: 1 }
  const r = eventoDoWebhook('hubla', payload) as { product: { id: string } }
  assert.equal(r, payload.event)
  assert.equal(r.product.id, 'H1')
})

test('kiwify: payload no topo e devolvido como veio', () => {
  const payload = { Product: { product_id: 'K1' }, webhook_event_type: 'order_approved' }
  const r = eventoDoWebhook('kiwify', payload)
  assert.equal(r, payload)
  assert.ok(r.Product)
})

test('kiwify: wrapper order e desembrulhado', () => {
  const order = { Product: { product_id: 'K2' } }
  assert.equal(eventoDoWebhook('kiwify', { order }), order)
})

test('plataforma desconhecida devolve o payload', () => {
  const payload = { event: { a: 1 }, order: { b: 2 } }
  assert.equal(eventoDoWebhook('outra', payload), payload)
})

test('payload null devolve {} sem lancar', () => {
  for (const p of ['hubla', 'kiwify', 'x']) {
    assert.deepEqual(eventoDoWebhook(p, null as unknown as Record<string, unknown>), {})
  }
})
