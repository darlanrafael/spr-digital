import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  moedaDaHubla, moedaDaKiwify, precisaConverter, converterParaReais,
  valoresInternacionaisDaHubla, MOEDA_DA_CASA,
} from './moeda-da-venda'

// O payload exato da venda da Rosana, como a Hubla mandou em 05/09/2026.
// Copiado do log de producao (webhook_events). E o caso que originou o modulo:
// se um teste aqui quebrar, e porque o defeito do item 57 voltou.
const INVOICE_ROSANA = {
  amount: {
    settlement: { currency: 'USD', totalCents: 36012, subtotalCents: 29278, taxAmountCents: 6734 },
    totalCents: 31955, prorataCents: 0, discountCents: 0, subtotalCents: 25980, installmentFeeCents: 0,
  },
  installments: 1,
  receivers: [
    { id: 'platform', role: 'platform', currency: 'USD', totalCents: 8139, paysForFees: false },
    { id: 'wxFNJxYcO3UHyxKqQSJEMEoNJS92', role: 'seller', currency: 'USD', totalCents: 27873, paysForFees: true },
  ],
}

// Uma venda brasileira normal, do mesmo log. Serve de controle: nada aqui pode
// mudar de comportamento por causa da moeda.
const INVOICE_NORMAL = {
  amount: { totalCents: 36864, subtotalCents: 29700, installmentFeeCents: 7164 },
  installments: 12,
  receivers: [
    { role: 'platform', currency: 'BRL', totalCents: 1404 },
    { role: 'seller', currency: 'BRL', totalCents: 35460 },
  ],
}

test('CASO REAL: a venda da Rosana e reconhecida como dolar', () => {
  assert.equal(moedaDaHubla(INVOICE_ROSANA as never), 'USD')
})

test('venda brasileira normal nao vira moeda estrangeira', () => {
  assert.equal(moedaDaHubla(INVOICE_NORMAL as never), null)
})

test('a moeda e lida do settlement OU do receiver, tanto faz qual sobrar', () => {
  // Se a Hubla parar de mandar um dos dois, o outro ainda pega. Recusar por
  // falta de um seria voltar ao defeito de deixar passar em silencio.
  const soSettlement = { amount: { settlement: { currency: 'EUR' } }, receivers: [] }
  const soReceiver = { amount: {}, receivers: [{ role: 'seller', currency: 'EUR' }] }
  assert.equal(moedaDaHubla(soSettlement as never), 'EUR')
  assert.equal(moedaDaHubla(soReceiver as never), 'EUR')
})

test('invoice vazio, sem moeda ou com BRL escrito de qualquer jeito = real', () => {
  for (const inv of [null, undefined, {}, { amount: {}, receivers: [] },
    { amount: { settlement: { currency: 'BRL' } } },
    { amount: { settlement: { currency: ' brl ' } } },
    { amount: { settlement: { currency: '' } } }]) {
    assert.equal(moedaDaHubla(inv as never), null, JSON.stringify(inv))
  }
})

test('a Kiwify tem o campo de moeda, e ele passou anos sendo ignorado', () => {
  // Ate 11/09/2026 o detector da Kiwify era a RAZAO valor_pago/preco_base < 0.4,
  // que e chute: erra em cupom e em promocao. O campo sempre esteve la.
  assert.equal(moedaDaKiwify({ currency: 'BRL', kiwify_fee: 448 } as never), null)
  assert.equal(moedaDaKiwify({ currency: 'USD' } as never), 'USD')
  assert.equal(moedaDaKiwify(null), null)
  assert.equal(moedaDaKiwify({} as never), null)
})

test('precisaConverter so e verdade quando a moeda nao e a da casa', () => {
  assert.equal(precisaConverter({ moeda: 'USD' }), true)
  assert.equal(precisaConverter({ moeda: null }), false)
  assert.equal(precisaConverter({ moeda: undefined }), false)
  assert.equal(precisaConverter({ moeda: MOEDA_DA_CASA }), false)
  assert.equal(precisaConverter({ moeda: '  ' }), false)
})

test('CASO REAL: os valores da Rosana saem homogeneos, todos em dolar', () => {
  // O defeito era exatamente este: tres campos em euro (259,80 / 259,80 /
  // 319,55) e um em dolar (278,73). Nenhum cambio unico conserta isso.
  const v = valoresInternacionaisDaHubla(INVOICE_ROSANA as never)
  assert.deepEqual(v, {
    preco_base: 292.78, valor_pago_cliente: 292.78, valor_com_juros: 360.12, valor_liquido: 278.73,
  })
  // Nenhum valor pode ser o do bloco `amount`, que esta em euro.
  for (const n of Object.values(v!)) {
    assert.notEqual(n, 259.80, 'pegou o subtotal em euro')
    assert.notEqual(n, 319.55, 'pegou o total em euro')
  }
})

test('sem os tres campos que importam, nao inventa valor', () => {
  assert.equal(valoresInternacionaisDaHubla({ amount: {}, receivers: [] } as never), null)
  assert.equal(valoresInternacionaisDaHubla({ amount: { settlement: { subtotalCents: 1 } }, receivers: [] } as never), null)
})

