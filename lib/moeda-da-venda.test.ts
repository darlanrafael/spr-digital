import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  moedaDaHubla, moedaDaKiwify, precisaConverter, converterParaReais,
  valoresInternacionaisDaHubla, valoresInternacionaisDaKiwify, MOEDA_DA_CASA,
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
    ['lib/hubla-sale.ts', 'moedaDaHubla'],
    ['lib/kiwify-sale.ts', 'moedaDaKiwify'],
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

test('moeda detectada com payload INCOMPLETO ainda marca a venda', () => {
  // Defeito que a revisao pegou em 11/09/2026, poucas horas depois de eu
  // publicar: o webhook gravava `valoresEmMoeda ? moeda : null`. Uma venda
  // estrangeira com o bloco `settlement` incompleto passava com os valores em
  // euro marcados como reais e SEM bandeira - o defeito original, em silencio,
  // pelo caminho de excecao.
  const incompleto = {
    amount: { settlement: { currency: 'USD' }, totalCents: 31955, subtotalCents: 25980 },
    receivers: [{ role: 'seller', currency: 'USD' }],
  }
  assert.equal(moedaDaHubla(incompleto as never), 'USD', 'a moeda E detectavel')
  assert.equal(valoresInternacionaisDaHubla(incompleto as never), null, 'mas os valores nao')

  const rota = readFileSync(new URL('../lib/hubla-sale.ts', import.meta.url), 'utf8')
  assert.ok(
    !/moeda:\s*valoresEmMoeda \? moeda : null/.test(rota),
    'o webhook voltou a so marcar quando conseguiu normalizar',
  )
  assert.ok(/moeda:\s*moeda,/.test(rota), 'o webhook nao marca a moeda sempre que detecta')
  assert.ok(rota.includes('normalizado'), 'o webhook nao registra se a linha foi normalizada')
})

test('a conversao RECUSA linha que pode estar em moedas misturadas', () => {
  // Um cambio unico numa linha mista da numero errado com cara de certo.
  const rota = readFileSync(new URL('../app/api/sales/converter-moeda/route.ts', import.meta.url), 'utf8')
  assert.ok(rota.includes('normalizado === false'), 'a rota nao recusa linha nao normalizada')
  assert.ok(rota.includes('moedas diferentes na mesma linha'), 'a rota nao explica ao usuario')
})

test('a conversao e compare-and-swap, nao le-depois-grava', () => {
  // Achado na segunda revisao de 11/09/2026: a checagem olha o estado LIDO, e
  // entre a leitura e a gravacao cabe outra requisicao. Dois cliques ao mesmo
  // tempo com cambios diferentes se sobrescreviam em silencio.
  const rota = readFileSync(new URL('../app/api/sales/converter-moeda/route.ts', import.meta.url), 'utf8')
  assert.ok(rota.includes(".not('moeda', 'is', null)"), 'o update nao condiciona a moeda ainda estar preenchida')
  // `update` sozinho devolve sucesso mesmo afetando zero linhas - sem `select`
  // nao ha como saber que nao casou.
  assert.ok(/\.select\('id'\)/.test(rota), 'o update nao verifica se afetou linha')
  assert.ok(rota.includes('já foi convertida por outra ação'), 'a rota nao avisa quem perdeu a corrida')
})

// ── Kiwify internacional: o repasse e numa moeda, a cobranca pode ser noutra ──
// Payload real da venda da Natalia Rezende (09/10/2026), copiado do banco.
// A cliente pagou em PESO MEXICANO (MXN), mas a Kiwify liquida o repasse em
// DOLAR (USD). O sistema gravava moeda=MXN (a da COBRANCA) e o liquido em USD na
// mesma linha, e convertia tudo com cambio de peso -> faturamento colapsava.
// Ver item 108 do spr-digital.md. Se um teste aqui quebrar, o defeito voltou.
const COMMISSIONS_NATALIA = {
  currency: 'MXN',
  charge_amount: 1035400,
  my_commission: 48777,
  settlement_amount: 48777,
  settlement_amount_currency: 'USD',
  kiwify_fee: 5502,
  kiwify_fee_currency: 'USD',
  product_base_price: 286000,
  product_base_price_currency: 'BRL',
}

test('CASO REAL Kiwify: a moeda e a do REPASSE (USD), nao a da cobranca (MXN)', () => {
  assert.equal(moedaDaKiwify(COMMISSIONS_NATALIA as never), 'USD')
})

test('Kiwify: sem settlement, cai pra moeda da cobranca (nao deixa passar como real)', () => {
  // Fallback: se a Kiwify nao mandar settlement_amount_currency mas a cobranca
  // ja vier estrangeira, ainda marca - a linha cai em normalizado:false depois.
  assert.equal(moedaDaKiwify({ currency: 'USD' } as never), 'USD')
  assert.equal(moedaDaKiwify({ currency: 'BRL', kiwify_fee: 448 } as never), null)
  assert.equal(moedaDaKiwify({} as never), null)
})

