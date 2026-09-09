import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NOMENCLATURAS_POR_PROJETO, nomenclaturasDoProjeto } from './nomenclaturas-trafego'

// O casamento real, copiado de `getProjectInvestment` em lib/meta.ts: o nome da
// campanha CONTEM o termo, sem diferenciar maiuscula.
const casa = (campanha: string, termos: string[]) =>
  termos.some(n => campanha.toLowerCase().includes(n.toLowerCase()))

test('as tres nomenclaturas do projeto estao la', () => {
  assert.deepEqual(nomenclaturasDoProjeto('proj_1'), ['[F01-IRM', '[PF01_RC', 'CSP'])
})

test('projeto desconhecido cai no proj_1, como o codigo antigo fazia', () => {
  assert.deepEqual(nomenclaturasDoProjeto('proj_999'), nomenclaturasDoProjeto('proj_1'))
  assert.deepEqual(nomenclaturasDoProjeto(null), nomenclaturasDoProjeto('proj_1'))
})

test('CSP pega TUDO que tiver CSP no nome, em qualquer caixa', () => {
  // Decisao explicita do usuario em 09/09/2026. Os dois primeiros sao nomes
  // reais do painel do Meta; os demais sao variantes de escrita que ele quer
  // garantir que entrem.
  const termos = nomenclaturasDoProjeto('proj_1')
  for (const nome of [
    'CSP_Vendas_Frio_Advantage_TesteCriativo_VID_01',
    'csp_vendas_frio_advantage',
    'CSP',
    'CSP - Vendas Frio',
    '[CSP] Combo',
    'Combo CSP 02',
    'Vendas CSP',
  ]) {
    assert.ok(casa(nome, termos), nome)
  }
})

test('as duas nomenclaturas antigas continuam pegando o que pegavam', () => {
  const termos = nomenclaturasDoProjeto('proj_1')
  assert.ok(casa('[F01-IRM] Imersao 03', termos))
  assert.ok(casa('[PF01_RC] Perpetuo Reconquista', termos))
})

test('CUSTO CONHECIDO: sigla grudada dentro de outra palavra TAMBEM entra', () => {
  // Consequencia aceita do termo solto. Nao e bug a corrigir - e o que o
  // usuario pediu. Fica registrado para que, se o investimento da tela inicial
  // aparecer alto demais, este seja o primeiro lugar a olhar: a conta tem 246
  // campanhas.
  const termos = nomenclaturasDoProjeto('proj_1')
  for (const nome of ['CSPX - outro produto', 'Campanha ACSP interna']) {
    assert.ok(casa(nome, termos), `${nome} entra, e isso e esperado`)
  }
})

test('a lista NAO pode voltar a ser duplicada em rota nenhuma', () => {
  // Ela ja esteve copiada em `meta/insights` e `meta/test`. Acrescentar uma
  // nomenclatura num e esquecer do outro faz a tela mostrar um numero e o teste
  // confirmar outro, sem erro nenhum.
  for (const arq of ['app/api/meta/insights/route.ts', 'app/api/meta/test/route.ts']) {
    const texto = readFileSync(new URL('../' + arq, import.meta.url), 'utf8')
    assert.ok(texto.includes('nomenclaturasDoProjeto'), `${arq} tem de ler a lista de lib/nomenclaturas-trafego.ts`)
    assert.ok(!/\[F01-IRM/.test(texto), `${arq} voltou a ter a lista escrita a mao`)
  }
})

test('nenhuma nomenclatura vazia ou repetida', () => {
  for (const [projeto, termos] of Object.entries(NOMENCLATURAS_POR_PROJETO)) {
    for (const t of termos) assert.ok(t.trim().length > 0, `${projeto} tem termo vazio`)
    assert.equal(new Set(termos.map(t => t.toLowerCase())).size, termos.length, `${projeto} tem termo repetido`)
  }
})
