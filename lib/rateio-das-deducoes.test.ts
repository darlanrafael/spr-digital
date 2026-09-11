import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  divisaoOriginalDoAlerta, deducoesPorSocio, divisaoQueVale, descricaoDoPrejuizoNoCaixa,
} from './rateio-das-deducoes'

const SPR = 'SPR DIGITAL LTDA'
const PEDRO = 'Pedro Roncada'

// Os dois fechamentos reais que importam para o caso, como estao no banco.
const IAR = {
  id: 'close_1786715202610', etiqueta: 'FECHAMENTO IAR',
  data_confirmacao: '2026-08-03T12:00:00Z', data: '2026-08-03',
  periodo: { inicio: '2026-06-23', fim: '2026-08-03' },
  socios: [{ nome: SPR, percentual: 50, valor: 0 }, { nome: PEDRO, percentual: 50, valor: 0 }],
  compradores: [
    { id: 'venda-jully', nome: 'Jully Gonçalves De Almeida', email: '', cpf: '', produto: 'O RESGATE', valor: 0 },
    { id: 'venda-gianna', nome: 'Gianna Antonia de Moura', email: '', cpf: '', produto: 'O RESGATE', valor: 0 },
  ],
}
const MENTORIAS = {
  id: 'close_1786718768403', etiqueta: 'FECHAMENTO MENTORIAS - PEDRO',
  data_confirmacao: '2026-08-14T12:00:00Z', data: '2026-08-14',
  periodo: { inicio: '2026-07-06', fim: '2026-08-14' },
  socios: [{ nome: SPR, percentual: 35, valor: 0 }, { nome: PEDRO, percentual: 65, valor: 0 }],
  compradores: [],
}
const FECHAMENTOS = [IAR, MENTORIAS] as never[]

test('CASO REAL: os 6 estornos do O RESGATE puxam 50/50 do fechamento que os pagou', () => {
  const o = divisaoOriginalDoAlerta({ saleId: 'venda-jully' }, FECHAMENTOS)
  assert.equal(o?.divisao[SPR], 50)
  assert.equal(o?.divisao[PEDRO], 50)
  assert.equal(o?.closingId, 'close_1786715202610')
  assert.equal(o?.etiqueta, 'FECHAMENTO IAR')
})

test('CASO REAL: o Miguel nao tem fechamento de origem, e por isso errava', () => {
  // A venda dele nunca entrou em fechamento (e reembolso PARCIAL de venda nao
  // repassada). Sem origem, o comportamento antigo aplicava a divisao do
  // fechamento atual - 50/50 num fechamento do IAR, quando Mentoria e 35/65.
  assert.equal(divisaoOriginalDoAlerta({ saleId: 'venda-miguel' }, FECHAMENTOS), null)
  assert.equal(divisaoOriginalDoAlerta({ saleId: undefined }, FECHAMENTOS), null)
})

test('quando dois fechamentos contem a venda, vale o mais recente', () => {
  const antigo = { ...IAR, id: 'antigo', data_confirmacao: '2026-06-01T12:00:00Z' }
  const novo = { ...IAR, id: 'novo', data_confirmacao: '2026-08-03T12:00:00Z',
    socios: [{ nome: SPR, percentual: 35, valor: 0 }, { nome: PEDRO, percentual: 65, valor: 0 }] }
  const o = divisaoOriginalDoAlerta({ saleId: 'venda-jully' }, [antigo, novo] as never[])
  assert.equal(o?.closingId, 'novo', 'pegou o fechamento errado')
  assert.equal(o?.divisao[SPR], 35)
})

