import { test } from 'node:test'
import assert from 'node:assert/strict'
import { impostoDaVendaNoFechamento, fechamentoLiberado, mesmaLista, repassePercentual } from './linha-do-fechamento'

// Imposto da venda no Fechamento (dono 13/11/2026): a empresa paga pela regra da
// venda; o repasse do terapeuta continua com a base da regra antiga.

const perto = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`)
const venda = (o: Partial<{ id: string; preco_base: number; valor_pago_cliente: number; valor_com_juros: number | null }>) =>
  ({ id: 'v1', preco_base: 1000, valor_pago_cliente: 1000, valor_com_juros: null, ...o }) as never

test('venda sem fechamento acima de R$ 167: empresa 8,71%, repasse com 12,85%', () => {
  const r = impostoDaVendaNoFechamento(venda({}), new Set())
  assert.equal(r.base, 1000)
  assert.equal(r.aliquota, 8.71)
  perto(r.imposto, 87.1)
  perto(r.impostoDoRepasse, 128.5)
})

test('venda ja fechada pela regra antiga: tudo na antiga', () => {
  const r = impostoDaVendaNoFechamento(venda({}), new Set(['v1']))
  assert.equal(r.aliquota, 12.85)
  perto(r.imposto, 128.5)
  perto(r.impostoDoRepasse, 128.5)
})

test('venda de R$ 97 sem fechamento: empresa 3,8%, repasse com 3%', () => {
  const r = impostoDaVendaNoFechamento(venda({ preco_base: 97, valor_pago_cliente: 97 }), new Set())
  assert.equal(r.aliquota, 3.8)
  perto(r.imposto, 3.686)
  perto(r.impostoDoRepasse, 2.91)
})

test('base com juros: usa o maior valor', () => {
  const r = impostoDaVendaNoFechamento(venda({ preco_base: 197, valor_pago_cliente: 210, valor_com_juros: 230 }), new Set())
  assert.equal(r.base, 230)
  perto(r.imposto, 230 * 8.71 / 100)
})

test('fechamentoLiberado: so com a lista pronta e sem confirmacao em andamento', () => {
  assert.equal(fechamentoLiberado({ estadoRegra: 'carregando', confirmando: false }), false)
  assert.equal(fechamentoLiberado({ estadoRegra: 'erro', confirmando: false }), false)
  assert.equal(fechamentoLiberado({ estadoRegra: 'pronto', confirmando: false }), true)
  assert.equal(fechamentoLiberado({ estadoRegra: 'pronto', confirmando: true }), false)
})

test('mesmaLista: ordem nao importa; um a mais muda', () => {
  assert.equal(mesmaLista(new Set(['a', 'b']), new Set(['b', 'a'])), true)
  assert.equal(mesmaLista(new Set(['a']), new Set(['a', 'b'])), false)
  assert.equal(mesmaLista(new Set(), new Set()), true)
  assert.equal(mesmaLista(new Set(['a', 'b']), new Set(['a', 'c'])), false, 'mesmo tamanho, ids diferentes')
})

// Comissao do terapeuta nao muda em lugar nenhum (dono 13/11): a conta e a de
// antes, base x %, inclusive com base zero ou negativa (revisao final).
test('repassePercentual: base x % como antes, com o texto da regra antiga', () => {
  const r = repassePercentual(771.5, 30)
  perto(r.repasse, 231.45)
  assert.match(r.detalhe, /^30% sobre R\$\s?771,50 \(imposto pela regra antiga\)$/)
  perto(repassePercentual(0, 30).repasse, 0)
  perto(repassePercentual(-38.57, 30).repasse, -11.571)
})
