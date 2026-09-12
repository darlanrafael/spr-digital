import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deducoesPorSocio } from './rateio-das-deducoes'
import { repasseDoDiagnostico } from './repasse-do-diagnostico'
import { entreguesDesdeOFechamento } from './entregues-desde-o-fechamento'
import { converterParaReais } from './moeda-da-venda'
import { agruparPorProduto, totalDosGrupos } from './sessoes-por-produto'
import { liquidoDoPacote, brutoDoPacote } from './dinheiro-do-pacote'

// TESTE POR PROPRIEDADE nos modulos de dinheiro.
//
// Metodo 4 dos quatro pedidos pelo usuario em 12/09/2026. A diferenca em relacao
// ao resto da suite: os outros testes verificam os casos que EU escolhi, e eu
// escolho mal - em 11/09 testei o bloco novo com a Denise (14 linhas) e nao vi o
// Pedro (357). Aqui o gerador escolhe, e a afirmacao e sobre o INVARIANTE.
//
// Gerador deterministico (mulberry32) de proposito: `Math.random` daria um teste
// que passa hoje e falha amanha sem ninguem saber por que. Com semente fixa, um
// caso que quebra e reproduzivel para sempre.
function gerador(semente: number) {
  let a = semente >>> 0
  const prox = () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    prox,
    inteiro: (min: number, max: number) => min + Math.floor(prox() * (max - min + 1)),
    /** Valor de dinheiro CRU, com dizima - e onde o arredondamento quebra. */
    dinheiro: () => {
      const bruto = prox() * 5000
      // 1 em 8 sai com centavo redondo, o resto com cauda longa.
      return prox() < 0.125 ? Math.round(bruto * 100) / 100 : bruto
    },
    escolha: <T>(itens: T[]) => itens[Math.floor(prox() * itens.length)],
  }
}

const SOCIOS = ['SPR DIGITAL LTDA', 'Pedro Roncada']
const cent = (n: number) => Math.round(n * 100) / 100
const RODADAS = 400

test('PROPRIEDADE: a soma dos socios e SEMPRE o total, no centavo', () => {
  // O defeito real que isto trava: arredondar o rateio item a item fazia a soma
  // dos socios divergir do total da tela. Com sete deducoes ja aparecia.
  const g = gerador(1)
  for (let r = 0; r < RODADAS; r++) {
    const itens = Array.from({ length: g.inteiro(0, 30) }, (_, i) => {
      const pct = g.escolha([0, 1, 33, 33.33, 35, 50, 65, 99, 100])
      return { chave: `k${i}`, valor: g.dinheiro(), divisao: { [SOCIOS[0]]: pct, [SOCIOS[1]]: 100 - pct } }
    })
    const t = deducoesPorSocio(itens, SOCIOS)
    const soma = cent(SOCIOS.reduce((a, n) => a + t[n], 0))
    const esperado = cent(itens.reduce((a, i) => a + i.valor, 0))
    assert.equal(soma, esperado, `rodada ${r}: ${itens.length} itens`)
  }
})

test('PROPRIEDADE: nenhum socio recebe valor que nao seja multiplo de centavo', () => {
  const g = gerador(2)
  for (let r = 0; r < RODADAS; r++) {
    const itens = Array.from({ length: g.inteiro(1, 12) }, (_, i) => ({
      chave: `k${i}`, valor: g.dinheiro(),
      divisao: { [SOCIOS[0]]: g.inteiro(0, 100), [SOCIOS[1]]: 0 },
    }))
    for (const i of itens) i.divisao[SOCIOS[1]] = 100 - i.divisao[SOCIOS[0]]
    const t = deducoesPorSocio(itens, SOCIOS)
    for (const n of SOCIOS) {
      assert.equal(t[n], cent(t[n]), `rodada ${r}: ${n} recebeu ${t[n]}, que nao e centavo inteiro`)
    }
  }
})

