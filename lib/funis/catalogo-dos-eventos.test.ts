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
