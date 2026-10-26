import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ehComissaoPagavel } from './comissao-pagavel'

test('entregue, nao paga, nao bloqueada: pagavel', () => {
  assert.equal(ehComissaoPagavel({ status: 'entregue', comissaoPaga: false, comissaoBloqueada: false }), true)
})
test('bloqueada: nao pagavel', () => {
  assert.equal(ehComissaoPagavel({ status: 'entregue', comissaoPaga: false, comissaoBloqueada: true }), false)
})
test('ja paga: nao pagavel', () => {
  assert.equal(ehComissaoPagavel({ status: 'entregue', comissaoPaga: true, comissaoBloqueada: false }), false)
})
test('status diferente de entregue: nao pagavel', () => {
  for (const status of ['agendada', 'pendente', 'falta', '', null]) {
    assert.equal(ehComissaoPagavel({ status, comissaoPaga: false, comissaoBloqueada: false }), false)
  }
})
test('campos undefined/null contam como falsy', () => {
  assert.equal(ehComissaoPagavel({ status: 'entregue' }), true)
  assert.equal(ehComissaoPagavel({ status: 'entregue', comissaoPaga: null, comissaoBloqueada: null }), true)
})
