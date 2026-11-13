import { test } from 'node:test'
import assert from 'node:assert/strict'
import { receitaDoMesNoDre } from './dre-do-mes'

// DRE (dono 13/11/2026): o resultado passa a descontar o imposto (antes a linha
// de taxas devolvia o imposto e o resultado saia sem ele) e a aliquota segue a
// data da venda: 20/10/2026 em diante, regra nova.

const perto = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`)
const hubla = (o: Record<string, unknown>) => ({ plataforma: 'hubla', valor_com_juros: null, ...o }) as never

test('taxas = bruto - liquido; receita liquida = liquido - imposto', () => {
  const r = receitaDoMesNoDre([
    hubla({ valor_pago_cliente: 297, preco_base: 297, valor_liquido: 280, data_hora: '2026-11-05T10:00:00' }),
    hubla({ valor_pago_cliente: 97, preco_base: 97, valor_liquido: 90, data_hora: '2026-10-15T10:00:00' }),
  ])
  perto(r.receitaBruta, 394)
  perto(r.impostos, 297 * 8.71 / 100 + 97 * 3 / 100)
  perto(r.impostos, 28.7787)
  perto(r.taxasPlataforma, 24)
  perto(r.receitaLiquida, 341.2213)
  assert.equal(r.liquidoPosImpostos, r.receitaLiquida)
})

test('liquido maior que o bruto: taxa fica negativa e a conta continua fechando', () => {
  const r = receitaDoMesNoDre([hubla({ valor_pago_cliente: 100, preco_base: 100, valor_liquido: 110, data_hora: '2026-11-01T00:00:00' })])
  perto(r.taxasPlataforma, -10)
  perto(r.receitaLiquida, 110 - 3.8)
})

test('Kiwify: bruto pelo preco_base, imposto pela base com juros', () => {
  const r = receitaDoMesNoDre([{ plataforma: 'kiwify', preco_base: 197, valor_pago_cliente: 210, valor_com_juros: 230, valor_liquido: 180, data_hora: '2026-10-25T10:00:00' } as never])
  perto(r.receitaBruta, 197)
  perto(r.impostos, 230 * 8.71 / 100)
  perto(r.receitaLiquida, 180 - 230 * 8.71 / 100)
})

test('mes sem venda: tudo zero', () => {
  assert.deepEqual(receitaDoMesNoDre([]), { receitaBruta: 0, impostos: 0, taxasPlataforma: 0, receitaLiquida: 0, liquidoPosImpostos: 0 })
})

test('Hubla com preco R$ 167 e pagamento R$ 180: faixa pelo preco (3,8%), bruto e base pelo pago', () => {
  const r = receitaDoMesNoDre([hubla({ preco_base: 167, valor_pago_cliente: 180, valor_liquido: 160, data_hora: '2026-11-02T10:00:00' })])
  perto(r.receitaBruta, 180)
  perto(r.impostos, 6.84)
  perto(r.taxasPlataforma, 20)
  perto(r.receitaLiquida, 153.16)
})
