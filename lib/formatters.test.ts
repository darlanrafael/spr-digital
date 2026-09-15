import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getAliquotaByPreco, getSaleBruto, getImpostoBase,
  formatCurrency, formatDate, formatDateTime, parseLocalDate, diffDays, isUTMBugged,
} from './formatters'

// `lib/formatters.ts` tinha ZERO testes ate 14/09/2026, e e o modulo com as
// tres funcoes que decidem o dinheiro de TODO fechamento:
//
//   getAliquotaByPreco  -> a aliquota de imposto da venda
//   getSaleBruto        -> o faturamento bruto da linha
//   getImpostoBase      -> sobre quanto o imposto e calculado
//
// A analise dos testes por angulos, pedida pelo usuario, mostrou que a suite
// cobria bem o que eu escrevi nas ultimas semanas e nao encostava no codigo
// mais antigo e mais usado. Estes testes fecham isso.

// ── getAliquotaByPreco ──────────────────────────────────────────────────────
test('a aliquota vira 12,85% acima de R$ 167, e a FRONTEIRA e exata', () => {
  // A fronteira e onde "3%" e "12,85%" se decidem. Uma venda de R$ 167 paga
  // R$ 5,01 de imposto; uma de R$ 167,01 paga R$ 21,46 - quatro vezes mais.
  assert.equal(getAliquotaByPreco(166.99), 3)
  assert.equal(getAliquotaByPreco(167), 3, 'exatamente 167 ainda e 3%')
  assert.equal(getAliquotaByPreco(167.01), 12.85, 'um centavo acima ja e 12,85%')
  assert.equal(getAliquotaByPreco(5000), 12.85)
})

test('preco zero ou negativo cai na aliquota baixa, nao quebra', () => {
  // Venda com preco_base zero existe no banco (lancamento manual antigo).
  assert.equal(getAliquotaByPreco(0), 3)
  assert.equal(getAliquotaByPreco(-1), 3)
})

// ── getSaleBruto ────────────────────────────────────────────────────────────
test('CASO REAL: o bruto vem de campo DIFERENTE em cada plataforma', () => {
  // Hubla: `valor_pago_cliente`. Kiwify: `preco_base`. Trocar os dois muda o
  // faturamento de todo fechamento, e nada no tipo impede a troca.
  const hubla = { plataforma: 'hubla', valor_pago_cliente: 2860, preco_base: 9999 } as never
  const kiwify = { plataforma: 'kiwify', valor_pago_cliente: 9999, preco_base: 197 } as never
  assert.equal(getSaleBruto(hubla), 2860, 'Hubla usa valor_pago_cliente')
  assert.equal(getSaleBruto(kiwify), 197, 'Kiwify usa preco_base')
})

test('plataforma desconhecida cai no caminho da Kiwify', () => {
  // Lancamento manual tem `plataforma: 'manual'`. Registrar o comportamento
  // para nao virar surpresa: ele usa `preco_base`.
  const manual = { plataforma: 'manual', valor_pago_cliente: 2860, preco_base: 1000 } as never
  assert.equal(getSaleBruto(manual), 1000)
})

// ── getImpostoBase ──────────────────────────────────────────────────────────
test('a base do imposto e o valor COM juros, nao o preco', () => {
  // O cliente parcelou: pagou R$ 319,55 sobre um produto de R$ 259,80. O
  // imposto incide sobre o que ele pagou.
  const comJuros = { valor_com_juros: 319.55, valor_pago_cliente: 259.80 } as never
  assert.equal(getImpostoBase(comJuros), 319.55)
})

test('venda antiga SEM valor_com_juros cai no valor pago', () => {
  // Historico anterior a coluna. Sem o fallback, o imposto sairia NaN e
  // contaminaria o total do fechamento inteiro em silencio.
  assert.equal(getImpostoBase({ valor_pago_cliente: 259.80 } as never), 259.80)
  assert.equal(getImpostoBase({ valor_com_juros: undefined, valor_pago_cliente: 100 } as never), 100)
})

