import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readequacoesDoPeriodo, READEQUACOES_PRODUTO, type ReadequacaoProduto } from './readequacoes-produto'

const r = (o: Partial<ReadequacaoProduto> = {}): ReadequacaoProduto => ({
  saleId: 'v1', cliente: 'Fulano', produtoNaPlataforma: 'A', produtoNoSistema: 'B',
  data: '2026-08-28', valor: 100, plataforma: 'Hubla', motivo: 'x', ...o,
})

test('a readequacao da Paula cai num fechamento que cubra 28/08', () => {
  const l = readequacoesDoPeriodo({ inicio: '2026-08-15', fim: '2026-09-10' })
  assert.equal(l.length, 1)
  assert.equal(l[0].cliente, 'Paula Caroline')
  assert.equal(l[0].produtoNaPlataforma, 'Mentoria Particular - Pedro Roncada')
  assert.equal(l[0].valor, 4997)
})

test('fechamento anterior a venda nao mostra a readequacao', () => {
  // O ultimo fechamento confirmado foi 14/08 e a venda e de 28/08.
  assert.equal(readequacoesDoPeriodo({ inicio: '2026-07-01', fim: '2026-08-14' }).length, 0)
})

test('fechamento posterior tambem nao mostra: a conferencia daquele periodo ja bate', () => {
  assert.equal(readequacoesDoPeriodo({ inicio: '2026-09-01', fim: '2026-09-30' }).length, 0)
})

test('as bordas do periodo entram', () => {
  assert.equal(readequacoesDoPeriodo({ inicio: '2026-08-28', fim: '2026-08-28' }).length, 1)
})

test('periodo vazio nao quebra nem lista tudo', () => {
  assert.equal(readequacoesDoPeriodo({ inicio: '', fim: '' }).length, 0)
  assert.equal(readequacoesDoPeriodo({ inicio: '2026-01-01', fim: '' }).length, 0)
})

test('ordena por data', () => {
  const l = readequacoesDoPeriodo({
    inicio: '2026-01-01', fim: '2026-12-31',
    readequacoes: [r({ data: '2026-08-28' }), r({ data: '2026-03-01', cliente: 'Antes' })],
  })
  assert.deepEqual(l.map(x => x.cliente), ['Antes', 'Fulano'])
})

test('toda readequacao registrada diz o que a plataforma ainda mostra', () => {
  // Sem isso o aviso nao serve pra nada na hora de cruzar os numeros.
  for (const x of READEQUACOES_PRODUTO) {
    assert.ok(x.produtoNaPlataforma.length > 0, `${x.cliente} sem produto da plataforma`)
    assert.ok(x.produtoNaPlataforma !== x.produtoNoSistema, `${x.cliente}: produtos iguais, nao e readequacao`)
    assert.ok(x.motivo.length > 10, `${x.cliente} sem motivo`)
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(x.data), `${x.cliente} com data fora do formato`)
  }
})
