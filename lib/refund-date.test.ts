import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hublaRefundDate, kiwifyRefundDate } from './refund-date'

// statusAt real de um estorno da Hubla (evento de 12/08/2026).
const STATUS_AT = [
  { when: '2026-07-31T13:08:18.815Z', status: 'unpaid' },
  { when: '2026-07-31T13:08:22.597Z', status: 'paid' },
  { when: '2026-08-12T22:31:01.879Z', status: 'refunded' },
]

const AGORA = new Date('2026-08-20T12:00:00.000Z')

test('hubla: usa o instante em que a fatura virou refunded, não o de processamento', () => {
  // 22:31 UTC = 19:31 em Brasília, mesmo dia.
  assert.equal(hublaRefundDate({ statusAt: STATUS_AT }, AGORA), '2026-08-12')
})

test('hubla: estorno após as 21h de Brasília não pula para o dia seguinte', () => {
  // O bug que isto corrige: 00:30 UTC do dia 13 é 21:30 do dia 12 em Brasília.
  const statusAt = [{ when: '2026-08-13T00:30:00.000Z', status: 'refunded' }]
  assert.equal(hublaRefundDate({ statusAt }, AGORA), '2026-08-12')
})

test('hubla: com mais de um refunded, vale o mais recente', () => {
  const statusAt = [
    { when: '2026-08-01T10:00:00.000Z', status: 'refunded' },
    { when: '2026-08-05T10:00:00.000Z', status: 'refunded' },
  ]
  assert.equal(hublaRefundDate({ statusAt }, AGORA), '2026-08-05')
})

test('hubla: sem statusAt, cai para a data atual em Brasília', () => {
  assert.equal(hublaRefundDate({}, AGORA), '2026-08-20')
})

test('hubla: sem entrada refunded, cai para a data atual em Brasília', () => {
  const statusAt = [{ when: '2026-07-31T13:08:22.597Z', status: 'paid' }]
  assert.equal(hublaRefundDate({ statusAt }, AGORA), '2026-08-20')
})

test('kiwify: usa refunded_at, que já vem em horário de Brasília', () => {
  assert.equal(kiwifyRefundDate({ refunded_at: '2026-08-13 17:41' }, AGORA), '2026-08-13')
})

test('kiwify: sem refunded_at, cai para a data atual em Brasília', () => {
  assert.equal(kiwifyRefundDate({}, AGORA), '2026-08-20')
})

test('kiwify: refunded_at em formato inesperado não vira data inválida', () => {
  // Se a Kiwify mudar o formato, é melhor carimbar hoje do que gravar lixo na coluna.
  assert.equal(kiwifyRefundDate({ refunded_at: '13/08/2026 17:41' }, AGORA), '2026-08-20')
})

test('fallback também respeita Brasília: 01:00 UTC ainda é o dia anterior aqui', () => {
  const madrugada = new Date('2026-08-21T01:00:00.000Z')
  assert.equal(hublaRefundDate({}, madrugada), '2026-08-20')
  assert.equal(kiwifyRefundDate({}, madrugada), '2026-08-20')
})
