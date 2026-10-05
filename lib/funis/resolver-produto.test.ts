import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolverProdutoId, normalizarNome } from './resolver-produto'

const CAT = [
  { plataforma: 'hubla', produto_id: 'A', nomes: ['ACESSO VITALÍCIO - CSP', 'ACESSO VITALÍCIO - CSP '] },
  { plataforma: 'kiwify', produto_id: 'K', nomes: ['Curso X'] },
]

test('usa o produto_id quando a venda já tem', () => {
  assert.deepEqual(resolverProdutoId({ plataforma: 'hubla', produto_id: 'A', produto: 'qualquer' }, CAT), { plataforma: 'hubla', produto_id: 'A' })
})

test('resolve pelo nome normalizado (trim/caixa) quando não tem produto_id', () => {
  assert.deepEqual(resolverProdutoId({ plataforma: 'hubla', produto_id: null, produto: '  acesso vitalício - csp ' }, CAT), { plataforma: 'hubla', produto_id: 'A' })
})

test('plataforma diferente não casa pelo nome', () => {
  assert.equal(resolverProdutoId({ plataforma: 'kiwify', produto_id: null, produto: 'ACESSO VITALÍCIO - CSP' }, CAT), null)
})

test('nome desconhecido -> null (não classificada)', () => {
  assert.equal(resolverProdutoId({ plataforma: 'hubla', produto_id: null, produto: 'Inexistente' }, CAT), null)
})

test('normalizarNome tira espaços das pontas e baixa a caixa', () => {
  assert.equal(normalizarNome('  AçÃo  '), 'ação')
})
