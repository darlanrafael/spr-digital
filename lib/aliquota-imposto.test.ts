import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getAliquotaRegraAntiga } from './formatters'
import {
  REGRA_IMPOSTO_NOVA, aliquotaRegraNova, fechamentoEhDaRegraNova, idsDaRegraAntiga,
  aliquotaNoFechamento, aliquotaNoDre, aliquotaDaLinha, formatAliquota,
} from './aliquota-imposto'

// Aliquota nova (dono 13/11/2026). Fechamento: venda sem fechamento = regra nova.
// DRE/Dashboard: venda de 20/10/2026 em diante = regra nova. Ver
// docs/superpowers/specs/2026-11-13-aliquota-imposto-nova-design.md.

const perto = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`)

test('regra nova: 3,8% ate R$ 167 e 8,71% acima', () => {
  assert.equal(aliquotaRegraNova(166.99), 3.8)
  assert.equal(aliquotaRegraNova(167), 3.8)
  assert.equal(aliquotaRegraNova(167.01), 8.71)
  assert.equal(aliquotaRegraNova(0), 3.8)
  assert.equal(aliquotaRegraNova(5000), 8.71)
})

test('regra antiga continua 3% e 12,85%', () => {
  assert.equal(getAliquotaRegraAntiga(167), 3)
  assert.equal(getAliquotaRegraAntiga(167.01), 12.85)
})

test('idsDaRegraAntiga: so fechamentos sem a marca; null nao quebra', () => {
  const ids = idsDaRegraAntiga([
    { byProduct: [{}], compradores: [{ id: 'a' }, { id: 'b' }] },
    { byProduct: [{}, { regraImposto: REGRA_IMPOSTO_NOVA }], compradores: [{ id: 'c' }] },
    { compradores: [{ id: 'd' }] },
    { byProduct: null, compradores: null },
    { byProduct: [], compradores: [{}] },
  ])
  assert.deepEqual([...ids].sort(), ['a', 'b', 'd'])
  assert.equal(fechamentoEhDaRegraNova({ byProduct: [{ regraImposto: REGRA_IMPOSTO_NOVA }] }), true)
  assert.equal(fechamentoEhDaRegraNova({ byProduct: null }), false)
  assert.equal(REGRA_IMPOSTO_NOVA, 'nova-2026-11')
})

test('aliquotaNoFechamento: venda ja fechada pela regra antiga fica na antiga; o resto na nova', () => {
  const antigos = new Set(['x'])
  assert.equal(aliquotaNoFechamento({ id: 'x', preco_base: 297 }, antigos), 12.85)
  assert.equal(aliquotaNoFechamento({ id: 'y', preco_base: 297 }, antigos), 8.71)
  assert.equal(aliquotaNoFechamento({ id: 'y', preco_base: 97 }, antigos), 3.8)
  assert.equal(aliquotaNoFechamento({ id: 'x', preco_base: 97 }, antigos), 3)
})

test('aliquotaNoDre: corte em 20/10/2026 pelo dia (BRT) da venda', () => {
  assert.equal(aliquotaNoDre({ data_hora: '2026-10-19T23:59:59', preco_base: 297 }), 12.85)
  assert.equal(aliquotaNoDre({ data_hora: '2026-10-20T00:00:00', preco_base: 297 }), 8.71)
  assert.equal(aliquotaNoDre({ data_hora: '2026-11-05T10:00:00', preco_base: 97 }), 3.8)
  assert.equal(aliquotaNoDre({ data_hora: '2026-09-01T00:00:00', preco_base: 97 }), 3)
})

test('aliquotaDaLinha: uniforme mostra a aliquota; mista mostra a efetiva; base zero = 0', () => {
  assert.deepEqual(aliquotaDaLinha([{ base: 100, aliquota: 8.71 }, { base: 50, aliquota: 8.71 }]), { aliquota: 8.71, efetiva: false })
  assert.deepEqual(aliquotaDaLinha([{ base: 100, aliquota: 8.71 }, { base: 100, aliquota: 12.85 }]), { aliquota: 10.78, efetiva: true })
  assert.deepEqual(aliquotaDaLinha([{ base: 200, aliquota: 3.8 }, { base: 100, aliquota: 8.71 }]), { aliquota: 5.44, efetiva: true })
  assert.deepEqual(aliquotaDaLinha([{ base: 0, aliquota: 8.71 }, { base: 100, aliquota: 3.8 }]), { aliquota: 3.8, efetiva: false })
  assert.deepEqual(aliquotaDaLinha([]), { aliquota: 0, efetiva: false })
  assert.deepEqual(aliquotaDaLinha([{ base: 0, aliquota: 3 }]), { aliquota: 0, efetiva: false })
})

test('formatAliquota: virgula, sem zero sobrando; efetiva com duas casas', () => {
  assert.equal(formatAliquota(3), '3%')
  assert.equal(formatAliquota(3.8), '3,8%')
  assert.equal(formatAliquota(8.71), '8,71%')
  assert.equal(formatAliquota(12.85), '12,85%')
  assert.equal(formatAliquota(10.78, true), '10,78%')
  assert.equal(formatAliquota(10.1, true), '10,10%')
  assert.equal(formatAliquota(0), '0%')
})

test('aceitacao: imposto da empresa na regra nova e repasse do terapeuta com a antiga', () => {
  const aliquota = aliquotaNoFechamento({ id: 'nova', preco_base: 1000 }, new Set())
  const imposto = 1000 * aliquota / 100
  const impostoDoRepasse = 1000 * getAliquotaRegraAntiga(1000) / 100
  const repasse = (900 - impostoDoRepasse) * 30 / 100
  perto(imposto, 87.1)
  perto(impostoDoRepasse, 128.5)
  perto(repasse, 231.45)
  perto(900 - imposto - repasse, 581.45)
})
