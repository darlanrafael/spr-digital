import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  podeConfirmarTrafego, respostaMetaCompleta,
  ERRO_TRAFEGO_INCOMPLETO, BLOQUEIO_FECHAMENTO_TRAFEGO, AVISO_DRE_META_INCOMPLETA, criarSequenciaDeBusca,
} from './trafego-do-fechamento'

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
const valida = { total: 22000, campanhas: [{ name: 'CSP', spend: 22000, accountId: 'A' }] }
test('respostaMetaCompleta: { error } com total = incompleta', () => assert.equal(respostaMetaCompleta({ ok: true, corpo: { ...valida, error: 'x' } as never }), false))
test('respostaMetaCompleta: { erro } com total = incompleta', () => assert.equal(respostaMetaCompleta({ ok: true, corpo: { ...valida, erro: 'x' } as never }), false))
test('respostaMetaCompleta: { incompleto: true } com total = incompleta', () => assert.equal(respostaMetaCompleta({ ok: true, corpo: { ...valida, incompleto: true } as never }), false))
test('respostaMetaCompleta: total 0 sem gasto = completa', () => assert.equal(respostaMetaCompleta({ ok: true, corpo: { total: 0, campanhas: [] } as never }), true))
test('termos + busca completa com total 0 (periodo sem gasto): libera', () => assert.equal(podeConfirmarTrafego({ ...base, total: 0 }), true))
test('respostaMetaCompleta: resposta normal = completa', () =>
  assert.equal(respostaMetaCompleta({ ok: true, corpo: { total: 10, campanhas: [] } as never }), true))

test('textos exatos (dono 10/11/2026)', () => {
  assert.equal(ERRO_TRAFEGO_INCOMPLETO, 'A Meta não respondeu por completo. Clique em Buscar de novo antes de fechar.')
  assert.equal(BLOQUEIO_FECHAMENTO_TRAFEGO, 'O custo de tráfego não veio completo da Meta. Busque de novo antes de confirmar o fechamento.')
  assert.equal(AVISO_DRE_META_INCOMPLETA, 'A Meta não respondeu por completo. O valor de Meta Ads pode estar menor do que o real. Atualize a página.')
})

// Ordem das respostas no Fechamento (revisao Codex t6): resposta de busca
// superada (nova busca ou ultimo termo removido) nunca e aplicada.
test('sequencia: busca nova supera a antiga', () => {
  const seq = criarSequenciaDeBusca()
  const b1 = seq.iniciar()
  const b2 = seq.iniciar()
  assert.equal(seq.vigente(b1), false)
  assert.equal(seq.vigente(b2), true)
})
test('sequencia: remover o ultimo termo invalida a busca em andamento', () => {
  const seq = criarSequenciaDeBusca()
  const b1 = seq.iniciar()
  seq.invalidar()
  assert.equal(seq.vigente(b1), false)
})
test('sequencia: buscar, remover o ultimo termo, readicionar e buscar de novo: so a ultima vale', () => {
  const seq = criarSequenciaDeBusca()
  const b1 = seq.iniciar()
  seq.invalidar()
  const b2 = seq.iniciar()
  assert.equal(seq.vigente(b1), false)
  assert.equal(seq.vigente(b2), true)
})
test('sequencia: sequencias independentes nao se misturam', () => {
  const a = criarSequenciaDeBusca(), b = criarSequenciaDeBusca()
  const na = a.iniciar(); b.iniciar(); b.iniciar()
  assert.equal(a.vigente(na), true)
})
