import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  getCampanhaInsights, getAdInsightsPorTermos, getCampanhaInsightsDiario, getAdsCreativeDetails,
  getProjectInvestment, type RelatoMeta,
} from './meta'

// Erro da Meta deixa de ser escondido (dono 10/11/2026, Task 5 do plano
// docs/superpowers/plans/2026-11-10-botao-resgate-funis.md). Cada parada por erro
// soma 1 em relato.falhas; sem relato, o comportamento e o de antes.
// Fetch simulado - nao vai na Meta.

const fetchOriginal = globalThis.fetch
type Resposta = { ok: boolean; status?: number; json?: unknown; naoJson?: boolean; lanca?: boolean; textoLanca?: boolean }
let roteiro: (url: string) => Resposta
let chamadas: string[] = []

const ok = (json: unknown): Resposta => ({ ok: true, json })
const http500: Resposta = { ok: false, status: 500 }
const erroMeta: Resposta = { ok: true, json: { error: { message: '(#17) User request limit reached' } } }
const naoJson: Resposta = { ok: true, naoJson: true }
const rede: Resposta = { ok: false, lanca: true }

beforeEach(() => {
  process.env.META_ACCESS_TOKEN = 'tok-de-teste'
  chamadas = []
  globalThis.fetch = (async (url: string) => {
    chamadas.push(url)
    const r = roteiro(url)
    if (r.lanca) throw new Error('ECONNRESET')
    return {
      ok: r.ok, status: r.status ?? 200,
      json: async () => { if (r.naoJson) throw new SyntaxError('Unexpected token <'); return r.json },
      text: async () => { if (r.textoLanca) throw new Error('corpo cortado'); return r.naoJson ? '<html>' : JSON.stringify(r.json ?? 'erro') },
    } as unknown as Response
  }) as typeof fetch
})
afterEach(() => { globalThis.fetch = fetchOriginal })

const PAG2 = 'https://graph.facebook.com/v19.0/pagina-2'
const linhaA = { campaign_name: 'CSP A', spend: '10', date_start: '2026-10-01', inline_link_clicks: '1', ad_id: 'x1' }
const linhaB = { campaign_name: 'CSP B', spend: '20', date_start: '2026-10-02', inline_link_clicks: '2', ad_id: 'x2' }

const funcoes: [string, (relato?: RelatoMeta) => Promise<unknown[]>][] = [
  ['getCampanhaInsights', relato => getCampanhaInsights('111', '2026-10-01', '2026-10-31', undefined, relato)],
  ['getAdInsightsPorTermos', relato => getAdInsightsPorTermos('111', '2026-10-01', '2026-10-31', ['CSP'], undefined, relato)],
  ['getCampanhaInsightsDiario', relato => getCampanhaInsightsDiario('111', '2026-10-01', '2026-10-31', undefined, relato)],
]

for (const [nome, chamar] of funcoes) {
  for (const [caso, resp] of [['HTTP 500', http500], ['rede', rede], ['json.error', erroMeta], ['corpo nao-JSON', naoJson]] as const) {
    test(`${nome}: ${caso} conta 1 falha e devolve lista vazia`, async () => {
      roteiro = () => resp
      const relato: RelatoMeta = { falhas: 0 }
      assert.deepEqual(await chamar(relato), [])
      assert.equal(relato.falhas, 1)
    })
  }

  test(`${nome}: tudo ok conta 0 e traz as linhas`, async () => {
    roteiro = () => ok({ data: [linhaA, linhaB] })
    const relato: RelatoMeta = { falhas: 0 }
    assert.deepEqual(await chamar(relato), [linhaA, linhaB])
    assert.equal(relato.falhas, 0)
  })

  test(`${nome}: pagina 1 ok e pagina 2 em 500 traz a pagina 1 e conta 1 falha`, async () => {
    roteiro = url => (url === PAG2 ? http500 : ok({ data: [linhaA], paging: { next: PAG2 } }))
    const relato: RelatoMeta = { falhas: 0 }
    assert.deepEqual(await chamar(relato), [linhaA])
    assert.equal(relato.falhas, 1)
  })

  test(`${nome}: sem relato, erro nao lanca e as linhas sao as de antes`, async () => {
    roteiro = url => (url === PAG2 ? http500 : ok({ data: [linhaA], paging: { next: PAG2 } }))
    assert.deepEqual(await chamar(), [linhaA])
  })
}

// ---- getAdsCreativeDetails ----

