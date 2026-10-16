import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseKiwifySale } from './kiwify-sale'

test('parseKiwifySale monta a venda com os valores certos', () => {
  const order = {
    order_id: 'kw-1', approved_date: '2026-09-14T10:00:00Z',
    Product: { product_name: 'IImersão - A Reaproximação - Oficial', product_offer_name: 'X' },
    Customer: { full_name: 'Fulano', email: 'f@x.local', mobile: '' },
    Commissions: { charge_amount: 39900, my_commission: 35000, product_base_price: 39900, currency: 'BRL' },
    TrackingParameters: { utm_source: 'FB' },
  }
  const sale = parseKiwifySale(order as any)
  assert.equal(sale.plataforma, 'kiwify')
  assert.equal(sale.produto, 'IImersão - A Reaproximação - Oficial')
  assert.equal(sale.valor_pago_cliente, 399)
  assert.equal(sale.valor_liquido, 350)
  assert.equal(sale.order_id, 'kw-1')
})

test('CASO REAL: venda internacional da Kiwify sai em DOLAR e normalizada', () => {
  // Natalia Rezende (09/10/2026): pagou em peso mexicano, repasse em dolar.
  // A linha tem que sair toda em USD (bruto 542,79 = liquido 487,77 + taxa
  // 55,02) e marcada normalizado:true. Ver item 108 do spr-digital.md.
  const order = {
    order_id: 'kw-natalia', approved_date: '2026-10-09T03:23:00Z',
    Product: { product_name: 'Mentoria - Individual Pedro Roncada', product_offer_name: 'X' },
    Customer: { full_name: 'Natalia Rezende', email: 'natalia_rezende@hotmail.com', mobile: '' },
    Commissions: {
      currency: 'MXN', charge_amount: 1035400, my_commission: 48777,
      settlement_amount: 48777, settlement_amount_currency: 'USD',
      kiwify_fee: 5502, kiwify_fee_currency: 'USD', product_base_price: 286000,
    },
    TrackingParameters: {},
  }
  const sale = parseKiwifySale(order as any)
  assert.equal(sale.moeda, 'USD')
  assert.equal(sale.valor_liquido, 487.77)
  assert.equal(sale.valor_pago_cliente, 542.79)
  assert.equal(sale.preco_base, 542.79)
  assert.equal((sale.valores_originais as any).normalizado, true)
})
