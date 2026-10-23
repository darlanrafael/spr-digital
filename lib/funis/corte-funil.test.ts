import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aplicarCorte } from './corte-funil'

// TRAVA de data (dono 23/10/2026): o funil so contabiliza a partir da data de
// corte. Qualquer periodo selecionado e "clampado" pra comecar no corte; periodo
// todo antes do corte vem zerado (semMeta = pula a Meta, vendas ja vem vazias).
// Datas ISO (YYYY-MM-DD) comparam cronologicamente como string. Ver item 120.

test('sem corte (null): passa direto, sem mexer', () => {
  assert.deepEqual(aplicarCorte('2026-10-01', '2026-10-10', null), { de: '2026-10-01', ate: '2026-10-10', semMeta: false })
})

test('periodo que CRUZA o corte: inicio vira a data de corte', () => {
  // "30 dias" terminando hoje (23): comeca antes do corte, mas inclui o 23 em diante
  assert.deepEqual(aplicarCorte('2026-09-24', '2026-10-23', '2026-10-23'), { de: '2026-10-23', ate: '2026-10-23', semMeta: false })
  assert.deepEqual(aplicarCorte('2026-10-20', '2026-10-30', '2026-10-23'), { de: '2026-10-23', ate: '2026-10-30', semMeta: false })
})

test('periodo TODO ANTES do corte: zerado (semMeta true)', () => {
  const r = aplicarCorte('2026-10-01', '2026-10-10', '2026-10-23')
  assert.equal(r.semMeta, true)
  assert.equal(r.de, '2026-10-23') // de > ate -> vendas vem vazias naturalmente
})

test('periodo TODO depois do corte: inalterado', () => {
  assert.deepEqual(aplicarCorte('2026-10-25', '2026-10-30', '2026-10-23'), { de: '2026-10-25', ate: '2026-10-30', semMeta: false })
})

test('inicio exatamente no corte: inalterado', () => {
  assert.deepEqual(aplicarCorte('2026-10-23', '2026-10-23', '2026-10-23'), { de: '2026-10-23', ate: '2026-10-23', semMeta: false })
})