function idsDaUrl(url: string): string[] {
  const m = url.match(/[?&]ids=([^&]+)/)
  return m ? decodeURIComponent(m[1]).split(',') : []
}
const detalhe = (id: string) => ({ id, name: `Anuncio ${id}`, effective_status: 'ACTIVE' })
const tudoOk = (url: string) => ok(Object.fromEntries(idsDaUrl(url).map(id => [id, detalhe(id)])))
const novoCache = () => new Map<string, { t: number; detail: Record<string, unknown> }>()
const seq = (n: number, off = 0) => Array.from({ length: n }, (_, i) => `a${i + off}`)

test('getAdsCreativeDetails: um lote em 500 conta 1 falha e os outros lotes entram', async () => {
  roteiro = url => (idsDaUrl(url).includes('a0') ? http500 : tudoOk(url))
  const relato: RelatoMeta = { falhas: 0 }
  const m = await getAdsCreativeDetails(seq(120), 6, { cache: novoCache(), relato })
  assert.equal(relato.falhas, 1)
  assert.equal(m.size, 70)
  assert.ok(!m.has('a0') && m.has('a50') && m.has('a119'))
})

test('getAdsCreativeDetails: lote 200 com error global conta 1 falha e nada do lote entra', async () => {
  roteiro = () => erroMeta
  const relato: RelatoMeta = { falhas: 0 }
  const m = await getAdsCreativeDetails(['a', 'b'], 6, { cache: novoCache(), relato })
  assert.equal(relato.falhas, 1)
  assert.equal(m.size, 0)
})

for (const [caso, valorDeA] of [['{ error }', { error: { message: 'x' } }], ['false', false], ['null', null], ['texto', 'oi']] as const) {
  test(`getAdsCreativeDetails: id com ${caso} conta falha, fica fora do mapa e do cache`, async () => {
    roteiro = () => ok({ a: valorDeA, b: detalhe('b') })
    const relato: RelatoMeta = { falhas: 0 }
    const cache = novoCache()
    const m = await getAdsCreativeDetails(['a', 'b'], 6, { cache, relato })
    assert.equal(relato.falhas, 1)
    assert.ok(m.has('b'))
    assert.ok(!m.has('a'))
    assert.ok(!cache.has('a'))
    // chamada seguinte sem bust busca 'a' de novo (nao ficou guardado como valido)
    roteiro = tudoOk; chamadas = []
    const m2 = await getAdsCreativeDetails(['a', 'b'], 6, { cache })
    assert.deepEqual(chamadas.flatMap(idsDaUrl), ['a'])
    assert.ok(m2.has('a') && m2.has('b'))
  })
}

test('getAdsCreativeDetails: dois ids ruins no mesmo lote contam 2 falhas', async () => {
  roteiro = () => ok({ a: null, b: false, c: detalhe('c') })
  const relato: RelatoMeta = { falhas: 0 }
  const m = await getAdsCreativeDetails(['a', 'b', 'c'], 6, { cache: novoCache(), relato })
  assert.equal(relato.falhas, 2)
  assert.deepEqual([...m.keys()], ['c'])
})

test('getAdsCreativeDetails: id pedido ausente na resposta conta falha e fica fora', async () => {
  roteiro = () => ok({ b: detalhe('b') })
  const relato: RelatoMeta = { falhas: 0 }
  const m = await getAdsCreativeDetails(['a', 'b'], 6, { cache: novoCache(), relato })
  assert.equal(relato.falhas, 1)
  assert.deepEqual([...m.keys()], ['b'])
})

test('getAdsCreativeDetails: chave que nao foi pedida nao entra', async () => {
  roteiro = () => ok({ a: detalhe('a'), b: detalhe('b'), intrusa: detalhe('intrusa') })
  const relato: RelatoMeta = { falhas: 0 }
  const m = await getAdsCreativeDetails(['a', 'b'], 6, { cache: novoCache(), relato })
  assert.equal(relato.falhas, 0)
  assert.deepEqual([...m.keys()].sort(), ['a', 'b'])
})

test('getAdsCreativeDetails: corpo nao-objeto conta 1 falha', async () => {
  roteiro = () => ok([detalhe('a')])
  const relato: RelatoMeta = { falhas: 0 }
  const m = await getAdsCreativeDetails(['a'], 6, { cache: novoCache(), relato })
  assert.equal(relato.falhas, 1)
  assert.equal(m.size, 0)
})

test('getAdsCreativeDetails: tudo ok conta 0', async () => {
  roteiro = tudoOk
  const relato: RelatoMeta = { falhas: 0 }
  const m = await getAdsCreativeDetails(['a', 'b'], 6, { cache: novoCache(), relato })
  assert.equal(relato.falhas, 0)
  assert.equal(m.size, 2)
})

// ---- getProjectInvestment (Fechamento, DRE, inicio) - Task 6 ----

