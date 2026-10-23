import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resultadoDiario, reembolsoDiario } from './cadencia-do-funil'

// Cadencia diaria do funil. O dia da venda vem de data_hora (ja normalizado em
// BRT pelo mapSaleRow -> slice(0,10)). O trafego por dia vem da Meta (data =
// YYYY-MM-DD). resultado do dia = (bruto - taxas) - bruto*imposto - trafego*1,1385.
// Reembolso: agrupado por data_reembolso (ja e uma DATA pura no banco).

test('resultado diario: combina vendas e trafego, aplica imposto e +13,85%', () => {
  const vendas = [
    { data_hora: '2026-10-01T10:00:00', valor_pago_cliente: 1000, valor_liquido: 950 },
    { data_hora: '2026-10-01T22:00:00', valor_pago_cliente: 1000, valor_liquido: 950 },
    { data_hora: '2026-10-02T09:00:00', valor_pago_cliente: 500, valor_liquido: 480 },
  ]
  const trafego = [{ data: '2026-10-01', investido: 400 }, { data: '2026-10-02', investido: 100 }]
  const r = resultadoDiario(vendas, trafego, 0.1285)
  // dia 1: bruto 2000, taxas 100 -> liquido 1900; imposto 2000*0.1285=257; trafego 400*1.1385=455.4
  //        resultado = 1900 - 257 - 455.4 = 1187.6
  assert.equal(r[0].data, '2026-10-01')
  assert.equal(r[0].faturamento, 2000)
  assert.equal(r[0].resultadoLiquido, 1187.6)
  // dia 2: bruto 500, taxas 20 -> liquido 480; imposto 64.25; trafego 100*1.1385=113.85
  //        resultado = 480 - 64.25 - 113.85 = 301.9
  assert.equal(r[1].data, '2026-10-02')
  assert.equal(r[1].resultadoLiquido, 301.9)
})

test('dia com trafego e SEM venda aparece (resultado negativo = so o trafego)', () => {
  const r = resultadoDiario([], [{ data: '2026-10-05', investido: 200 }], 0.1285)
  assert.equal(r.length, 1)
  assert.equal(r[0].data, '2026-10-05')
  assert.equal(r[0].faturamento, 0)
  assert.equal(r[0].resultadoLiquido, -227.7) // -200*1.1385
})

test('dia com venda e SEM trafego aparece', () => {
  const r = resultadoDiario([{ data_hora: '2026-10-06T10:00:00', valor_pago_cliente: 100, valor_liquido: 90 }], [], 0.0385)
  assert.equal(r[0].data, '2026-10-06')
  // liquido 90 - imposto 3.85 - 0 = 86.15
  assert.equal(r[0].resultadoLiquido, 86.15)
})

test('resultado diario sai ordenado por data', () => {
  const r = resultadoDiario(
    [{ data_hora: '2026-10-03T10:00:00', valor_pago_cliente: 100, valor_liquido: 90 }],
    [{ data: '2026-10-01', investido: 10 }, { data: '2026-10-02', investido: 10 }],
    0.1285,
  )
  assert.deepEqual(r.map(x => x.data), ['2026-10-01', '2026-10-02', '2026-10-03'])
})

test('reembolso diario agrupa por data_reembolso e soma valor_pago_cliente', () => {
  const r = reembolsoDiario([
    { data_reembolso: '2026-10-10', valor_pago_cliente: 100 },
    { data_reembolso: '2026-10-10', valor_pago_cliente: 50 },
    { data_reembolso: '2026-10-12', valor_pago_cliente: 200 },
  ])
  assert.deepEqual(r, [
    { data: '2026-10-10', reembolso: 150 },
    { data: '2026-10-12', reembolso: 200 },
  ])
})

test('reembolso ignora venda sem data_reembolso', () => {
  const r = reembolsoDiario([{ data_reembolso: null, valor_pago_cliente: 100 }, { data_reembolso: '2026-10-10', valor_pago_cliente: 30 }])
  assert.deepEqual(r, [{ data: '2026-10-10', reembolso: 30 }])
})
