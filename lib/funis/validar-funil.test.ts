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

test('entrada não-objeto -> ok:false sem lançar', () => {
  for (const x of [null, 5, 'x', undefined]) {
    const r = validarFunil(x)
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.erro, 'Dados do funil inválidos.')
  }
})

test('termos_campanha não-array vira []', () => {
  const r = validarFunil({ nome: 'A', termos_campanha: 'CSP', produtos: [] })
  assert.equal(r.ok, true)
  if (r.ok) assert.deepEqual(r.funil.termos_campanha, [])
})

test('item não-string em termos é ignorado', () => {
  const r = validarFunil({ nome: 'A', termos_campanha: ['CSP', 5, null, ' x '], produtos: [] })
  assert.equal(r.ok, true)
  if (r.ok) assert.deepEqual(r.funil.termos_campanha, ['CSP', 'x'])
})

test('nome não-string cai no erro de nome', () => {
  const r = validarFunil({ nome: 5, termos_campanha: [], produtos: [] })
  assert.equal(r.ok, false)
})

test('produtos não-array vira []', () => {
  const r = validarFunil({ nome: 'A', termos_campanha: [], produtos: 'x' })
  assert.equal(r.ok, true)
  if (r.ok) assert.deepEqual(r.funil.produtos, [])
})

test('produto null/sem plataforma/sem produto_id é descartado', () => {
  const r = validarFunil({ nome: 'A', termos_campanha: [], produtos: [null, { produto_id: 'A' }, { plataforma: 'hubla' }, { plataforma: 1, produto_id: 'A' }, { plataforma: 'hubla', produto_id: 'B' }] })
  assert.equal(r.ok, true)
  if (r.ok) assert.deepEqual(r.funil.produtos, [{ plataforma: 'hubla', produto_id: 'B' }])
})

test('produtos duplicados viram um só', () => {
  const r = validarFunil({ nome: 'A', termos_campanha: [], produtos: [{ plataforma: 'hubla', produto_id: 'A' }, { plataforma: 'hubla', produto_id: 'A' }, { plataforma: 'kiwify', produto_id: 'A' }] })
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.funil.produtos.length, 2)
})