test('CASO REAL: o Miguel a 35/65 devolve os R$ 234 que a SPR absorvia a mais', () => {
  const a50 = deducoesPorSocio([{ chave: 'miguel', valor: 1560, divisao: { [SPR]: 50, [PEDRO]: 50 } }], [SPR, PEDRO])
  const a35 = deducoesPorSocio([{ chave: 'miguel', valor: 1560, divisao: { [SPR]: 35, [PEDRO]: 65 } }], [SPR, PEDRO])
  assert.equal(a50[SPR], 780)
  assert.equal(a50[PEDRO], 780)
  assert.equal(a35[SPR], 546)
  assert.equal(a35[PEDRO], 1014)
  assert.equal(Math.round((a50[SPR] - a35[SPR]) * 100) / 100, 234)
})

test('CASO REAL: a tela inteira, com divisoes DIFERENTES no mesmo fechamento', () => {
  // Seis do O RESGATE a 50/50 e um da Mentoria a 35/65, somando R$ 5.708,70.
  // E este o ponto do modulo: nao existe um percentual unico para o total.
  const resgate = [737.45, 687.99, 687.99, 687.99, 676.10, 671.18]
  const itens = [
    ...resgate.map((v, i) => ({ chave: `r${i}`, valor: v, divisao: { [SPR]: 50, [PEDRO]: 50 } })),
    { chave: 'miguel', valor: 1560, divisao: { [SPR]: 35, [PEDRO]: 65 } },
  ]
  const t = deducoesPorSocio(itens, [SPR, PEDRO])
  const somaResgate = resgate.reduce((a, b) => a + b, 0)
  assert.equal(Math.round((somaResgate + 1560) * 100) / 100, 5708.70, 'o total da tela mudou')
  assert.equal(t[SPR], 2620.35, 'a SPR absorve metade do RESGATE mais 35% do Miguel')
  assert.equal(t[PEDRO], 3088.35, 'o Pedro absorve metade do RESGATE mais 65% do Miguel')
  // O que a soma tem que fazer, e que o arredondamento por item quebrava: bater
  // EXATAMENTE com o total mostrado na tela.
  assert.equal(Math.round((t[SPR] + t[PEDRO]) * 100) / 100, 5708.70)
})

test('a soma dos socios bate com o total no centavo, em qualquer combinacao', () => {
  // O defeito que este teste trava: arredondar item a item fazia a soma dos
  // socios divergir do total da tela. Valores escolhidos para dar dizima em
  // todos os rateios.
  const casos = [
    [{ chave: 'a', valor: 0.01, divisao: { [SPR]: 33, [PEDRO]: 67 } }],
    [{ chave: 'a', valor: 100.01, divisao: { [SPR]: 33.33, [PEDRO]: 66.67 } }],
    Array.from({ length: 17 }, (_, i) => ({ chave: `x${i}`, valor: 687.99, divisao: { [SPR]: 35, [PEDRO]: 65 } })),
  ]
  for (const itens of casos) {
    const t = deducoesPorSocio(itens, [SPR, PEDRO])
    const total = Math.round(itens.reduce((a, i) => a + i.valor, 0) * 100) / 100
    assert.equal(Math.round((t[SPR] + t[PEDRO]) * 100) / 100, total,
      `nao fechou em ${JSON.stringify(itens.length)} itens`)
  }
})

test('a escolha manual ganha da origem, e a origem ganha do fechamento atual', () => {
  const doFechamento = { [SPR]: 50, [PEDRO]: 50 }
  const origem = { divisao: { [SPR]: 35, [PEDRO]: 65 }, closingId: 'x' }

  assert.deepEqual(
    divisaoQueVale({ origem, escolhaManual: { [SPR]: 20, [PEDRO]: 80 }, divisaoDoFechamento: doFechamento }),
    { divisao: { [SPR]: 20, [PEDRO]: 80 }, fonte: 'manual' })

  assert.deepEqual(divisaoQueVale({ origem, escolhaManual: null, divisaoDoFechamento: doFechamento }),
    { divisao: { [SPR]: 35, [PEDRO]: 65 }, fonte: 'origem' })

  // Sem origem e sem escolha: o comportamento ANTIGO, que fica como ultimo
  // recurso em vez de ser a regra.
  assert.deepEqual(divisaoQueVale({ origem: null, escolhaManual: {}, divisaoDoFechamento: doFechamento }),
    { divisao: doFechamento, fonte: 'fechamento' })
})

