import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { repasseDoDiagnostico } from './repasse-do-diagnostico'

const DIAG = 'Diagnóstico Guiado: Programa de acompanhamento Individual'
// order_id da Hubla e "{uuid}-{idDaOferta}"; estes sao os IDs reais mapeados.
const F1 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeee-WXwmPZfJxGqeXerA6dkO'
const F2 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeee-H8DA8U21x7Lmv3NreVMs'
const F3 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeee-qVvads7GKaI7lN1Kctrr'

test('CASO REAL: a venda do Ibraim, Formato 2, paga R$ 285 a Denise', () => {
  // 4 sessoes: 1 do Pedro (socio, R$ 0) + 3 da Denise a R$ 95.
  // Hoje o fechamento provisiona R$ 0,00 nesta venda.
  const r = repasseDoDiagnostico([
    { id: '166a57d7', nome: 'Ibraim Djalma Melo Costa', order_id: null, oferta_nome: 'FORMATO 2', produto: DIAG },
  ])
  assert.equal(r.total, 285)
  assert.equal(r.porVenda[0].sessoesDenise, 3)
  assert.equal(r.porVenda[0].formato, 2)
  assert.equal(r.semFormato.length, 0)
})

test('a divisao de cada formato, que e a regra do produto', () => {
  const casos: [string, 1 | 2 | 3, number, number][] = [
    // order_id, formato, sessoes da Denise, valor
    [F1, 1, 7, 665],  // 9 sessoes, 2 do Pedro
    [F2, 2, 3, 285],  // 4 sessoes, 1 do Pedro
    [F3, 3, 1, 95],   // 2 sessoes, 1 do Pedro
  ]
  for (const [order, formato, sessoes, valor] of casos) {
    const r = repasseDoDiagnostico([{ id: 'x', nome: 'y', order_id: order, produto: DIAG }])
    assert.equal(r.porVenda[0].formato, formato)
    assert.equal(r.porVenda[0].sessoesDenise, sessoes, `formato ${formato}`)
    assert.equal(r.total, valor, `formato ${formato}`)
  }
})

test('CASO REAL: as 17 vendas de producao somam R$ 6.175,00', () => {
  // Os formatos reais medidos no banco em 11/09/2026: 6 do F1, 6 do F2, 5 do F3.
  const vendas = [
    ...Array.from({ length: 6 }, (_, i) => ({ id: `f1-${i}`, nome: `p${i}`, order_id: F1, produto: DIAG })),
    ...Array.from({ length: 6 }, (_, i) => ({ id: `f2-${i}`, nome: `q${i}`, order_id: F2, produto: DIAG })),
    ...Array.from({ length: 5 }, (_, i) => ({ id: `f3-${i}`, nome: `r${i}`, order_id: F3, produto: DIAG })),
  ]
  const r = repasseDoDiagnostico(vendas)
  assert.equal(r.porVenda.length, 17)
  assert.equal(r.porVenda.reduce((a, v) => a + v.sessoesDenise, 0), 65, 'sao 65 sessoes da Denise')
  assert.equal(r.total, 6175)
})

test('o valor NAO e percentual do faturamento - e a diferenca que importa', () => {
  // Se a regra dos 30% fosse aplicada ao Diagnostico, sairia R$ 13.628,71 nas
  // mesmas 17 vendas (30% de R$ 45.429,05 de liquido pos-imposto). Este teste
  // existe para travar a tentacao de "so fazer o match funcionar".
  const liquidoPosImposto = 45429.05
  const seFossePercentual = liquidoPosImposto * 0.30
  assert.ok(seFossePercentual > 13000)
  const vendas = [
    ...Array.from({ length: 6 }, (_, i) => ({ id: `a${i}`, nome: 'x', order_id: F1, produto: DIAG })),
    ...Array.from({ length: 6 }, (_, i) => ({ id: `b${i}`, nome: 'x', order_id: F2, produto: DIAG })),
    ...Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, nome: 'x', order_id: F3, produto: DIAG })),
  ]
  const r = repasseDoDiagnostico(vendas)
  assert.equal(r.total, 6175)
  assert.ok(r.total < seFossePercentual / 2, 'o percentual tiraria mais que o dobro do devido')
})

test('venda de Diagnostico SEM formato reconhecido e devolvida, nao engolida', () => {
  // Um zero silencioso aqui e o mesmo defeito que o modulo conserta, na outra
  // roupa: a venda entra no faturamento e sai do repasse sem ninguem ver.
  const r = repasseDoDiagnostico([
    { id: 'boa', nome: 'Ibraim', order_id: null, oferta_nome: 'FORMATO 2', produto: DIAG },
    { id: 'ruim', nome: 'Alguem', order_id: null, oferta_nome: 'Oferta Padrao', produto: DIAG },
  ])
  assert.equal(r.total, 285, 'a boa conta normal')
  assert.equal(r.semFormato.length, 1)
  assert.equal(r.semFormato[0].nome, 'Alguem')
})

test('lista vazia devolve zero, sem quebrar', () => {
  const r = repasseDoDiagnostico([])
  assert.equal(r.total, 0)
  assert.deepEqual(r.porVenda, [])
  assert.deepEqual(r.semFormato, [])
})

test('a tela de Fechamentos usa a regra por sessao no Diagnostico', () => {
  // Teste de fiacao. A regra pode estar perfeita e a tela continuar com
  // `matchTerapeutaComissao` sozinho, que devolve null no Diagnostico.
  const tela = readFileSync(new URL('../app/fechamentos/page.tsx', import.meta.url), 'utf8')
  assert.ok(tela.includes('repasseDoDiagnostico'), 'a tela nao usa repasseDoDiagnostico')
  assert.ok(tela.includes('ehDiagnosticoGuiado'), 'a tela nao identifica o produto do Diagnostico')
})

test('a tela AVISA quando uma venda de Diagnostico fica de fora do repasse', () => {
  // `semFormato` pode ser devolvido corretamente e ignorado pela tela - e ai a
  // venda entra no faturamento, sai do repasse, e ninguem ve. Silencio em
  // codigo de dinheiro e o defeito que este modulo inteiro conserta.
  const tela = readFileSync(new URL('../app/fechamentos/page.tsx', import.meta.url), 'utf8')
  assert.ok(tela.includes('diagSemFormato'), 'a tela nao calcula as vendas sem formato')
  assert.ok(tela.includes('sem formato reconhecido'), 'a tela nao avisa o usuario')
})
