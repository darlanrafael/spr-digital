import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ofertaDoEventoHubla, ofertaDoProdutoKiwify, correcaoAutoritativaDoOffer } from './oferta-do-webhook'
import { sessoesDoNomeDaOferta } from './sessoes-da-oferta'

test('Hubla: o nome da oferta sai de products[].offers[].name', () => {
  // Payload real da Amanda, 25/08/2026.
  const event = { products: [{ offers: [{ id: 'of_1', name: 'Formato - 4 Sessão    (Cópia) (Cópia)' }] }] }
  const nome = ofertaDoEventoHubla(event)
  assert.equal(nome, 'Formato - 4 Sessão    (Cópia) (Cópia)')
  assert.equal(sessoesDoNomeDaOferta(nome), 4, 'e o nome precisa continuar dizendo a quantidade')
})

test('Hubla: evento sem oferta devolve null, não string vazia', () => {
  assert.equal(ofertaDoEventoHubla({ products: [{}] }), null)
  assert.equal(ofertaDoEventoHubla({}), null)
  assert.equal(ofertaDoEventoHubla(null), null)
  assert.equal(ofertaDoEventoHubla({ products: [{ offers: [{ name: '   ' }] }] }), null)
})

test('Kiwify: o nome da oferta sai de Product.product_offer_name', () => {
  const nome = ofertaDoProdutoKiwify({ product_name: 'Mentoria Particular - Pedro Roncada', product_offer_name: 'Formato - 8 Sessão' })
  assert.equal(nome, 'Formato - 8 Sessão')
  assert.equal(sessoesDoNomeDaOferta(nome), 8)
})

test('Kiwify: produto sem oferta devolve null', () => {
  assert.equal(ofertaDoProdutoKiwify({ product_name: 'x' }), null)
  assert.equal(ofertaDoProdutoKiwify(undefined), null)
})

test('a correção "offer é autoritativo" reescreve o oferta_nome junto com os valores', () => {
  // Sem o oferta_nome no update, a correção de valor apagava a informação que
  // decide a quantidade de sessões do pacote — e nada na tela dizia isso.
  const correcao = correcaoAutoritativaDoOffer({
    preco_base: 2680, valor_pago_cliente: 2680, valor_liquido: 2584.98,
    oferta_nome: 'Formato - 4 Sessão',
  })
  assert.ok('oferta_nome' in correcao, 'a correção precisa carregar oferta_nome')
  assert.equal(correcao.oferta_nome, 'Formato - 4 Sessão')
  assert.equal(correcao.preco_base, 2680)
})