test('CASO REAL Kiwify: os valores saem homogeneos em DOLAR (bruto = liquido + taxa)', () => {
  const v = valoresInternacionaisDaKiwify(COMMISSIONS_NATALIA as never)
  assert.deepEqual(v, {
    preco_base: 542.79, valor_pago_cliente: 542.79, valor_com_juros: 542.79, valor_liquido: 487.77,
  })
  // Nada pode ser o cobrado em peso (10 354,00) nem o catalogo em real (2 860,00).
  for (const n of Object.values(v!)) {
    assert.notEqual(n, 10354, 'pegou a cobranca em peso')
    assert.notEqual(n, 2860, 'pegou o catalogo em real')
  }
})

test('Kiwify cobranca e repasse na MESMA moeda usa o valor cobrado', () => {
  const tudoUSD = {
    currency: 'USD', charge_amount: 50000, my_commission: 45000,
    settlement_amount: 45000, settlement_amount_currency: 'USD',
    kiwify_fee: 5000, kiwify_fee_currency: 'USD',
  }
  assert.equal(moedaDaKiwify(tudoUSD as never), 'USD')
  assert.deepEqual(valoresInternacionaisDaKiwify(tudoUSD as never), {
    preco_base: 500, valor_pago_cliente: 500, valor_com_juros: 500, valor_liquido: 450,
  })
})

test('Kiwify RECUSA (null) quando a taxa nao esta na moeda do repasse', () => {
  // Cobranca em peso, repasse em dolar, mas taxa em peso: nao da pra montar o
  // bruto em dolar com um numero so -> null -> a venda cai em normalizado:false.
  const mista = {
    currency: 'MXN', charge_amount: 1035400, my_commission: 48777,
    settlement_amount: 48777, settlement_amount_currency: 'USD',
    kiwify_fee: 5502, kiwify_fee_currency: 'MXN',
  }
  assert.equal(valoresInternacionaisDaKiwify(mista as never), null)
})

test('Kiwify sem o valor do repasse nao inventa', () => {
  assert.equal(valoresInternacionaisDaKiwify({ settlement_amount_currency: 'USD' } as never), null)
})

test('o webhook da Kiwify registra se a linha foi normalizada', () => {
  // Mesma trava do Hubla: sem o flag `normalizado`, a rota de conversao nao
  // bloqueia uma linha mista e um cambio unico sai errado em silencio.
  const rota = readFileSync(new URL('../lib/kiwify-sale.ts', import.meta.url), 'utf8')
  assert.ok(rota.includes('normalizado'), 'o webhook da Kiwify nao registra normalizado')
})

// ── Achados da revisao adversarial (3 revisores, 15/10/2026) ──
test('REVISAO: settlement em BRL MANDA (nao vira estrangeira por causa da cobranca)', () => {
  // Cobranca em dolar mas LIQUIDACAO em real (config comum da Kiwify). O
  // settlement BRL decide -> moeda null (real). Sem isso, seria rotulada USD e
  // um cambio multiplicaria um valor que JA esta em real (inflava ~5x).
  const settleBRL = {
    currency: 'USD', charge_amount: 50000, my_commission: 250000,
    settlement_amount: 250000, settlement_amount_currency: 'BRL',
    kiwify_fee: 5000, kiwify_fee_currency: 'BRL',
  }
  assert.equal(moedaDaKiwify(settleBRL as never), null)
  assert.equal(valoresInternacionaisDaKiwify(settleBRL as never), null)
})

test('REVISAO: sem settlement numa venda cruzada NAO normaliza (nao assume cobranca==repasse)', () => {
  // Cobranca em peso, my_commission em dolar, mas sem settlement_amount_currency:
  // nao da pra provar que cobranca == repasse -> null -> normalizado:false ->
  // conversao recusada, em vez de montar linha mista marcada como normalizada.
  const semSettlement = { currency: 'MXN', charge_amount: 1035400, my_commission: 48777 }
  assert.equal(valoresInternacionaisDaKiwify(semSettlement as never), null)
})

test('REVISAO: liquido e my_commission, nao o settlement total (co-producao)', () => {
  // Em venda co-produzida settlement_amount e o TOTAL; o repasse da SPR e
  // my_commission. Usar o total superestimaria o liquido.
  const coProduzida = {
    currency: 'USD', charge_amount: 100000, my_commission: 30000,
    settlement_amount: 80000, settlement_amount_currency: 'USD',
    kiwify_fee: 5000, kiwify_fee_currency: 'USD',
  }
  const v = valoresInternacionaisDaKiwify(coProduzida as never)
  assert.equal(v!.valor_liquido, 300, 'liquido tem que ser my_commission (300), nao o settlement total (800)')
})
