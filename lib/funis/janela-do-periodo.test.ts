import { test } from 'node:test'
import assert from 'node:assert/strict'
import { janelaDoPeriodo } from './janela-do-periodo'

// A janela [de, ate] de um preset da tela de funis, em dia de Brasilia (UTC-3).
// A MESMA janela vai pra Meta e pras vendas (senao o ROAS compara periodos
// diferentes). "Ontem" entrou em 26/10/2026 a pedido do dono.

// 2026-10-26T15:00:00Z = 12:00 em Brasilia -> hoje BRT = 2026-10-26
const MEIO_DIA = Date.UTC(2026, 9, 26, 15, 0, 0)
// 2026-10-27T01:00:00Z = 22:00 do dia 26 em Brasilia -> hoje BRT ainda = 2026-10-26
const NOITE_BRT = Date.UTC(2026, 9, 27, 1, 0, 0)

test('hoje: so o dia de hoje em Brasilia', () => {
  assert.deepEqual(janelaDoPeriodo('today', '', '', MEIO_DIA), { de: '2026-10-26', ate: '2026-10-26' })
})

test('ontem: so o dia anterior, inteiro', () => {
  assert.deepEqual(janelaDoPeriodo('yesterday', '', '', MEIO_DIA), { de: '2026-10-25', ate: '2026-10-25' })
})

test('ontem as 22h de Brasilia (ja e dia seguinte em UTC) continua sendo o dia 25', () => {
  assert.deepEqual(janelaDoPeriodo('yesterday', '', '', NOITE_BRT), { de: '2026-10-25', ate: '2026-10-25' })
})

test('ontem na virada de mes', () => {
  const primeiroNov = Date.UTC(2026, 10, 1, 15, 0, 0) // 01/11 12h BRT
  assert.deepEqual(janelaDoPeriodo('yesterday', '', '', primeiroNov), { de: '2026-10-31', ate: '2026-10-31' })
})

test('7 dias: hoje e os 6 anteriores', () => {
  assert.deepEqual(janelaDoPeriodo('last_7d', '', '', MEIO_DIA), { de: '2026-10-20', ate: '2026-10-26' })
})

test('30 dias: hoje e os 29 anteriores', () => {
  assert.deepEqual(janelaDoPeriodo('last_30d', '', '', MEIO_DIA), { de: '2026-09-27', ate: '2026-10-26' })
})

test('periodo escolhido a mao vence o preset', () => {
  assert.deepEqual(janelaDoPeriodo('yesterday', '2026-10-01', '2026-10-10', MEIO_DIA), { de: '2026-10-01', ate: '2026-10-10' })
})

test('preset desconhecido cai em 7 dias (comportamento de antes)', () => {
  assert.deepEqual(janelaDoPeriodo('xyz', '', '', MEIO_DIA), { de: '2026-10-20', ate: '2026-10-26' })
})
