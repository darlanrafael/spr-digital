import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarCatalogo } from './catalogo-dos-eventos'

test('agrupa por (plataforma, produto_id) e acumula nomes sem duplicar', () => {
  const eventos = [
    { plataforma: 'hubla', payload: { product: { id: 'A', name: 'Nome X' } } },
    { plataforma: 'hubla', payload: { product: { id: 'A', name: 'Nome X ' } } }, // espaço a mais = grafia nova
    { plataforma: 'hubla', payload: { product: { id: 'A', name: 'Nome X' } } }, // repetida, não duplica
  ]
  const cat = montarCatalogo(eventos)
  assert.equal(cat.length, 1)
  assert.equal(cat[0].produto_id, 'A')
  assert.deepEqual(cat[0].nomes.sort(), ['Nome X', 'Nome X '].sort())
  assert.equal(cat[0].nome_exibicao, 'Nome X') // mais frequente
})

test('evento sem produto_id é ignorado', () => {
  assert.deepEqual(montarCatalogo([{ plataforma: 'hubla', payload: {} }]), [])
})

test('Kiwify também entra', () => {
  const cat = montarCatalogo([{ plataforma: 'kiwify', payload: { Product: { product_id: 'K', product_name: 'KP' } } }])
  assert.equal(cat[0].produto_id, 'K')
})

const h = (id: string, name: string) => ({ plataforma: 'hubla', payload: { product: { id, name } } })

test('nome_exibicao e o mais frequente, mesmo quando nao e o primeiro', () => {
  const cat = montarCatalogo([h('A', 'A'), h('A', 'B'), h('A', 'B')])
  assert.equal(cat[0].nome_exibicao, 'B')
  assert.deepEqual(cat[0].nomes, ['A', 'B'])
})

test('dois produto_id diferentes na mesma plataforma geram 2 linhas', () => {
  const cat = montarCatalogo([h('A', 'X'), h('B', 'Y')])
  assert.equal(cat.length, 2)
  assert.deepEqual(cat.map(c => c.produto_id).sort(), ['A', 'B'])
})

test('mesmo produto_id em hubla e kiwify gera 2 linhas, uma por plataforma', () => {
  const cat = montarCatalogo([
    h('Z', 'H'),
    { plataforma: 'kiwify', payload: { Product: { product_id: 'Z', product_name: 'K' } } },
  ])
  assert.equal(cat.length, 2)
  assert.deepEqual(cat.map(c => c.plataforma).sort(), ['hubla', 'kiwify'])
})

test('nome vazio nao entra em nomes nem vira nome_exibicao', () => {
  const cat = montarCatalogo([h('A', ''), h('A', '  '), h('A', 'Ok')])
  assert.deepEqual(cat[0].nomes, ['Ok'])
  assert.equal(cat[0].nome_exibicao, 'Ok')
  assert.deepEqual(montarCatalogo([h('A', '')]), [])
})