test('socio fora da divisao absorve zero, nao quebra', () => {
  const t = deducoesPorSocio([{ chave: 'x', valor: 100, divisao: { [SPR]: 100 } }], [SPR, PEDRO])
  assert.equal(t[SPR], 100)
  assert.equal(t[PEDRO], 0)
})

test('lista vazia devolve zero para cada socio, nao objeto vazio', () => {
  assert.deepEqual(deducoesPorSocio([], [SPR, PEDRO]), { [SPR]: 0, [PEDRO]: 0 })
})

test('o lancamento no caixa diz com todas as letras que a EMPRESA pagou', () => {
  // Pedido textual do usuario: "isso so precisa constar nos minimos detalhes
  // para melhor orientacao". A descricao e o campo que aparece na tela do
  // Caixa - quem abrir daqui a seis meses nao pode precisar cruzar tabela.
  const texto = descricaoDoPrejuizoNoCaixa({
    itens: [
      { nome: 'Miguel Pires', produto: 'Mentoria Particular - Pedro Roncada', valor: 1560, tipo: 'Parcial', data: '02/09/2026' },
      { nome: 'Jully Gonçalves De Almeida', produto: 'O RESGATE', valor: 737.45, tipo: 'Reembolso', data: '17/08/2026' },
    ],
    etiquetaDoFechamento: 'FECHAMENTO IAR SETEMBRO',
    periodo: '01/09/2026 a 11/09/2026',
  })
  assert.match(texto, /A EMPRESA ESTA PAGANDO/)
  assert.match(texto, /NAO foi descontado do repasse dos socios/)
  assert.match(texto, /2.297,45/, 'o total nao aparece')
  assert.match(texto, /Miguel Pires/)
  assert.match(texto, /Mentoria Particular - Pedro Roncada/)
  assert.match(texto, /02\/09\/2026/)
  assert.match(texto, /FECHAMENTO IAR SETEMBRO/)
  assert.match(texto, /01\/09\/2026 a 11\/09\/2026/)
})

test('a tela de Fechamentos usa o rateio por deducao, e nao o percentual unico', () => {
  // Teste de fiacao: o modulo pode estar perfeito e a tela continuar fazendo
  // `alertasTotal * (socioPercents[i] / 100)`, que era o defeito.
  const tela = readFileSync(new URL('../app/fechamentos/page.tsx', import.meta.url), 'utf8')
  assert.ok(tela.includes('deducoesPorSocio'), 'a tela nao usa deducoesPorSocio')
  assert.ok(tela.includes('divisaoOriginalDoAlerta'), 'a tela nao busca a divisao de origem')
  assert.ok(
    !/alertasTotal\s*\*\s*\(socioPercents\[i\]\s*\/\s*100\)/.test(tela),
    'a tela ainda rateia o total por um percentual unico - o defeito voltou',
  )
})

test('o repasse final nao pinta numero negativo de verde', () => {
  // Bug apontado pelo usuario: a coluna "Repasse final" era emerald fixo, entao
  // -R$ 4.455,62 aparecia em verde, cor de coisa boa.
  const tela = readFileSync(new URL('../app/fechamentos/page.tsx', import.meta.url), 'utf8')
  const bloco = tela.slice(tela.indexOf('Repasse ajustado após deduções'))
  const ate = bloco.slice(0, bloco.indexOf('</table>'))
  assert.ok(
    !/text-emerald-400[^`]*>\{formatCurrency\(final\)\}/.test(ate),
    'o repasse final por socio ainda esta com verde fixo',
  )
  assert.ok(ate.includes('>= 0'), 'a cor do repasse final nao depende do sinal')
})
