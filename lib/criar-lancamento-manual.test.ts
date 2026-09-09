import { test } from 'node:test'
import assert from 'node:assert/strict'
import { datasDoLancamento } from './criar-lancamento-manual'

const base = { terapeuta_id: 't1' }
const hh = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ')

test('sem data de referencia, nenhuma sessao e calculada', () => {
  const r = datasDoLancamento({ ...base, total_sessoes: 4 })
  assert.deepEqual(r.entregues, [])
  assert.deepEqual(r.futuras, [])
  assert.equal(r.totalSessoes, 4)
})

test('as futuras saem de 7 em 7 dias a partir da proxima', () => {
  const r = datasDoLancamento({ ...base, total_sessoes: 3, sessoes_entregues: 0, proxima_sessao_data: '2026-10-01T10:30' })
  assert.equal(r.futuras.length, 3)
  assert.equal(hh(r.futuras[0]), '2026-10-01 10:30')
  assert.equal(hh(r.futuras[1]), '2026-10-08 10:30')
  assert.equal(hh(r.futuras[2]), '2026-10-15 10:30')
})

test('as entregues saem de 7 em 7 dias PARA TRAS', () => {
  // Data no passado de proposito: com proxima no futuro, a guarda do caso
  // Buzetti recusa - e e o teste seguinte que cobre isso.
  const r = datasDoLancamento({ ...base, total_sessoes: 3, sessoes_entregues: 2, proxima_sessao_data: '2026-02-05T10:30' })
  assert.equal(r.entregues.length, 2)
  assert.equal(hh(r.entregues[0]), '2026-01-22 10:30')
  assert.equal(hh(r.entregues[1]), '2026-01-29 10:30')
  assert.equal(r.futuras.length, 1)
  assert.equal(hh(r.futuras[0]), '2026-02-05 10:30')
})

test('CASO REAL DO BUZETTI: entregue que cairia no futuro e recusada', () => {
  // Lancado em 04/09 com proxima em 17/09 e 1 entregue: a conta deu 10/09,
  // seis dias no futuro. A sessao nascia "entregue", ocupava horario na agenda
  // e contava nas metricas antes de acontecer.
  const daquiUmMes = new Date(Date.now() + 30 * 24 * 3600 * 1000)
  const iso = new Date(daquiUmMes.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 16)
  const r = datasDoLancamento({ ...base, total_sessoes: 2, sessoes_entregues: 1, proxima_sessao_data: iso })
  assert.ok(r.erro, 'tinha que recusar')
  assert.match(r.erro!, /sairiam com data no futuro/)
  assert.deepEqual(r.entregues, [])
})

test('entregue no passado passa normalmente', () => {
  const r = datasDoLancamento({ ...base, total_sessoes: 2, sessoes_entregues: 1, proxima_sessao_data: '2026-01-15T10:30' })
  assert.equal(r.erro, undefined)
  assert.equal(r.entregues.length, 1)
})

test('datas futuras informadas a mao vencem a regua de 7 dias', () => {
  const r = datasDoLancamento({
    ...base, total_sessoes: 2, sessoes_entregues: 0,
    proxima_sessao_data: '2026-10-01T10:30',
    datas_futuras: ['2026-10-01T10:30', '2026-10-20T14:00'],
  })
  assert.equal(hh(r.futuras[1]), '2026-10-20 14:00')
})

test('lista de datas com tamanho errado e ignorada, e volta a regua', () => {
  const r = datasDoLancamento({
    ...base, total_sessoes: 3, sessoes_entregues: 0,
    proxima_sessao_data: '2026-10-01T10:30',
    datas_futuras: ['2026-10-01T10:30'],
  })
  assert.equal(r.futuras.length, 3)
  assert.equal(hh(r.futuras[1]), '2026-10-08 10:30')
})

test('entregues nao pode passar do total', () => {
  const r = datasDoLancamento({ ...base, total_sessoes: 2, sessoes_entregues: 9, proxima_sessao_data: '2026-01-15T10:30' })
  assert.equal(r.entregues.length, 2)
  assert.equal(r.futuras.length, 0)
})
