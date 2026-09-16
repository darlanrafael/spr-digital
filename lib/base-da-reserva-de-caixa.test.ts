import { test } from 'node:test'
import assert from 'node:assert/strict'
import { foraDaReservaDeCaixa, divisaoDoLucro, PERCENTUAL_DA_RESERVA } from './base-da-reserva-de-caixa'

// ── quem fica de fora da reserva ────────────────────────────────────────────
test('mentoria fica de fora da reserva', () => {
  assert.equal(foraDaReservaDeCaixa('Mentoria Particular - Pedro Roncada'), true)
  assert.equal(foraDaReservaDeCaixa('Mentoria Particular - Denise Nascimento'), true)
  assert.equal(foraDaReservaDeCaixa('Mentoria em Grupo'), true)
})

test('DECISAO DE 15/09/2026: Diagnostico Guiado tambem fica de fora', () => {
  // Nas palavras do usuario: "o diagnostico nao entra com 30% para o caixa".
  // O nome do produto NAO contem "mentoria", e era so isso que a regra antiga
  // olhava - por isso o Diagnostico estava do lado errado.
  assert.equal(foraDaReservaDeCaixa('Diagnóstico Guiado'), true)
  // O nome real no banco, com os dois pontos e o resto da frase.
  assert.equal(foraDaReservaDeCaixa('Diagnóstico Guiado: Programa de acompanhamento Individual'), true)
})

test('FRAGILIDADE CONHECIDA: sem o acento, o Diagnostico NAO e reconhecido', () => {
  // `TERMO_DIAGNOSTICO` e `'diagnóstico guiado'`, COM acento, e a comparacao e
  // literal. Escrito sem acento, o produto deixa de ser Diagnostico para o
  // sistema inteiro - nao so para a reserva de caixa.
  //
  // Nas vendas de plataforma isto nao acontece: o nome vem da Hubla/Kiwify,
  // sempre igual. O risco esta no LANCAMENTO MANUAL, onde o produto e digitado
  // a mao - e onde ja aconteceu de uma venda do Kleiton (do Pedro) ir para o
  // painel da Denise porque o texto digitado dizia "Denise Nascimento".
  //
  // O teste esta aqui para o comportamento ficar REGISTRADO, nao porque esteja
  // certo. A correcao de verdade e a lista de produtos no lancamento manual,
  // que esta em `lib/produtos-do-lancamento-manual.ts` e ainda nao foi ligada.
  assert.equal(foraDaReservaDeCaixa('Diagnostico Guiado'), false)
})

test('os demais produtos CONTINUAM sofrendo a reserva', () => {
  // A regra nao pode virar "tudo fica de fora": quem nao tem terapeuta
  // entregando sessao nao tem a quem pagar antes dos socios.
  assert.equal(foraDaReservaDeCaixa('Combo: Primeiros Passos da Restauração'), false)
  assert.equal(foraDaReservaDeCaixa('CSP - Curso'), false)
  assert.equal(foraDaReservaDeCaixa(''), false)
})

test('a busca no nome nao diferencia maiuscula nem acento do Diagnostico', () => {
  assert.equal(foraDaReservaDeCaixa('MENTORIA PARTICULAR'), true)
  assert.equal(foraDaReservaDeCaixa('DIAGNÓSTICO GUIADO'), true)
})

// ── a divisao do lucro ──────────────────────────────────────────────────────
const linhas = [
  { nome: 'Mentoria Particular - Denise Nascimento', liquidoPosImpostos: 10_000 },
  { nome: 'Diagnóstico Guiado', liquidoPosImpostos: 5_000 },
  { nome: 'CSP - Curso', liquidoPosImpostos: 20_000 },
]

test('a reserva incide SO sobre o que nao esta fora dela', () => {
  const r = divisaoDoLucro({
    linhas,
    faturamentoLiquido: 35_000,
    totalCustos: 5_000,
    repasseTerapeutasTotal: 4_000,
  })
  assert.equal(r.faturamentoLiquidoForaDaReserva, 15_000, 'mentoria 10k + diagnostico 5k')
  assert.equal(r.lucroBruto, 30_000, '35k de receita menos 5k de custo')
  assert.equal(r.lucroBrutoComReserva, 15_000, 'sobra o CSP menos os custos')
  assert.equal(r.reservaCaixa, 4_500, '30% de 15k')
  assert.equal(r.lucroReal, 10_500 + (15_000 - 4_000), '70% da parte com reserva, mais a de fora liquida do repasse')
})

