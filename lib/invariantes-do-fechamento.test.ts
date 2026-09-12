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

test('meio centavo nao gera aviso - a dizima da comissao nao pode virar alarme', () => {
  // Comissao real tem cauda longa: 88.216498125. Meio centavo arredonda para
  // zero em centavos inteiros e passa calado, como tem que ser.
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

// ── Casos de FRONTEIRA, achados pelo teste de mutacao em 12/09/2026 ─────────
//
// O modulo marcava 70%: sete mutantes sobreviviam, todos em `>` que virava `>=`
// e em uma subtracao. Nenhum teste exercitava o limite exato - e limite e
// justamente onde "avisa" e "nao avisa" se decidem.

test('UM centavo passa calado; DOIS avisam - o limite e exato', () => {
  // Este teste derrubou a primeira versao do modulo, que comparava em reais:
  // em ponto flutuante `9770 - (9770 + 0.011)` da -0.011000000000422, maior que
  // a tolerancia de 0.011. Nao existia "exatamente na tolerancia". A conta
  // passou a ser em CENTAVOS INTEIROS, onde o limite e exato.
  const umCentavo = invariantesDoFechamento({ ...OK, faturamentoBruto: 9770.01 })
  assert.deepEqual(umCentavo, [], 'um centavo e arredondamento')
  const doisCentavos = invariantesDoFechamento({ ...OK, faturamentoBruto: 9770.02 })
  assert.ok(doisCentavos.some(x => x.id === 'I3'), 'dois centavos ja e divergencia')
  // E a diferenca mostrada tem que ser exata, sem cauda de ponto flutuante.
  const dif = doisCentavos.find(x => x.id === 'I3')!.diferenca
  assert.equal(dif, -0.02)
})

test('deducao dos socios EXATAMENTE zero nao entra na conferencia de I1 e I4', () => {
  // `deducaoDosSocios > 0` virando `>= 0` fazia I1 rodar com zero e comparar
  // zero com zero - passa igual. O caso que distingue e deducao zero com
  // soma por socio DIFERENTE de zero, que so pode acontecer por defeito.
  const r = invariantesDoFechamento({ ...OK, deducaoDosSocios: 0, deducaoPorSocio: [500, 500] })
  assert.deepEqual(r, [], 'empresa absorvendo: a soma por socio nao e conferida')
})

test('repasse EXATAMENTE zero nao e apontado, um centavo e', () => {
  // `repasse > 0` virando `>= 0` faria todo produto sem repasse ser apontado.
  const semRepasse = invariantesDoFechamento({
    ...OK,
    byProduct: [{ nome: 'X', qtd: 1, bruto: 0, taxas: 0, imposto: 0, liquido: 0, repasse_terapeuta: 0 }],
    faturamentoBruto: 0, taxasPlataforma: 0, impostoTotal: 0, faturamentoLiquido: 0,
  })
  assert.deepEqual(semRepasse, [], 'produto sem repasse e sem faturamento nao e erro')

  const comCentavo = invariantesDoFechamento({
    ...OK,
    byProduct: [{ nome: 'X', qtd: 1, bruto: 0, taxas: 0, imposto: 0, liquido: 0, repasse_terapeuta: 0.01 }],
    faturamentoBruto: 0, taxasPlataforma: 0, impostoTotal: 0, faturamentoLiquido: 0,
  })
  assert.ok(comCentavo.some(x => x.id === 'I2'), 'um centavo de repasse sem base ja e erro')
})

test('I4 no limite: deducao IGUAL aos estornos nao avisa', () => {
  // `> TOLERANCIA` virando `>=` fazia o caso exato avisar. Deducao igual ao
  // estorno e o normal, nao o defeito.
  const r = invariantesDoFechamento({
    ...OK,
    alertasSelecionados: [{ valor: 2297.45 }],
    deducaoDosSocios: 2297.45,
    deducaoPorSocio: [1000.35, 1297.10],
  })
  assert.deepEqual(r, [], 'deducao igual ao estorno e o caso normal')
})

test('I4 informa a diferenca com o SINAL certo', () => {
  // O mutante trocava a subtracao da `diferenca` por soma. Sem conferir o
  // valor, ninguem nota.
  const r = invariantesDoFechamento({
    ...OK,
    alertasSelecionados: [{ valor: 1000 }],
    deducaoDosSocios: 1500,
    deducaoPorSocio: [700, 800],
  })
  const i4 = r.find(x => x.id === 'I4')!
  assert.equal(i4.diferenca, 500, 'a diferenca e o EXCESSO: 1500 - 1000')
})

test('I4 no limite de UM centavo passa; DOIS avisam', () => {
  // Mutante que sobrevivia: `> TOLERANCIA_EM_CENTAVOS` virando `>=`.
  const base = { ...OK, alertasSelecionados: [{ valor: 1000 }], deducaoPorSocio: [500, 500.01] }
  assert.deepEqual(invariantesDoFechamento({ ...base, deducaoDosSocios: 1000.01 }), [],
    'um centavo acima do estorno e arredondamento')
  const r = invariantesDoFechamento({ ...base, deducaoDosSocios: 1000.02, deducaoPorSocio: [500, 500.02] })
  assert.ok(r.some(x => x.id === 'I4'), 'dois centavos acima ja avisa')
})

test('I5 informa QUANTAS vendas estao repetidas, nao o total de linhas', () => {
  // Mutante que sobrevivia: a subtracao do `esperado` virando soma. Sem
  // conferir o numero, o aviso apareceria com a contagem errada.
  const r = invariantesDoFechamento({
    ...OK,
    compradores: [{ id: 'a' }, { id: 'b' }, { id: 'a' }, { id: 'c' }, { id: 'b' }],
  })
  const i5 = r.find(x => x.id === 'I5')!
  assert.equal(i5.encontrado, 5, 'cinco linhas na lista')
  assert.equal(i5.esperado, 3, 'tres vendas distintas')
  assert.equal(i5.diferenca, 2, 'duas repetidas')
})