test('CASO REAL: a conversao reproduz exatamente a correcao feita a mao', () => {
  // Cambio 5,00 escolhido pelo usuario em 11/09/2026 (05/09 foi sabado, sem
  // PTAX; as uteis vizinhas eram 5,1253 e 5,0856). Os numeros abaixo sao os
  // que estao gravados em producao na venda f18a93aa.
  const v = valoresInternacionaisDaHubla(INVOICE_ROSANA as never)!
  assert.deepEqual(converterParaReais(v, 5), {
    preco_base: 1463.90, valor_pago_cliente: 1463.90, valor_com_juros: 1800.60, valor_liquido: 1393.65,
  })
})

test('a linha convertida deixa de disparar a trava do fechamento', () => {
  // A trava e `valor_liquido > valor_pago_cliente`. Antes: 278,73 > 259,80.
  const v = converterParaReais(valoresInternacionaisDaHubla(INVOICE_ROSANA as never)!, 5)
  assert.ok(v.valor_liquido < v.valor_pago_cliente)
  // E a taxa da plataforma volta a ser positiva: era -18,93 na tela.
  assert.equal(Math.round((v.valor_pago_cliente - v.valor_liquido) * 100) / 100, 70.25)
})

test('cambio invalido recusa em vez de gravar zero', () => {
  const v = { preco_base: 1, valor_pago_cliente: 1, valor_com_juros: 1, valor_liquido: 1 }
  for (const c of [0, -1, NaN]) assert.throws(() => converterParaReais(v, c), /cambio/)
})

test('a conversao arredonda em centavo, nao acumula dizima', () => {
  const v = { preco_base: 10.01, valor_pago_cliente: 10.01, valor_com_juros: 10.01, valor_liquido: 3.33 }
  const r = converterParaReais(v, 5.1253)
  assert.equal(r.preco_base, 51.30)
  assert.equal(r.valor_liquido, 17.07)
})

test('os dois webhooks leem a moeda do payload', () => {
  // Teste de fiacao. A funcao pode estar perfeita e nao ser chamada: foi assim
  // que a Kiwify passou meses com o campo `currency` chegando e sendo ignorado.
  for (const [arq, fn] of [
    ['app/api/webhooks/hubla/route.ts', 'moedaDaHubla'],
    ['app/api/webhooks/kiwify/route.ts', 'moedaDaKiwify'],
  ]) {
    const texto = readFileSync(new URL('../' + arq, import.meta.url), 'utf8')
    assert.ok(texto.includes(fn), `${arq} nao chama ${fn}`)
    assert.ok(/moeda:\s/.test(texto), `${arq} nao grava a coluna moeda`)
  }
})

test('a tela de Fechamentos TRAVA o botao quando ha venda nao convertida', () => {
  // Teste de fiacao, e o mais importante do arquivo. Toda a deteccao pode estar
  // certa e a venda ainda entrar num fechamento se o botao nao for travado -
  // que e exatamente o que aconteceu em 05/09: o alerta apareceu na tela e nada
  // impedia o clique em Confirmar.
  const tela = readFileSync(new URL('../app/fechamentos/page.tsx', import.meta.url), 'utf8')
  assert.ok(tela.includes('precisaConverter'), 'a tela nao usa precisaConverter')
  assert.ok(tela.includes('naoConvertidas'), 'a tela nao calcula a lista de nao convertidas')

  const linhaDoBotao = tela.split('\n').find(l => l.includes('onClick={handleConfirm}'))
  assert.ok(linhaDoBotao, 'nao achei o botao de confirmar fechamento')
  assert.ok(
    /disabled=\{[^}]*conferencia\.naoConvertidas\.length > 0/.test(linhaDoBotao!),
    'o botao de confirmar nao esta travado por venda nao convertida: ' + linhaDoBotao!.trim().slice(0, 160),
  )
})

test('a moeda chega do banco ate a tela', () => {
  // Sem isto a coluna existe, o webhook grava, e a tela nunca ve: o mapeamento
  // de `sales` descarta tudo que nao esta listado nele.
  const services = readFileSync(new URL('../lib/services.ts', import.meta.url), 'utf8')
  assert.ok(/moeda:\s*r\.moeda/.test(services), 'mapSaleRow nao traz a coluna moeda')
})

test('a rota de conversao limpa a moeda na MESMA gravacao dos valores', () => {
  // Se separasse em dois updates, uma falha no meio deixaria a venda convertida
  // e ainda marcada como estrangeira - pronta para ser convertida DE NOVO, e o
  // faturamento multiplicado pelo cambio duas vezes.
  const rota = readFileSync(new URL('../app/api/sales/converter-moeda/route.ts', import.meta.url), 'utf8')
  const inicio = rota.indexOf('.update(')
  const update = rota.slice(inicio, rota.indexOf('.eq(\'id\', sale_id)', inicio))
  assert.ok(update.includes('...depois'), 'o update nao grava os valores convertidos')
  assert.ok(update.includes('moeda: null'), 'o update nao limpa a moeda junto')
  assert.ok(rota.includes('precisaConverter'), 'a rota nao recusa venda ja convertida')
})
