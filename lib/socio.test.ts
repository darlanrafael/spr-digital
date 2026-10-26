import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ehPedroSocio } from './socio'

test('ehPedroSocio: casa Pedro, ignorando caixa e acento', () => {
  assert.equal(ehPedroSocio('Pedro Roncada'), true)
  assert.equal(ehPedroSocio('Pedro'), true)
  assert.equal(ehPedroSocio('PEDRO'), true)
  assert.equal(ehPedroSocio('pédro'), true)
  assert.equal(ehPedroSocio('  Pedro  '), true)
})

test('ehPedroSocio: outros terapeutas e vazio nao sao socio', () => {
  assert.equal(ehPedroSocio('Denise Nascimento'), false)
  assert.equal(ehPedroSocio('Leomir Santos'), false)
  assert.equal(ehPedroSocio(''), false)
  assert.equal(ehPedroSocio('Alpedrosa Lima'), false)
})

test('ehPedroSocio: fragilidade documentada - "Pedro Henrique" tambem casa', () => {
  assert.equal(ehPedroSocio('Pedro Henrique'), true)
})