test('O QUE A DECISAO MUDOU: o Diagnostico fora da reserva reduz a reserva', () => {
  // A mesma conta, com o Diagnostico do lado antigo (dentro da reserva).
  const comDiagnosticoDentro = divisaoDoLucro({
    linhas: [
      { nome: 'Mentoria Particular - Denise Nascimento', liquidoPosImpostos: 10_000 },
      { nome: 'Diagnostico como era antes', liquidoPosImpostos: 5_000 },
      { nome: 'CSP - Curso', liquidoPosImpostos: 20_000 },
    ],
    faturamentoLiquido: 35_000, totalCustos: 5_000, repasseTerapeutasTotal: 4_000,
  })
  const agora = divisaoDoLucro({
    linhas, faturamentoLiquido: 35_000, totalCustos: 5_000, repasseTerapeutasTotal: 4_000,
  })

  assert.equal(comDiagnosticoDentro.reservaCaixa, 6_000, 'antes: 30% de 20k')
  assert.equal(agora.reservaCaixa, 4_500, 'agora: 30% de 15k')
  // O que sai da reserva NAO desaparece: vai para o Lucro Real.
  assert.equal(
    agora.reservaCaixa + agora.lucroReal,
    comDiagnosticoDentro.reservaCaixa + comDiagnosticoDentro.lucroReal,
    'reserva + lucro real tem de dar o mesmo total: o dinheiro so mudou de lado',
  )
})

test('INVARIANTE: reserva mais lucro real fecha com lucro bruto menos repasse', () => {
  // A conta nao pode criar nem destruir dinheiro.
  for (const custos of [0, 5_000, 12_000]) {
    const r = divisaoDoLucro({ linhas, faturamentoLiquido: 35_000, totalCustos: custos, repasseTerapeutasTotal: 4_000 })
    assert.ok(
      Math.abs((r.reservaCaixa + r.lucroReal) - (r.lucroBruto - 4_000)) < 1e-9,
      `custos ${custos}: a soma nao fecha`,
    )
  }
})

test('PREJUIZO: nao existe reserva de valor negativo, e o prejuizo inteiro e rateado', () => {
  const r = divisaoDoLucro({
    linhas, faturamentoLiquido: 35_000,
    totalCustos: 40_000,   // custo maior que a receita
    repasseTerapeutasTotal: 4_000,
  })
  assert.equal(r.reservaCaixa, 0, 'nao se reserva 30% de prejuizo')
  assert.ok(r.lucroBrutoComReserva < 0)
  // O prejuizo inteiro (100%, nao 70%) entra no Lucro Real.
  assert.equal(r.lucroReal, r.lucroBrutoComReserva + (15_000 - 4_000))
})

test('FRONTEIRA: lucro exatamente ZERO nao gera reserva', () => {
  // `> 0` e nao `>= 0`. Com zero a reserva seria zero de qualquer jeito, mas a
  // fronteira fica travada contra quem trocar o sinal achando que da no mesmo.
  const r = divisaoDoLucro({
    linhas: [{ nome: 'CSP', liquidoPosImpostos: 10_000 }],
    faturamentoLiquido: 10_000, totalCustos: 10_000, repasseTerapeutasTotal: 0,
  })
  assert.equal(r.lucroBrutoComReserva, 0)
  assert.equal(r.reservaCaixa, 0)
  assert.equal(r.lucroReal, 0)
})

test('sem nenhum produto fora da reserva, a conta e a simples de 30/70', () => {
  const r = divisaoDoLucro({
    linhas: [{ nome: 'CSP - Curso', liquidoPosImpostos: 20_000 }],
    faturamentoLiquido: 20_000, totalCustos: 0, repasseTerapeutasTotal: 0,
  })
  assert.equal(r.faturamentoLiquidoForaDaReserva, 0)
  assert.equal(r.reservaCaixa, 20_000 * PERCENTUAL_DA_RESERVA)
  assert.equal(r.lucroReal, 20_000 * (1 - PERCENTUAL_DA_RESERVA))
})

// ── toggle da reserva de caixa ──────────────────────────────────────────────
const linhasSimples = [{ nome: 'CSP - Curso', liquidoPosImpostos: 20_000 }] // sofre reserva

test('reservarCaixa true (padrao): reserva 30% do lucro positivo', () => {
  const r = divisaoDoLucro({ linhas: linhasSimples, faturamentoLiquido: 20_000, totalCustos: 10_000, repasseTerapeutasTotal: 0 })
  assert.equal(r.reservaCaixa, 3_000)   // 30% de 10.000
  assert.equal(r.lucroReal, 7_000)      // 70%
})

test('reservarCaixa false: NAO reserva, 100% vai pros socios', () => {
  const r = divisaoDoLucro({ linhas: linhasSimples, faturamentoLiquido: 20_000, totalCustos: 10_000, repasseTerapeutasTotal: 0, reservarCaixa: false })
  assert.equal(r.reservaCaixa, 0)
  assert.equal(r.lucroReal, 10_000)     // 100%
})

test('prejuizo: reserva 0 independe do toggle', () => {
  const r1 = divisaoDoLucro({ linhas: linhasSimples, faturamentoLiquido: 5_000, totalCustos: 10_000, repasseTerapeutasTotal: 0, reservarCaixa: true })
  const r2 = divisaoDoLucro({ linhas: linhasSimples, faturamentoLiquido: 5_000, totalCustos: 10_000, repasseTerapeutasTotal: 0, reservarCaixa: false })
  assert.equal(r1.reservaCaixa, 0)
  assert.equal(r2.reservaCaixa, 0)
  assert.equal(r1.lucroReal, r2.lucroReal) // prejuizo identico nos dois
})