test('PROPRIEDADE: o repasse do Diagnostico e a soma das linhas, sempre', () => {
  const g = gerador(3)
  const OFERTAS = [
    'aaaaaaaa-bbbb-cccc-dddd-eeeeeeee-WXwmPZfJxGqeXerA6dkO',
    'aaaaaaaa-bbbb-cccc-dddd-eeeeeeee-H8DA8U21x7Lmv3NreVMs',
    'aaaaaaaa-bbbb-cccc-dddd-eeeeeeee-qVvads7GKaI7lN1Kctrr',
    'aaaaaaaa-bbbb-cccc-dddd-eeeeeeee-naoMapeada',
  ]
  for (let r = 0; r < RODADAS; r++) {
    const vendas = Array.from({ length: g.inteiro(0, 40) }, (_, i) => ({
      id: `v${i}`, nome: `p${i}`, order_id: g.escolha(OFERTAS),
      produto: 'Diagnóstico Guiado: Programa de acompanhamento Individual',
    }))
    const res = repasseDoDiagnostico(vendas)
    assert.equal(res.total, cent(res.porVenda.reduce((a, v) => a + v.valor, 0)), `rodada ${r}`)
    // Nenhuma venda pode estar nas duas listas, e todas tem que estar em uma.
    assert.equal(res.porVenda.length + res.semFormato.length, vendas.length, `rodada ${r}: venda sumiu`)
    // Valor sempre multiplo de 95, porque e fixo por sessao.
    for (const v of res.porVenda) assert.equal(v.valor % 95, 0, `rodada ${r}: ${v.valor} nao e multiplo de 95`)
  }
})

test('PROPRIEDADE: a pagar mais ja pago e sempre o total entregue', () => {
  const g = gerador(4)
  for (let r = 0; r < RODADAS; r++) {
    const sessoes = Array.from({ length: g.inteiro(0, 50) }, (_, i) => ({
      id: `s${i}`, comissao_valor: g.dinheiro(), comissao_paga: g.prox() < 0.4,
      data_entrega: g.prox() < 0.1 ? null : `2026-0${g.inteiro(1, 9)}-${String(g.inteiro(10, 28))}T${String(g.inteiro(10, 23))}:00:00+00:00`,
    }))
    const fechs = Array.from({ length: g.inteiro(0, 3) }, (_, i) => ({
      id: `f${i}`, data_confirmacao: `2026-0${g.inteiro(1, 9)}-${String(g.inteiro(10, 28))}T12:00:00.123+00:00`, sessoes: [],
    }))
    const res = entreguesDesdeOFechamento({ sessoes, fechamentos: fechs })
    assert.equal(cent(res.aPagar + res.jaPago), res.total, `rodada ${r}`)
    // Sessao sem entrega nunca entra.
    for (const x of res.sessoes) assert.ok(x.sessao.data_entrega, `rodada ${r}: entrou sessao sem entrega`)
    // Nada fora do corte.
    if (res.corte) {
      const corte = new Date(res.corte).getTime()
      for (const x of res.sessoes) {
        assert.ok(new Date(x.sessao.data_entrega!).getTime() >= corte, `rodada ${r}: entrou sessao antes do corte`)
      }
    }
  }
})

test('PROPRIEDADE: converter moeda e linear e nao perde mais de um centavo por campo', () => {
  const g = gerador(5)
  for (let r = 0; r < RODADAS; r++) {
    const v = { preco_base: g.dinheiro(), valor_pago_cliente: g.dinheiro(), valor_com_juros: g.dinheiro(), valor_liquido: g.dinheiro() }
    const taxa = 1 + g.prox() * 9
    const c = converterParaReais(v, taxa)
    for (const k of Object.keys(v) as (keyof typeof v)[]) {
      assert.equal(c[k], cent(c[k]), `rodada ${r}: ${k} nao e centavo inteiro`)
      assert.ok(Math.abs(c[k] - v[k] * taxa) <= 0.005 + 1e-9, `rodada ${r}: ${k} desviou mais de meio centavo`)
    }
    // Converter por 1 nao muda nada alem do arredondamento.
    const porUm = converterParaReais(v, 1)
    for (const k of Object.keys(v) as (keyof typeof v)[]) {
      assert.ok(Math.abs(porUm[k] - v[k]) <= 0.005 + 1e-9, `rodada ${r}: cambio 1 mudou ${k}`)
    }
  }
})

