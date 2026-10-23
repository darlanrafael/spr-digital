import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agregarEsteira, type VendaParaEsteira } from './esteira-do-funil'

// A ESTEIRA (value ladder) do funil: estagios FIXOS, montados SEMPRE, com ou sem
// venda no periodo (dono 23/10/2026). Order bumps entram numa linha so. Boca =
// produto principal. Ver item 119 do spr-digital.md.

const v = (o: Partial<VendaParaEsteira>): VendaParaEsteira => ({
  plataforma: 'hubla', produto: 'COMO SER PERDOADO', produto_id: '1s8rVxvbITB2ejQHEHKx',
  status: 'aprovada', valor_pago_cliente: 100, ...o,
})

test('monta SEMPRE todos os estagios na ordem, zerados quando nao ha venda', () => {
  const e = agregarEsteira([], 'como-ser-perdoado')
  assert.deepEqual(e.map(x => x.rotulo), ['Como Ser Perdoado', 'Order bumps', 'Mentoria em grupo', 'O Resgate - CSP'])
  assert.deepEqual(e.map(x => x.vendas), [0, 0, 0, 0])
  assert.deepEqual(e.map(x => x.faturamento), [0, 0, 0, 0])
})

test('order bumps diferentes caem na MESMA linha (somados)', () => {
  const e = agregarEsteira([
    v({ produto: 'ALIANÇA SAGRADA - CSP', produto_id: 'eNsZ824PsAgz2DrvKYxw', valor_pago_cliente: 50 }),
    v({ produto: 'ACESSO VITALÍCIO - CSP', produto_id: 'HYscfyfSoG2CrsS6JpSe', valor_pago_cliente: 70 }),
    v({ produto: 'COMBO - OS PRIMEIROS PASSOS DA RESTAURAÇÃO - CSP', produto_id: 'OOKdn0lKVKGBBLhY78BY', valor_pago_cliente: 30 }),
  ], 'como-ser-perdoado')
  const ob = e.find(x => x.rotulo === 'Order bumps')!
  assert.equal(ob.vendas, 3)
  assert.equal(ob.faturamento, 150)
})

test('principal na boca; mentoria (2 plataformas) soma no estagio upsell', () => {
  const e = agregarEsteira([
    v({}), // Como Ser Perdoado principal
    v({ produto: 'MENTORIA EM GRUPO - PEDRO RONCADA', produto_id: 'FL2Rs2rICpeVMCW77j6n', valor_pago_cliente: 497 }),
    v({ produto: 'Mentoria em grupo- Pedro Roncada', produto_id: 'b7dee3f0-5b82-11f1-bec6-3d073756b1c6', plataforma: 'kiwify', valor_pago_cliente: 497 }),
  ], 'como-ser-perdoado')
  assert.equal(e.find(x => x.rotulo === 'Como Ser Perdoado')!.vendas, 1)
  assert.equal(e.find(x => x.rotulo === 'Mentoria em grupo')!.vendas, 2)
  assert.equal(e.find(x => x.rotulo === 'Mentoria em grupo')!.faturamento, 994)
})

test('so conta aprovada; venda de outro funil e ignorada', () => {
  const e = agregarEsteira([
    v({ status: 'reembolsada' }),
    v({ produto: 'Imersão - A reaproximação', produto_id: 'd7tvBd7toCPnVZnOWUaZ' }), // outro funil
  ], 'como-ser-perdoado')
  assert.deepEqual(e.map(x => x.vendas), [0, 0, 0, 0])
})

test('funil inexistente devolve lista vazia', () => {
  assert.deepEqual(agregarEsteira([], 'nao-existe'), [])
})
