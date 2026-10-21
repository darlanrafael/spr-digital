import { test } from 'node:test'
import assert from 'node:assert/strict'
import { produtoDoEventoHubla, produtoDoEventoKiwify } from './produto-do-evento'

test('Hubla: pega o produto-base (product.id) e o nome', () => {
  const event = { product: { id: 'HYscfyfSoG2CrsS6JpSe', name: 'ACESSO VITALÍCIO - CSP ' } }
  assert.deepEqual(produtoDoEventoHubla(event), {
    plataforma: 'hubla', produto_id: 'HYscfyfSoG2CrsS6JpSe', nome: 'ACESSO VITALÍCIO - CSP ',
  })
})

test('Hubla: sem product.id -> null', () => {
  assert.equal(produtoDoEventoHubla({ product: { name: 'X' } }), null)
  assert.equal(produtoDoEventoHubla({}), null)
})

test('Kiwify: pega Product.product_id e product_name', () => {
  const order = { Product: { product_id: 'f34a2630-d9e0', product_name: 'Curso X' } }
  assert.deepEqual(produtoDoEventoKiwify(order), {
    plataforma: 'kiwify', produto_id: 'f34a2630-d9e0', nome: 'Curso X',
  })
})

test('Kiwify: sem product_id -> null', () => {
  assert.equal(produtoDoEventoKiwify({ Product: { product_name: 'X' } }), null)
  assert.equal(produtoDoEventoKiwify({}), null)
})
