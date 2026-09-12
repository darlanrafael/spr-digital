import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { invariantesDoFechamento, type DadosDoFechamento } from './invariantes-do-fechamento'

// Um fechamento que FECHA, com numeros que somam. Cada teste estraga UMA coisa.
const OK: DadosDoFechamento = {
  byProduct: [
    { nome: 'O RESGATE', qtd: 10, bruto: 6970, taxas: 200, imposto: 895.65, liquido: 6770 },
    { nome: 'Mentoria Particular - Pedro | Denise', qtd: 2, bruto: 2800, taxas: 80, imposto: 359.80, liquido: 2720, repasse_terapeuta: 700 },
  ],
  faturamentoBruto: 9770,
  taxasPlataforma: 280,
  impostoTotal: 1255.45,
  faturamentoLiquido: 9770 - 280 - 1255.45,
  alertasSelecionados: [{ valor: 737.45 }, { valor: 1560 }],
  deducaoPorSocio: [1000.35, 1297.10],
  deducaoDosSocios: 2297.45,
  compradores: [{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }],
}

test('fechamento que fecha nao gera aviso nenhum', () => {
  assert.deepEqual(invariantesDoFechamento(OK), [])
})

test('I1 CASO REAL: a deducao dos socios nao somando o total', () => {
  // Defeito de 12/09/2026: `deducaoDosSocios` vinha de `alertasTotal` e as
  // linhas do rateio por alerta. Divisao que nao soma 100 -> rodape mente.
  const r = invariantesDoFechamento({ ...OK, deducaoPorSocio: [0, 0] })
  assert.equal(r.length, 1)
  assert.equal(r[0].id, 'I1')
  assert.equal(r[0].esperado, 2297.45)
  assert.equal(r[0].encontrado, 0)
  assert.equal(r[0].diferenca, -2297.45)
})

test('I1 nao reclama quando a EMPRESA absorve (deducao dos socios e zero)', () => {
  const r = invariantesDoFechamento({ ...OK, deducaoDosSocios: 0, deducaoPorSocio: [0, 0] })
  assert.deepEqual(r, [], 'empresa pagando: nao ha deducao de socio para conferir')
})

test('I2 CASO REAL: repasse de terapeuta sem faturamento que o sustente', () => {
  // Familia do defeito do Diagnostico: repasse existindo sem base coerente.
  const r = invariantesDoFechamento({
    ...OK,
    byProduct: [{ nome: 'X', qtd: 1, bruto: 0, taxas: 0, imposto: 0, liquido: 0, repasse_terapeuta: 285 }],
    faturamentoBruto: 0, taxasPlataforma: 0, impostoTotal: 0, faturamentoLiquido: 0,
  })
  assert.ok(r.some(x => x.id === 'I2'), 'tem que apontar o repasse sem base')
})

test('I2 repasse negativo e apontado', () => {
  const r = invariantesDoFechamento({
    ...OK,
    byProduct: [{ ...OK.byProduct[1], repasse_terapeuta: -100 }],
    faturamentoBruto: 2800, taxasPlataforma: 80, impostoTotal: 359.80, faturamentoLiquido: 2800 - 80 - 359.80,
  })
  assert.ok(r.some(x => x.id === 'I2' && x.encontrado === -100))
})

test('I3 CASO REAL: a parte nao somando o todo', () => {
  const r = invariantesDoFechamento({ ...OK, faturamentoBruto: 9999 })
  const i3 = r.filter(x => x.id === 'I3')
  assert.ok(i3.length >= 1)
  assert.equal(i3[0].esperado, 9999)
  assert.equal(i3[0].encontrado, 9770)
})

test('I3 liquido que nao fecha com bruto menos taxas e imposto', () => {
  const r = invariantesDoFechamento({ ...OK, faturamentoLiquido: 8000 })
  assert.ok(r.some(x => x.id === 'I3' && x.titulo.includes('líquido')))
})

test('I4 CASO REAL: deducao maior que o estorno que a originou', () => {
  // Defeito real do Miguel: parcial (R$ 1.560) + integral (R$ 2.758,70) =
  // R$ 4.318,70 sobre uma venda que gerou R$ 2.758,70.
  const r = invariantesDoFechamento({
    ...OK,
    alertasSelecionados: [{ valor: 2758.70 }],
    deducaoDosSocios: 4318.70,
    deducaoPorSocio: [1511.55, 2807.15],
  })
  assert.ok(r.some(x => x.id === 'I4'), 'tem que apontar deducao acima do estorno')
  const i4 = r.find(x => x.id === 'I4')!
  assert.equal(i4.esperado, 2758.70)
  assert.equal(i4.encontrado, 4318.70)
})

test('I5 CASO REAL: venda contada duas vezes', () => {
  // Em 13/08/2026 duas vendas foram repetidas entre fechamentos (Antonio Belone
  // R$ 747 e Marcos Gilvane R$ 697).
  const r = invariantesDoFechamento({ ...OK, compradores: [{ id: 'v1' }, { id: 'v2' }, { id: 'v1' }] })
  assert.ok(r.some(x => x.id === 'I5'))
  assert.match(r.find(x => x.id === 'I5')!.detalhe, /v1/)
})

test('centavo de arredondamento NAO gera aviso', () => {
  // Tolerancia existe porque comissao tem dizima: 88.216498125 e amiga.
  const r = invariantesDoFechamento({ ...OK, faturamentoBruto: 9770.005 })
  assert.deepEqual(r, [], 'meio centavo e arredondamento, nao erro')
})

test('dois centavos GERAM aviso', () => {
  const r = invariantesDoFechamento({ ...OK, faturamentoBruto: 9770.02 })
  assert.ok(r.some(x => x.id === 'I3'), 'dois centavos ja e divergencia')
})

test('a tela de Fechamentos MOSTRA os invariantes', () => {
  // Teste de fiacao. Invariante calculado e nao mostrado nao protege ninguem -
  // e o mesmo defeito do item 57 (a rota mandava o dado e a tela nao lia).
  const tela = readFileSync(new URL('../app/fechamentos/page.tsx', import.meta.url), 'utf8')
  assert.ok(tela.includes('invariantesDoFechamento'), 'a tela nao calcula os invariantes')
  assert.ok(tela.includes('As contas deste fechamento não fecham'), 'a tela nao avisa o usuario')
})
