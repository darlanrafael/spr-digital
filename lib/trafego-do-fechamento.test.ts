import { test } from 'node:test'
import assert from 'node:assert/strict'
import { podeConfirmarTrafego, respostaMetaCompleta } from './trafego-do-fechamento'

// Trava do "Confirmar fechamento" (dono 10/11/2026, Task 6 do plano
// docs/superpowers/plans/2026-11-10-botao-resgate-funis.md): o custo de trafego
// so pode ser gravado se veio de uma busca COMPLETA, ja terminada, com os mesmos
// termos e datas da tela. Prova rodada: uma conta da Meta falhando fazia o
// sistema devolver R$ 22.000 no lugar de R$ 30.000 sem erro nenhum.

const periodo = { inicio: '2026-10-01', fim: '2026-10-31' }
const busca = { termos: ['CSP', 'IRM'], inicio: '2026-10-01', fim: '2026-10-31' }
const base = { termos: ['CSP', 'IRM'], periodo, loading: false, erro: null as string | null, total: 34155, buscaCompleta: busca as typeof busca | null }

test('sem termos e total 0: libera mesmo com erro', () =>
  assert.equal(podeConfirmarTrafego({ ...base, termos: [], total: 0, erro: 'qualquer', buscaCompleta: null }), true))
test('sem termos e total sobrando de busca anterior: trava', () =>
  assert.equal(podeConfirmarTrafego({ ...base, termos: [], total: 10000, buscaCompleta: null }), false))
test('sem termos e buscando: trava', () =>
  assert.equal(podeConfirmarTrafego({ ...base, termos: [], total: 0, loading: true, buscaCompleta: null }), false))
test('termos + busca completa igual: libera', () => assert.equal(podeConfirmarTrafego(base), true))
test('buscando de novo: trava', () => assert.equal(podeConfirmarTrafego({ ...base, loading: true }), false))
test('com erro: trava', () => assert.equal(podeConfirmarTrafego({ ...base, erro: 'A Meta não respondeu' }), false))
test('nunca buscou ou a ultima foi incompleta: trava', () => assert.equal(podeConfirmarTrafego({ ...base, buscaCompleta: null }), false))
test('termo a mais na tela: trava', () => assert.equal(podeConfirmarTrafego({ ...base, termos: ['CSP', 'IRM', 'IAR'] }), false))
test('termo a menos na tela: trava', () => assert.equal(podeConfirmarTrafego({ ...base, termos: ['CSP'] }), false))
test('data de inicio diferente: trava', () => assert.equal(podeConfirmarTrafego({ ...base, periodo: { ...periodo, inicio: '2026-10-02' } }), false))
test('data de fim diferente: trava', () => assert.equal(podeConfirmarTrafego({ ...base, periodo: { ...periodo, fim: '2026-10-30' } }), false))
test('mesmos termos em outra ordem: libera', () => assert.equal(podeConfirmarTrafego({ ...base, termos: ['IRM', 'CSP'] }), true))
test('termo repetido nao engana a comparacao', () =>
  assert.equal(podeConfirmarTrafego({ ...base, termos: ['CSP', 'CSP'], buscaCompleta: { ...busca, termos: ['CSP', 'IRM'] } }), false))

test('respostaMetaCompleta: HTTP nao-ok (401/403/500) = incompleta', () =>
  assert.equal(respostaMetaCompleta({ ok: false, corpo: { total: 10 } as never }), false))
test('respostaMetaCompleta: corpo null = incompleta', () => assert.equal(respostaMetaCompleta({ ok: true, corpo: null }), false))
test('respostaMetaCompleta: { error } = incompleta', () => assert.equal(respostaMetaCompleta({ ok: true, corpo: { error: 'x' } }), false))
test('respostaMetaCompleta: { erro } = incompleta', () => assert.equal(respostaMetaCompleta({ ok: true, corpo: { erro: 'x' } }), false))
test('respostaMetaCompleta: { incompleto: true } = incompleta', () => assert.equal(respostaMetaCompleta({ ok: true, corpo: { incompleto: true } }), false))
test('respostaMetaCompleta: resposta normal = completa', () =>
  assert.equal(respostaMetaCompleta({ ok: true, corpo: { total: 10, campanhas: [] } as never }), true))