test('valor_com_juros ZERO nao cai no fallback', () => {
  // `?? ` so cai em null/undefined. Zero e um valor legitimo - venda de
  // cortesia - e virar `valor_pago_cliente` inventaria imposto do nada.
  assert.equal(getImpostoBase({ valor_com_juros: 0, valor_pago_cliente: 500 } as never), 0)
})

// ── formatCurrency ──────────────────────────────────────────────────────────
test('o dinheiro sai no formato brasileiro, com dois digitos sempre', () => {
  assert.equal(formatCurrency(1739.81), 'R$ 1.739,81')
  assert.equal(formatCurrency(0), 'R$ 0,00')
  assert.equal(formatCurrency(-4455.62), '-R$ 4.455,62')
  assert.equal(formatCurrency(1000000), 'R$ 1.000.000,00')
})

test('valor com dizima e arredondado na EXIBICAO, nao truncado', () => {
  // A comissao real tem cauda longa: 88.216498125.
  assert.equal(formatCurrency(88.216498125), 'R$ 88,22')
  assert.equal(formatCurrency(88.214), 'R$ 88,21')
})

// ── formatDate e formatDateTime ─────────────────────────────────────────────
test('a data e formatada por CORTE de texto, sem passar por Date', () => {
  // E de proposito: passar por `new Date` aplicaria fuso e jogaria uma data de
  // 21h30 BRT para o dia seguinte. Cortar o texto preserva o dia.
  assert.equal(formatDate('2026-09-14'), '14/09/2026')
  assert.equal(formatDate('2026-09-14T23:59:00+00:00'), '14/09/2026')
  assert.equal(formatDateTime('2026-09-14T21:30:00'), '14/09/2026 21:30')
  assert.equal(formatDateTime(''), '', 'string vazia nao quebra')
})

test('formatDateTime sem hora nao deixa espaco sobrando', () => {
  assert.equal(formatDateTime('2026-09-14'), '14/09/2026')
})

// ── parseLocalDate e diffDays ───────────────────────────────────────────────
test('a data e lida como LOCAL, nao como UTC', () => {
  // `new Date('2026-09-14')` seria UTC e viraria 13/09 no Brasil. A funcao
  // monta com os componentes justamente para evitar isso.
  const d = parseLocalDate('2026-09-14')
  assert.equal(d.getFullYear(), 2026)
  assert.equal(d.getMonth(), 8, 'setembro e o mes 8 em base zero')
  assert.equal(d.getDate(), 14, 'tem que ser dia 14, nao 13')
})

test('diffDays conta dias corridos, inclusive na virada de mes e de ano', () => {
  assert.equal(diffDays('2026-09-01', '2026-09-14'), 13)
  assert.equal(diffDays('2026-08-31', '2026-09-01'), 1, 'virada de mes')
  assert.equal(diffDays('2026-12-31', '2027-01-01'), 1, 'virada de ano')
  assert.equal(diffDays('2026-09-14', '2026-09-14'), 0)
  assert.equal(diffDays('2026-09-14', '2026-09-01'), -13, 'ordem invertida da negativo')
})

test('diffDays atravessa o horario de verao sem perder ou ganhar dia', () => {
  // O Brasil nao tem mais horario de verao desde 2019, mas a funcao usa o fuso
  // da maquina - se ela rodar em outro lugar, uma janela de 1h nao pode virar
  // um dia a mais ou a menos.
  assert.equal(diffDays('2026-02-01', '2026-03-01'), 28)
  assert.equal(diffDays('2026-10-01', '2026-11-01'), 31)
})

// ── isUTMBugged ─────────────────────────────────────────────────────────────
test('UTM quebrada e reconhecida pelos tres padroes conhecidos', () => {
  assert.equal(isUTMBugged('l.facebook.com'), true)
  assert.equal(isUTMBugged('{{campaign.name}}'), true)
  assert.equal(isUTMBugged('algo}}'), true)
  assert.equal(isUTMBugged('comercial-f'), false)
  assert.equal(isUTMBugged(''), false, 'vazio nao e quebrado')
})