test('PROPRIEDADE: agrupar por produto nao cria nem perde sessao, nem centavo', () => {
  const g = gerador(6)
  const PRODUTOS = ['Mentoria Particular - Pedro | Denise', 'Diagnóstico Guiado: Programa de acompanhamento Individual', '', '   ', 'Outro']
  for (let r = 0; r < RODADAS; r++) {
    const sessoes = Array.from({ length: g.inteiro(0, 60) }, (_, i) => ({
      id: `s${i}`, sale_id: `v${g.inteiro(0, 12)}`,
      produto: g.escolha(PRODUTOS), comissao_valor: g.dinheiro(),
    }))
    const grupos = agruparPorProduto(sessoes)
    assert.equal(grupos.reduce((a, x) => a + x.sessoes.length, 0), sessoes.length, `rodada ${r}: sessao sumiu`)
    // O total e a soma dos grupos JA arredondados - e o que a tela mostra, e
    // tem que somar o que esta nas linhas. Comparar com `cent(soma crua)` seria
    // exigir que dois arredondamentos diferentes coincidissem, o que nao
    // acontece: o proprio gerador achou R$ 79.904,50 contra R$ 79.904,51 na
    // rodada 0.
    assert.equal(totalDosGrupos(grupos), cent(grupos.reduce((a, x) => a + x.total, 0)), `rodada ${r}`)
    // E o desvio em relacao ao cru nunca passa de meio centavo por grupo.
    const cru = sessoes.reduce((a, s) => a + s.comissao_valor, 0)
    assert.ok(Math.abs(totalDosGrupos(grupos) - cru) <= 0.005 * Math.max(1, grupos.length) + 1e-9,
      `rodada ${r}: desvio ${totalDosGrupos(grupos) - cru} passou de meio centavo por grupo`)
    // Ordem sempre decrescente por valor.
    for (let i = 1; i < grupos.length; i++) {
      assert.ok(grupos[i - 1].total >= grupos[i].total, `rodada ${r}: ordem quebrou`)
    }
    // `valorPorSessao` so existe quando TODAS valem o mesmo.
    for (const x of grupos) {
      const distintos = new Set(x.sessoes.map(s => s.comissao_valor))
      assert.equal(x.valorPorSessao !== null, distintos.size === 1, `rodada ${r}: valorPorSessao inconsistente`)
    }
  }
})

test('PROPRIEDADE: o pacote nunca soma mais que as vendas que o compoem', () => {
  const g = gerador(7)
  const STATUS = ['aprovada', 'reembolsada', 'chargeback', 'cancelada']
  for (let r = 0; r < RODADAS; r++) {
    const pai = { id: 'pai', valor_liquido: g.dinheiro(), valor_pago_cliente: g.dinheiro(), status: 'aprovada', pacote_pai_id: null }
    const candidatas = [pai, ...Array.from({ length: g.inteiro(0, 8) }, (_, i) => ({
      id: `f${i}`, valor_liquido: g.dinheiro(), valor_pago_cliente: g.dinheiro(),
      status: g.escolha(STATUS), pacote_pai_id: g.prox() < 0.7 ? 'pai' : `outro${i}`,
    }))]
    const liq = liquidoDoPacote(pai as never, candidatas as never)
    const bru = brutoDoPacote(pai as never, candidatas as never)
    const tetoLiq = candidatas.reduce((a, v) => a + v.valor_liquido, 0)
    const tetoBru = candidatas.reduce((a, v) => a + v.valor_pago_cliente, 0)
    assert.ok(liq <= tetoLiq + 1e-9, `rodada ${r}: liquido do pacote passou a soma de tudo`)
    assert.ok(bru <= tetoBru + 1e-9, `rodada ${r}: bruto do pacote passou a soma de tudo`)
    assert.ok(liq >= pai.valor_liquido - 1e-9, `rodada ${r}: pacote menor que a propria venda-pai`)
  }
})

test('a tela mostra o total que SOMA os grupos, nao o total cru da rota', () => {
  // Teste de fiacao do que a propriedade acima provou: os subtotais por produto
  // sao arredondados, e o total cru da rota pode diferir da soma deles em um
  // centavo. O cabecalho tem que somar as linhas logo abaixo dele.
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  const tela = readFileSync(new URL('../app/terapeutas/fechamentos/page.tsx', import.meta.url), 'utf8')
  assert.ok(tela.includes('totalDosGrupos(agruparPorProduto(preview.sessoes))'),
    'o cabecalho dos pendentes nao usa o total dos grupos')
})
