import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NOMENCLATURAS_POR_PROJETO, nomenclaturasDoProjeto } from './nomenclaturas-trafego'

// O casamento real, copiado de `getProjectInvestment` em lib/meta.ts: o nome da
// campanha CONTEM o termo, sem diferenciar maiuscula.
const casa = (campanha: string, termos: string[]) =>
  termos.some(n => campanha.toLowerCase().includes(n.toLowerCase()))

test('as tres nomenclaturas do projeto estao la', () => {
  assert.deepEqual(nomenclaturasDoProjeto('proj_1'), ['[F01-IRM', '[PF01_RC', 'CSP_'])
})

test('projeto desconhecido cai no proj_1, como o codigo antigo fazia', () => {
  assert.deepEqual(nomenclaturasDoProjeto('proj_999'), nomenclaturasDoProjeto('proj_1'))
  assert.deepEqual(nomenclaturasDoProjeto(null), nomenclaturasDoProjeto('proj_1'))
})

test('CSP_ pega as campanhas reais do combo, em qualquer caixa', () => {
  // Nomes tirados do painel do Meta em 09/09/2026.
  const termos = nomenclaturasDoProjeto('proj_1')
  for (const nome of [
    'CSP_Vendas_Frio_Advantage_TesteCriativo_VID_01',
    'CSP_Vendas_Frio_Advantage_TesteCriativo_VID_08',
    'csp_vendas_frio_advantage',
  ]) {
    assert.ok(casa(nome, termos), nome)
  }
})

test('as duas nomenclaturas antigas continuam pegando o que pegavam', () => {
  const termos = nomenclaturasDoProjeto('proj_1')
  assert.ok(casa('[F01-IRM] Imersao 03', termos))
  assert.ok(casa('[PF01_RC] Perpetuo Reconquista', termos))
})

test('o underscore evita pegar campanha que so TEM "csp" no meio', () => {
  // Era o risco de usar "CSP" solto: a conta tem 246 campanhas e o casamento e
  // por CONTEM. Com o underscore, nenhuma dessas entra.
  const termos = nomenclaturasDoProjeto('proj_1')
  for (const nome of ['CSPX - outro produto', 'Campanha ACSP interna', 'RECSP teste']) {
    assert.equal(casa(nome, termos), false, nome)
  }
})

test('MAS o underscore tambem exclui variantes de escrita do MESMO produto', () => {
  // Registrado para nao ser descoberto como surpresa: se o time nomear uma
  // campanha do combo de outro jeito, ela NAO entra no investimento da tela
  // inicial, e em silencio. O lugar de corrigir e acrescentar a variante na
  // lista, nao afrouxar o termo.
  const termos = nomenclaturasDoProjeto('proj_1')
  for (const nome of ['CSP - Vendas Frio', '[CSP] Combo', 'Combo CSP 02']) {
    assert.equal(casa(nome, termos), false, nome)
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