const contaDaUrl = (url: string) => /act_(\w+)\//.exec(url)?.[1] ?? ''
const gasto: Record<string, string> = { A: '5000', B: '6000', C: '8000', D: '7000', E: '4000' }
const campanhaDaConta = (conta: string) => ({ name: `CSP - ${conta}`, insights: { data: [{ spend: gasto[conta] }] } })
const contasOk = (url: string) => ok({ data: [campanhaDaConta(contaDaUrl(url))] })

function comContas<T>(fn: () => Promise<T>): Promise<T> {
  const antes = process.env.META_AD_ACCOUNT_IDS
  process.env.META_AD_ACCOUNT_IDS = 'A,B,C,D,E'
  return fn().finally(() => { if (antes === undefined) delete process.env.META_AD_ACCOUNT_IDS; else process.env.META_AD_ACCOUNT_IDS = antes })
}

test('getProjectInvestment: tudo ok soma as 5 contas e conta 0', () => comContas(async () => {
  roteiro = contasOk
  const relato: RelatoMeta = { falhas: 0 }
  const r = await getProjectInvestment(['CSP'], '2026-10-01', '2026-10-31', undefined, relato)
  assert.equal(r.total, 30000)
  assert.equal(relato.falhas, 0)
}))

for (const [caso, resp] of [['HTTP 500', http500], ['rede', rede], ['json.error', erroMeta], ['corpo nao-JSON', naoJson], ['res.text() que rejeita', { ok: false, status: 502, textoLanca: true } as Resposta]] as const) {
  test(`getProjectInvestment: conta C com ${caso} conta 1 falha e soma so as outras 4`, () => comContas(async () => {
    roteiro = url => (contaDaUrl(url) === 'C' ? resp : contasOk(url))
    const relato: RelatoMeta = { falhas: 0 }
    const r = await getProjectInvestment(['CSP'], '2026-10-01', '2026-10-31', undefined, relato)
    assert.equal(r.total, 22000)
    assert.equal(relato.falhas, 1)
    assert.deepEqual(r.campanhas.map(c => c.accountId).sort(), ['A', 'B', 'D', 'E'])
  }))
}

test('getProjectInvestment: segunda pagina de uma conta em erro conta 1 falha', () => comContas(async () => {
  roteiro = url => {
    if (url === PAG2) return http500
    const conta = contaDaUrl(url)
    return conta === 'A' ? ok({ data: [campanhaDaConta('A')], paging: { next: PAG2 } }) : contasOk(url)
  }
  const relato: RelatoMeta = { falhas: 0 }
  const r = await getProjectInvestment(['CSP'], '2026-10-01', '2026-10-31', undefined, relato)
  assert.equal(r.total, 30000)
  assert.equal(relato.falhas, 1)
}))

test('getProjectInvestment: sem relato, falha nao lanca e o total e o de antes', () => comContas(async () => {
  roteiro = url => (contaDaUrl(url) === 'C' ? http500 : contasOk(url))
  const r = await getProjectInvestment(['CSP'], '2026-10-01', '2026-10-31')
  assert.equal(r.total, 22000)
}))

// Revisao Gemini da trava (13/11/2026): conta vazia e resposta sem lista nao
// podem passar como "busca completa com gasto zero".
test('getProjectInvestment: nenhuma conta configurada conta 1 falha', async () => {
  const antes = process.env.META_AD_ACCOUNT_IDS
  process.env.META_AD_ACCOUNT_IDS = ' , '
  try {
    roteiro = contasOk
    const relato: RelatoMeta = { falhas: 0 }
    const r = await getProjectInvestment(['CSP'], '2026-10-01', '2026-10-31', undefined, relato)
    assert.equal(r.total, 0)
    assert.equal(relato.falhas, 1)
  } finally {
    if (antes === undefined) delete process.env.META_AD_ACCOUNT_IDS; else process.env.META_AD_ACCOUNT_IDS = antes
  }
})

test('getProjectInvestment: sem token conta 1 falha', () => comContas(async () => {
  delete process.env.META_ACCESS_TOKEN
  roteiro = contasOk
  const relato: RelatoMeta = { falhas: 0 }
  const r = await getProjectInvestment(['CSP'], '2026-10-01', '2026-10-31', undefined, relato)
  assert.equal(r.total, 0)
  assert.ok(relato.falhas >= 1)
}))

test('getProjectInvestment: conta que responde 200 sem lista de campanhas conta falha', () => comContas(async () => {
  roteiro = url => (contaDaUrl(url) === 'C' ? ok({}) : contasOk(url))
  const relato: RelatoMeta = { falhas: 0 }
  const r = await getProjectInvestment(['CSP'], '2026-10-01', '2026-10-31', undefined, relato)
  assert.equal(r.total, 22000)
  assert.equal(relato.falhas, 1)
}))
