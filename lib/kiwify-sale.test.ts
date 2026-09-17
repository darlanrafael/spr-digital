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
