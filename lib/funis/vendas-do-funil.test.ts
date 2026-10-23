import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agregarVendasDoFunil, type VendaParaFunil } from './vendas-do-funil'

// Soma as vendas reais do banco que pertencem a UM funil, no periodo ja filtrado.
// Definicao de dinheiro (dono 21/10/2026, bate com o DRE):
//   faturamento bruto = soma de valor_pago_cliente das vendas APROVADAS do funil
//   taxas             = valor_pago_cliente - valor_liquido
// O match com o funil e por produto_id/nome (funilDaVenda). Reembolso NAO abate
// aqui (bloco a parte). Ver itens 114.4 e 114.5 do spr-digital.md.

const v = (o: Partial<VendaParaFunil>): VendaParaFunil => ({
  plataforma: 'hubla', produto: 'COMO SER PERDOADO', produto_id: '1s8rVxvbITB2ejQHEHKx',
  status: 'aprovada', valor_pago_cliente: 169, valor_liquido: 155, ...o,
})

test('soma faturamento bruto e conta vendas aprovadas do funil', () => {
  const r = agregarVendasDoFunil([
    v({ valor_pago_cliente: 169, valor_liquido: 155 }),
    v({ valor_pago_cliente: 200, valor_liquido: 180, produto: 'ALIANÇA SAGRADA - CSP', produto_id: 'eNsZ824PsAgz2DrvKYxw' }),
  ], 'como-ser-perdoado')
  assert.equal(r.vendas, 2)
  assert.equal(r.vendasPrincipal, 1) // só COMO SER PERDOADO é principal; ALIANÇA é agregado
  assert.equal(r.faturamentoBruto, 369)
  assert.equal(r.taxas, 34) // (169-155) + (200-180)
})

test('ignora venda que NAO e aprovada (reembolsada/chargeback/etc nao contam no faturamento)', () => {
  const r = agregarVendasDoFunil([
    v({ status: 'aprovada', valor_pago_cliente: 169, valor_liquido: 155 }),
    v({ status: 'reembolsada', valor_pago_cliente: 169, valor_liquido: 155 }),
    v({ status: 'chargeback', valor_pago_cliente: 169, valor_liquido: 155 }),
  ], 'como-ser-perdoado')
  assert.equal(r.vendas, 1)
  assert.equal(r.faturamentoBruto, 169)
})

test('ignora venda de OUTRO funil e de funil nenhum', () => {
  const r = agregarVendasDoFunil([
    v({}), // CSP
    v({ produto: 'Imersão - A reaproximação', produto_id: 'd7tvBd7toCPnVZnOWUaZ' }), // Imersao
    v({ produto: 'O RESGATE', produto_id: 't4ytLBgwp69xubk1irZK' }), // fora
    v({ produto: '🥝 O Resgate', produto_id: '72fcdce0-d821-11f0-96bf-731259ca42de', plataforma: 'kiwify' }), // fora
  ], 'como-ser-perdoado')
  assert.equal(r.vendas, 1)
  assert.equal(r.faturamentoBruto, 169)
})

test('casa a venda antiga (sem produto_id) pelo NOME', () => {
  const r = agregarVendasDoFunil([
    v({ produto_id: null, produto: 'Imersão - A reaproximação', plataforma: 'hubla', valor_pago_cliente: 97, valor_liquido: 90 }),
  ], 'imersao-reaproximacao')
  assert.equal(r.vendas, 1)
  assert.equal(r.faturamentoBruto, 97)
})

test('CCC (produto de outro funil) NAO entra na Imersao', () => {
  const r = agregarVendasDoFunil([
    v({ produto: 'Combo: Primeiros Passos da Restauração - OB - CCC', produto_id: 'f4b38af0-95c1-11f1-88b7-218470cae9f9', plataforma: 'kiwify' }),
    v({ produto: 'Como convencer seu cônjuge', produto_id: 'e31dee20-e261-11f0-a414-67ac2fb5caa6', plataforma: 'kiwify' }),
  ], 'imersao-reaproximacao')
  assert.equal(r.vendas, 0)
  assert.equal(r.faturamentoBruto, 0)
})

test('IGNORA venda em moeda estrangeira nao convertida (furo item 117/121)', () => {
  // enquanto `moeda` esta preenchida, os valores estao em dolar (nao convertidos);
  // contar como real subestima ~5x. O funil exclui, igual o DRE (precisaConverter).
  const r = agregarVendasDoFunil([
    v({ valor_pago_cliente: 169, valor_liquido: 155 }),                 // real -> conta
    v({ valor_pago_cliente: 278, valor_liquido: 250, moeda: 'USD' }),   // dolar -> NAO conta
  ], 'como-ser-perdoado')
  assert.equal(r.vendas, 1)
  assert.equal(r.faturamentoBruto, 169)
})

test('arredonda em centavos (sem lixo de ponto flutuante)', () => {
  const r = agregarVendasDoFunil([
    v({ valor_pago_cliente: 0.1, valor_liquido: 0 }),
    v({ valor_pago_cliente: 0.2, valor_liquido: 0, produto: 'ALIANÇA SAGRADA - CSP', produto_id: 'eNsZ824PsAgz2DrvKYxw' }),
  ], 'como-ser-perdoado')
  assert.equal(r.faturamentoBruto, 0.3)
  assert.equal(r.taxas, 0.3)
})
