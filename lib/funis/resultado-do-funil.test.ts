import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resultadoDoFunil } from './resultado-do-funil'

// A conta do funil (dono 21/10/2026):
//   Faturamento bruto - Taxas da plataforma = Faturamento liquido
//   - Impostos (bruto * aliquota do funil)
//   - Investimento em trafego * 1,1385 (acrescimo 13,85%)
//   = Resultado liquido
//   ROAS = bruto / trafego ; Margem = liquido / bruto
// Aliquota POR FUNIL: Como Ser Perdoado 12,85%; Imersao 3,85%.

test('Como Ser Perdoado (12,85%): conta completa', () => {
  const r = resultadoDoFunil({ faturamentoBruto: 10000, taxas: 300, trafego: 1000, impostoRate: 0.1285 })
  assert.equal(r.faturamentoLiquido, 9700)
  assert.equal(r.impostos, 1285)              // 10000 * 0,1285
  assert.equal(r.trafegoComAcrescimo, 1138.5) // 1000 * 1,1385
  assert.equal(r.resultadoLiquido, 7276.5)    // 9700 - 1285 - 1138,5
  assert.equal(r.roas, 10)                     // 10000 / 1000
  assert.equal(r.margem, 0.72765)              // 7276,5 / 10000
})

test('Imersao (3,85%): so a aliquota muda', () => {
  const r = resultadoDoFunil({ faturamentoBruto: 10000, taxas: 300, trafego: 1000, impostoRate: 0.0385 })
  assert.equal(r.impostos, 385)
  assert.equal(r.resultadoLiquido, 10000 - 300 - 385 - 1138.5) // 8176,5
})

test('trafego zero: ROAS 0, sem acrescimo, sem divisao por zero', () => {
  const r = resultadoDoFunil({ faturamentoBruto: 5000, taxas: 100, trafego: 0, impostoRate: 0.1285 })
  assert.equal(r.trafegoComAcrescimo, 0)
  assert.equal(r.roas, 0)
  assert.equal(r.resultadoLiquido, 5000 - 100 - 642.5 - 0)
})

test('faturamento zero: margem 0 (sem divisao por zero)', () => {
  const r = resultadoDoFunil({ faturamentoBruto: 0, taxas: 0, trafego: 500, impostoRate: 0.1285 })
  assert.equal(r.margem, 0)
  assert.equal(r.resultadoLiquido, 0 - 0 - 0 - 569.25) // so o trafego, negativo
})

test('resultado negativo quando o trafego come tudo', () => {
  const r = resultadoDoFunil({ faturamentoBruto: 1000, taxas: 50, trafego: 2000, impostoRate: 0.1285 })
  assert.ok(r.resultadoLiquido < 0)
  assert.ok(r.margem < 0)
})
