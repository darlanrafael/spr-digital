import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PRODUTOS_DO_LANCAMENTO_MANUAL, produtoDoLancamento, ehDiagnosticoNoLancamento,
  totalDeSessoes, divisaoDoDiagnostico,
} from './produtos-do-lancamento-manual'
import { SESSOES_POR_FORMATO_PUBLICO } from './diagnostico-guiado'

const PEDRO = 'Mentoria Particular - Pedro Roncada'
const DENISE = 'Mentoria Particular - Denise Nascimento'
const DIAG = 'Diagnóstico Guiado: Programa de acompanhamento Individual'

test('sao exatamente os tres produtos que o usuario definiu', () => {
  assert.deepEqual(PRODUTOS_DO_LANCAMENTO_MANUAL.map(p => p.nome), [PEDRO, DENISE, DIAG])
})

test('Mentoria pergunta QUANTIDADE, Diagnostico pergunta FORMATO', () => {
  assert.equal(produtoDoLancamento(PEDRO)?.pergunta, 'quantidade')
  assert.equal(produtoDoLancamento(DENISE)?.pergunta, 'quantidade')
  assert.equal(produtoDoLancamento(DIAG)?.pergunta, 'formato')
  assert.ok(ehDiagnosticoNoLancamento(DIAG))
  assert.equal(ehDiagnosticoNoLancamento(PEDRO), false)
})

test('cada Mentoria ja sugere o terapeuta dela', () => {
  assert.equal(produtoDoLancamento(PEDRO)?.terapeutaPadrao, 'pedro')
  assert.equal(produtoDoLancamento(DENISE)?.terapeutaPadrao, 'denise')
  // O Diagnostico nao sugere: ele divide entre os dois.
  assert.equal(produtoDoLancamento(DIAG)?.terapeutaPadrao, null)
})

test('produto fora da lista nao passa', () => {
  assert.equal(produtoDoLancamento('Qualquer coisa'), null)
  assert.equal(produtoDoLancamento(''), null)
  assert.equal(produtoDoLancamento(null), null)
  assert.match(totalDeSessoes({ produto: 'Qualquer coisa', quantidade: 4 }).erro!, /Escolha um dos produtos/)
})

test('no Diagnostico a quantidade vem do FORMATO, nao de quem lanca', () => {
  assert.equal(totalDeSessoes({ produto: DIAG, formato: 1 }).total, 9)
  assert.equal(totalDeSessoes({ produto: DIAG, formato: 2 }).total, 4)
  assert.equal(totalDeSessoes({ produto: DIAG, formato: 3 }).total, 2)
  // Mesmo mandando quantidade junto, o formato manda.
  assert.equal(totalDeSessoes({ produto: DIAG, formato: 2, quantidade: 99 }).total, 4)
})

test('Diagnostico sem formato nao passa', () => {
  assert.match(totalDeSessoes({ produto: DIAG }).erro!, /Escolha o formato/)
  assert.equal(totalDeSessoes({ produto: DIAG }).total, null)
})

test('na Mentoria a quantidade e do comercial, com limite', () => {
  assert.equal(totalDeSessoes({ produto: PEDRO, quantidade: 4 }).total, 4)
  assert.equal(totalDeSessoes({ produto: DENISE, quantidade: 60 }).total, 60)
  for (const q of [0, -1, 61, 4.5, null]) {
    assert.equal(totalDeSessoes({ produto: PEDRO, quantidade: q as number }).total, null, String(q))
  }
})

test('a divisao do Diagnostico bate com a regra do produto', () => {
  assert.deepEqual(divisaoDoDiagnostico(1), { totalSessoes: 9, sessoesPedro: 2, sessoesDenise: 7 })
  assert.deepEqual(divisaoDoDiagnostico(2), { totalSessoes: 4, sessoesPedro: 1, sessoesDenise: 3 })
  assert.deepEqual(divisaoDoDiagnostico(3), { totalSessoes: 2, sessoesPedro: 1, sessoesDenise: 1 })
})

test('a tabela publica e a mesma que o resto do sistema usa', () => {
  // Se ela divergir da interna, o lancamento manual monta um pacote diferente
  // do que o agendamento de venda real monta - e ninguem percebe.
  assert.deepEqual(SESSOES_POR_FORMATO_PUBLICO, { 1: { totalSessoes: 9, sessoesPedro: 2 }, 2: { totalSessoes: 4, sessoesPedro: 1 }, 3: { totalSessoes: 2, sessoesPedro: 1 } })
})
