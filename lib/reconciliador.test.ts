import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decidirReinsercoes, reconstruirVenda } from './reconciliador'

const evHubla = (fat: string, prod='PROD1', id=fat) => ({ id, plataforma: 'hubla' as const, payload: { event: {
  invoice: { id: fat, saleDate: '2026-09-12T01:15:00Z', payer: { firstName: 'F', lastName: 'T', email: 'f@x.local' },
    amount: { subtotalCents: 29700, totalCents: 29700 }, receivers: [{ role: 'seller', totalCents: 28514 }], paymentSession: { utm: {} } },
  product: { id: prod, name: 'COMO SER PERDOADO' }, products: [{ offers: [{ id: prod }] }] } } })

test('insere so o que falta; pula o que ja existe', () => {
  const eventos = [evHubla('f1'), evHubla('f2')]
  const { inserir } = decidirReinsercoes(eventos, new Set(['f1-PROD1']))
  assert.equal(inserir.length, 1)
  assert.equal(inserir[0].sale.order_id, 'f2-PROD1')
  assert.equal(inserir[0].eventoId, 'f2')
})

test('dedup interno: mesmo order_id duas vezes no lote nao duplica', () => {
  const eventos = [evHubla('f1'), evHubla('f1')]
  const { inserir } = decidirReinsercoes(eventos, new Set())
  assert.equal(inserir.length, 1)
  assert.equal(inserir[0].sale.order_id, 'f1-PROD1')
})

test('venda sem order_id vai para semOrderId, nao para inserir', () => {
  const evSemFatura = { id: 'ev-sem-fatura', plataforma: 'hubla' as const, payload: { event: {
    invoice: { saleDate: '2026-09-12T01:15:00Z', payer: { firstName: 'F', lastName: 'T', email: 'f@x.local' },
      amount: { subtotalCents: 29700, totalCents: 29700 }, receivers: [{ role: 'seller', totalCents: 28514 }], paymentSession: { utm: {} } },
    product: { id: 'PROD1', name: 'COMO SER PERDOADO' }, products: [{ offers: [{ id: 'PROD1' }] }] } } }
  const sale = reconstruirVenda(evSemFatura)
  assert.equal(sale?.order_id, null)

  const { inserir, semOrderId } = decidirReinsercoes([evSemFatura], new Set())
  assert.equal(inserir.length, 0)
  assert.equal(semOrderId.length, 1)
  assert.equal(semOrderId[0].eventoId, 'ev-sem-fatura')
})

test('roteia para Kiwify e monta a venda certa', () => {
  const evKiwify = { id: 'ev-kw-1', plataforma: 'kiwify' as const, payload: { order: {
    order_id: 'kw-1', approved_date: '2026-09-14T10:00:00Z',
    Product: { product_name: 'PRODUTO TESTE', product_offer_name: 'Oferta X' },
    Customer: { full_name: 'Fulano', email: 'f@x.local', mobile: '' },
    Commissions: { charge_amount: 39900, my_commission: 35000, product_base_price: 39900, currency: 'BRL' },
    TrackingParameters: { utm_source: 'FB' },
  } } }
  const sale = reconstruirVenda(evKiwify)
  assert.equal(sale?.plataforma, 'kiwify')
  assert.equal(sale?.order_id, 'kw-1')

  const { inserir } = decidirReinsercoes([evKiwify], new Set())
  assert.equal(inserir.length, 1)
  assert.equal(inserir[0].sale.order_id, 'kw-1')
})

test('fatura pai da Hubla (com filhos) e pulada: nao entra em inserir nem semOrderId', () => {
  const evPai = evHubla('fatura-pai')
  ;(evPai.payload.event.invoice as any).childInvoiceIds = ['filho-1', 'filho-2']
  assert.equal(reconstruirVenda(evPai), null)

  const { inserir, semOrderId } = decidirReinsercoes([evPai], new Set())
  assert.equal(inserir.length, 0)
  assert.equal(semOrderId.length, 0)
})

test('POISON PILL: parse que lanca (Kiwify com approved_date invalida) vai para erros, resto do lote continua', () => {
  // parseKiwifySale faz `new Date(order.approved_date).toISOString()`, que
  // lanca RangeError quando approved_date nao e uma data valida. Um evento
  // assim nao pode derrubar o lote inteiro - os outros tem de ser
  // processados normalmente.
  const evQuebrado = { id: 'ev-quebrado', plataforma: 'kiwify' as const, payload: { order: {
    order_id: 'kw-quebrado', approved_date: 'isso-nao-e-uma-data',
    Product: { product_name: 'X', product_offer_name: null },
    Customer: { full_name: 'Fulano', email: 'f@x.local', mobile: '' },
    Commissions: { charge_amount: 100, my_commission: 90, product_base_price: 100, currency: null },
    TrackingParameters: {},
  } } }
  const evOk = { id: 'ev-ok', plataforma: 'kiwify' as const, payload: { order: {
    order_id: 'kw-ok', approved_date: '2026-09-14T10:00:00Z',
    Product: { product_name: 'Y', product_offer_name: null },
    Customer: { full_name: 'Beltrana', email: 'b@x.local', mobile: '' },
    Commissions: { charge_amount: 200, my_commission: 180, product_base_price: 200, currency: null },
    TrackingParameters: {},
  } } }

  assert.throws(() => reconstruirVenda(evQuebrado))

  const { inserir, semOrderId, erros } = decidirReinsercoes([evQuebrado, evOk], new Set())
  assert.equal(erros.length, 1)
  assert.equal(erros[0].eventoId, 'ev-quebrado')
  assert.equal(erros[0].plataforma, 'kiwify')
  assert.equal(semOrderId.length, 0)
  assert.equal(inserir.length, 1)
  assert.equal(inserir[0].sale.order_id, 'kw-ok')
  assert.equal(inserir[0].eventoId, 'ev-ok')
})
