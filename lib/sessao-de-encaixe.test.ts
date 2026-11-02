import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sessaoDeEncaixe } from './sessao-de-encaixe'

// Qual sessao do agendamento vira aviso de "VENDA DE ENCAIXE" no grupo.
// Regra do dono em 26/10/2026, depois da Priscilla (Pedro): o Felipe vendeu um
// pacote de 2 sessoes com a 1a no mesmo dia e o grupo nao recebeu o aviso,
// porque so disparava com exatamente 1 sessao.

// 26/10/2026 10:22 BRT = 13:22 UTC
const AGORA = Date.UTC(2026, 9, 26, 13, 22)
const s = (iso: string, numero_sessao = 1) => ({ data_agendada: iso, numero_sessao })

test('CASO REAL Priscilla: venda nova, 2 sessoes, a 1a hoje -> avisa a 1a', () => {
  const sessoes = [s('2026-10-26T15:40:00Z', 1), s('2026-11-02T15:40:00Z', 2)]
  assert.deepEqual(sessaoDeEncaixe(sessoes, true, AGORA), sessoes[0])
})

test('venda nova sem sessao hoje -> nao avisa', () => {
  const sessoes = [s('2026-10-27T15:40:00Z', 1), s('2026-11-03T15:40:00Z', 2)]
  assert.equal(sessaoDeEncaixe(sessoes, true, AGORA), null)
})

test('REFAZER pacote antigo com datas de hoje -> nao avisa (era o alarme falso)', () => {
  const sessoes = [s('2026-10-26T15:40:00Z', 1), s('2026-10-26T18:00:00Z', 2), s('2026-11-02T15:40:00Z', 3)]
  assert.equal(sessaoDeEncaixe(sessoes, false, AGORA), null)
})

test('sessao avulsa hoje continua avisando, mesmo refazendo (comportamento de antes)', () => {
  const sessoes = [s('2026-10-26T15:40:00Z', 1)]
  assert.deepEqual(sessaoDeEncaixe(sessoes, false, AGORA), sessoes[0])
  assert.deepEqual(sessaoDeEncaixe(sessoes, true, AGORA), sessoes[0])
})

test('sessao avulsa em outro dia nao avisa', () => {
  assert.equal(sessaoDeEncaixe([s('2026-10-27T15:40:00Z', 1)], true, AGORA), null)
})

test('duas sessoes hoje (sessoes coladas) -> um aviso so, da mais cedo', () => {
  const sessoes = [s('2026-10-26T16:30:00Z', 2), s('2026-10-26T15:40:00Z', 1), s('2026-11-02T15:40:00Z', 3)]
  assert.deepEqual(sessaoDeEncaixe(sessoes, true, AGORA), sessoes[1])
})

test('hoje e o dia de Brasilia: 22h BRT ainda e hoje, mesmo ja sendo amanha em UTC', () => {
  const noite = Date.UTC(2026, 9, 27, 0, 30) // 26/10 21:30 BRT
  const sessoes = [s('2026-10-27T01:00:00Z', 1), s('2026-11-02T15:40:00Z', 2)] // 26/10 22:00 BRT
  assert.deepEqual(sessaoDeEncaixe(sessoes, true, noite), sessoes[0])
})

test('lista vazia nao quebra', () => {
  assert.equal(sessaoDeEncaixe([], true, AGORA), null)
})
