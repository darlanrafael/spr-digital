import { test } from 'node:test'
import assert from 'node:assert/strict'
import { terapeutaSugerido, avisoTerapeutaDivergente, terapeutasDoProduto } from './terapeuta-da-venda'

// A lista chega do banco com `.order('nome')`: a Denise vem SEMPRE primeiro.
// Era esse [0] que o modal usava como padrao.
const LISTA = [
  { id: 'denise', nome: 'Denise Nascimento' },
  { id: 'pedro', nome: 'Pedro Roncada' },
]

test('CASO REAL: venda do Pedro abre com o PEDRO, nao com o primeiro da lista', () => {
  // Ana Assis (28/07) e Joicy (03/08): as duas vendas eram "Mentoria
  // Particular - Pedro Roncada" e as 4 sessoes foram para a Denise, com
  // R$ 781,43 de comissao, porque o campo abria nela por ordem alfabetica.
  const r = terapeutaSugerido('Mentoria Particular - Pedro Roncada', LISTA)
  assert.equal(r?.id, 'pedro')
})

test('venda da Denise abre com a Denise', () => {
  assert.equal(terapeutaSugerido('Mentoria Particular - Denise Nascimento', LISTA)?.id, 'denise')
  assert.equal(terapeutaSugerido('Mentoria Individual - Denise', LISTA)?.id, 'denise')
})

test('as outras variantes do nome do produto tambem sao reconhecidas', () => {
  // Existem quatro nomes diferentes para o mesmo produto na base.
  assert.equal(terapeutaSugerido('Mentoria - Individual Pedro Roncada', LISTA)?.id, 'pedro')
  assert.equal(terapeutaSugerido('Mentoria em grupo- Pedro Roncada', LISTA)?.id, 'pedro')
})

test('produto CONJUNTO nao sugere ninguem: a escolha tem de ser consciente', () => {
  assert.equal(terapeutaSugerido('Mentoria Particular - Pedro | Denise', LISTA), null)
  assert.equal(terapeutasDoProduto('Mentoria Particular - Pedro | Denise', LISTA).length, 2)
})

test('Diagnostico Guiado abre com o Pedro: e ele quem sempre comeca o pacote', () => {
  const r = terapeutaSugerido('Diagnóstico Guiado: Programa de acompanhamento Individual', LISTA)
  assert.equal(r?.id, 'pedro')
})

test('produto sem nome de terapeuta nenhum nao chuta', () => {
  assert.equal(terapeutaSugerido('O RESGATE', LISTA), null)
  assert.equal(terapeutaSugerido('', LISTA), null)
})

test('AVISO: agendar venda do Pedro na Denise avisa, mas nao bloqueia', () => {
  const a = avisoTerapeutaDivergente({
    produto: 'Mentoria Particular - Pedro Roncada',
    terapeutaEscolhido: LISTA[0],
    terapeutas: LISTA,
  })
  assert.match(a!, /Pedro Roncada/)
  assert.match(a!, /Denise Nascimento/)
  assert.match(a!, /comissão/)
})

test('sem divergencia, sem aviso', () => {
  for (const [produto, escolhido] of [
    ['Mentoria Particular - Pedro Roncada', LISTA[1]],
    ['Mentoria Particular - Pedro | Denise', LISTA[0]],
    ['Mentoria Particular - Pedro | Denise', LISTA[1]],
    ['Diagnóstico Guiado: Programa de acompanhamento Individual', LISTA[0]],
    ['O RESGATE', LISTA[0]],
  ] as const) {
    assert.equal(avisoTerapeutaDivergente({ produto, terapeutaEscolhido: escolhido, terapeutas: LISTA }), null, `${produto} / ${escolhido.nome}`)
  }
})

test('sem terapeuta escolhido nao ha o que avisar', () => {
  assert.equal(avisoTerapeutaDivergente({ produto: 'Mentoria Particular - Pedro Roncada', terapeutaEscolhido: null, terapeutas: LISTA }), null)
})

test('um terapeuta novo com nome de uma palavra tambem funciona', () => {
  const lista = [...LISTA, { id: 'ana', nome: 'Ana' }]
  assert.equal(terapeutaSugerido('Mentoria Particular - Ana', lista)?.id, 'ana')
})
