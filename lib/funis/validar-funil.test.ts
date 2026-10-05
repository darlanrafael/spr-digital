import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validarFunil } from './validar-funil'

test('nome vazio -> erro', () => {
  const r = validarFunil({ nome: '  ', termos_campanha: [], produtos: [] })
  assert.equal(r.ok, false)
})

test('funil orgânico (sem termos, sem produtos) é válido', () => {
  const r = validarFunil({ nome: 'Orgânico', termos_campanha: [], produtos: [] })
  assert.equal(r.ok, true)
})

test('limpa termos vazios e apara espaços do nome', () => {
  const r = validarFunil({ nome: '  Funil CSP ', termos_campanha: ['CSP', '', '  '], produtos: [{ plataforma: 'hubla', produto_id: 'A' }] })
  assert.equal(r.ok, true)
  if (r.ok) { assert.equal(r.funil.nome, 'Funil CSP'); assert.deepEqual(r.funil.termos_campanha, ['CSP']) }
})
