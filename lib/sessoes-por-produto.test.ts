import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { agruparPorProduto, totalDosGrupos } from './sessoes-por-produto'

const MENTORIA = 'Mentoria Particular - Pedro | Denise'
const DIAG = 'Diagnóstico Guiado: Programa de acompanhamento Individual'

// Os 10 pendentes REAIS da Denise em 11/09/2026, com os valores CRUS do banco.
//
// Nao os arredondados da tela: a primeira versao deste fixture usava 88.22 e
// 141.86, e a soma dava R$ 870,12 contra os R$ 870,10 que a tela mostra. Valor
// de dinheiro em teste tem que vir cru, senao o teste esconde exatamente o
// arredondamento que deveria verificar.
const M = 88.216498125   // Marcio (x3), Jaqueline, Sara, Amanda
const D = 99.4738815     // Daniel (x2)
const O = 141.857541     // Osni
const PENDENTES = [
  { id: '1', sale_id: 'marcio', produto: MENTORIA, comissao_valor: M },
  { id: '2', sale_id: 'marcio', produto: MENTORIA, comissao_valor: M },
  { id: '3', sale_id: 'jaqueline', produto: MENTORIA, comissao_valor: M },
  { id: '4', sale_id: 'osni', produto: MENTORIA, comissao_valor: O },
  { id: '5', sale_id: 'daniel', produto: MENTORIA, comissao_valor: D },
  { id: '6', sale_id: 'sara', produto: MENTORIA, comissao_valor: M },
  { id: '7', sale_id: 'juliane', produto: DIAG, comissao_valor: 95.00 },
  { id: '8', sale_id: 'daniel', produto: MENTORIA, comissao_valor: D },
  { id: '9', sale_id: 'marcio', produto: MENTORIA, comissao_valor: M },
  { id: '10', sale_id: 'amanda', produto: MENTORIA, comissao_valor: M },
]

test('CASO REAL: os 10 pendentes da Denise viram 2 grupos', () => {
  const g = agruparPorProduto(PENDENTES)
  assert.equal(g.length, 2)
  assert.equal(g[0].produto, MENTORIA)
  assert.equal(g[0].sessoes.length, 9)
  assert.equal(g[0].total, 870.10)
  assert.equal(g[1].produto, DIAG)
  assert.equal(g[1].sessoes.length, 1)
  assert.equal(g[1].total, 95)
})

test('o total dos grupos bate EXATO com o total da tela', () => {
  // R$ 965,10 e o numero que a tela mostra hoje. Se o agrupamento mudar o
  // total, e defeito - agrupar nao pode criar nem sumir com centavo.
  assert.equal(totalDosGrupos(agruparPorProduto(PENDENTES)), 965.10)
})

test('so mostra "por sessao" quando TODAS valem o mesmo', () => {
  // E o que distingue os dois regimes sem precisar explicar na tela.
  const g = agruparPorProduto(PENDENTES)
  assert.equal(g[0].valorPorSessao, null, 'Mentoria e percentual: os valores variam')
  assert.equal(g[1].valorPorSessao, 95, 'Diagnostico e fixo')
})

test('CASO REAL: as 74 futuras, onde o ganho e maior', () => {
  // Hoje sao 7 paginas de lista misturada. Agrupadas, o compromisso futuro
  // aparece de cara.
  const futuras = [
    ...Array.from({ length: 64 }, (_, i) => ({ id: `d${i}`, sale_id: `v${i}`, produto: DIAG, comissao_valor: 95 })),
    ...Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, sale_id: `w${i}`, produto: MENTORIA, comissao_valor: 88.216 })),
  ]
  const g = agruparPorProduto(futuras)
  assert.equal(g[0].produto, DIAG, 'o maior valor vem primeiro')
  assert.equal(g[0].total, 6080)
  assert.equal(g[0].valorPorSessao, 95)
  assert.equal(g[1].total, 882.16)
})

test('ordena por VALOR, nao por quantidade', () => {
  // Quem abre a tela quer saber onde esta o dinheiro.
  const g = agruparPorProduto([
    { id: '1', sale_id: 'a', produto: 'Pouca coisa', comissao_valor: 10 },
    { id: '2', sale_id: 'b', produto: 'Pouca coisa', comissao_valor: 10 },
    { id: '3', sale_id: 'c', produto: 'Pouca coisa', comissao_valor: 10 },
    { id: '4', sale_id: 'd', produto: 'Muito dinheiro', comissao_valor: 500 },
  ])
  assert.equal(g[0].produto, 'Muito dinheiro', '3 sessoes baratas nao passam na frente de 1 caras')
})

test('produto vazio ganha rotulo, nao vira string vazia na tela', () => {
  // Sessao sem venda correspondente e sinal de problema, nao de nada.
  for (const p of [null, undefined, '', '   ']) {
    const g = agruparPorProduto([{ id: '1', sale_id: 'a', produto: p as never, comissao_valor: 10 }])
    assert.equal(g[0].produto, 'Sem produto identificado', JSON.stringify(p))
  }
})

test('lista vazia devolve nenhum grupo e total zero', () => {
  assert.deepEqual(agruparPorProduto([]), [])
  assert.equal(totalDosGrupos([]), 0)
})

test('a ordem e estavel quando dois grupos empatam no valor', () => {
  const um = agruparPorProduto([
    { id: '1', sale_id: 'a', produto: 'Zebra', comissao_valor: 100 },
    { id: '2', sale_id: 'b', produto: 'Alfa', comissao_valor: 100 },
  ])
  assert.deepEqual(um.map(g => g.produto), ['Alfa', 'Zebra'])
})

test('a API manda o produto, senao nao ha o que agrupar', () => {
  // Teste de fiacao: o agrupamento pode estar perfeito e a rota nao enviar o
  // campo - e ai TUDO cai em "Sem produto identificado", num grupo so.
  const rota = readFileSync(new URL('../app/api/terapeutas/fechamentos/route.ts', import.meta.url), 'utf8')
  assert.ok(rota.includes('produto'), 'a rota nao traz o produto das sessoes')
})

test('a tela de pagamento agrupa as DUAS listas, pendentes e futuras', () => {
  // Escrevi este teste primeiro exigindo as duas telas de terapeuta, como no
  // teste da faixa de periodo, e ele falhou com razao: `/terapeutas/[id]` NAO
  // tem lista de pagamento - so o historico de fechamento e o card "Comissao
  // gerada". A lista pendentes/futuras existe so em `/terapeutas/fechamentos`.
  //
  // O que precisa ser travado ali sao as DUAS listas da mesma tela: agrupar os
  // pendentes e esquecer as futuras deixaria justamente a lista de 74 sessoes,
  // que e a que mais precisa, sem agrupamento.
  const tela = readFileSync(new URL('../app/terapeutas/fechamentos/page.tsx', import.meta.url), 'utf8')
  assert.ok(tela.includes('agruparPorProduto'), 'a tela nao agrupa por produto')
  assert.ok(tela.includes('linhasAgrupadas(preview.sessoes)'), 'a lista de PENDENTES nao esta agrupada')
  assert.ok(tela.includes('linhasAgrupadas(futuras.sessoes)'), 'a lista de FUTURAS nao esta agrupada')
  // A paginacao tem que contar as linhas, nao as sessoes: o cabecalho de grupo
  // ocupa linha, e paginar pelas sessoes deixaria a ultima pagina faltando itens.
  assert.ok(
    !/Math\.ceil\((preview|futuras)\.sessoes\.length \/ SESSOES_PAGE_SIZE\)/.test(tela),
    'a paginacao ainda conta sessoes em vez de linhas',
  )
})
