import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { getAdsCreativeDetails } from './meta'

// getAdsCreativeDetails busca detalhes de criativo em LOTES de 50.
// Fase 1 (item 119): lotes em PARALELO (antes serie), com teto de concorrencia,
//   mantendo fail-open (um lote que falha nao derruba os outros).
// Fase 2 (item 119): CACHE por ad_id - trocar de periodo nao re-busca anuncio ja
//   buscado; `bust` ignora o cache (botao Atualizar); expira por TTL.
// Fetch mockado - nao vai na Meta. Cache INJETADO por teste (isolamento).

const fetchOriginal = globalThis.fetch
let chamadas: string[] = []
let maxSimultaneas = 0
let emVoo = 0
let falharUrlContendo: string | null = null
let jsonEstouraUrlContendo: string | null = null
let cache: Map<string, { t: number; detail: Record<string, unknown> }>

function idsDaUrl(url: string): string[] {
  const m = url.match(/[?&]ids=([^&]+)/)
  return m ? decodeURIComponent(m[1]).split(',') : []
}

beforeEach(() => {
  process.env.META_ACCESS_TOKEN = 'tok-de-teste'
  chamadas = []; maxSimultaneas = 0; emVoo = 0; falharUrlContendo = null; jsonEstouraUrlContendo = null
  cache = new Map()
  globalThis.fetch = (async (url: string) => {
    chamadas.push(url)
    emVoo++; maxSimultaneas = Math.max(maxSimultaneas, emVoo)
    await new Promise(r => setTimeout(r, 10))
    emVoo--
    if (falharUrlContendo && url.includes(falharUrlContendo)) {
      return { ok: false, status: 500, text: async () => 'erro simulado' } as unknown as Response
    }
    if (jsonEstouraUrlContendo && url.includes(jsonEstouraUrlContendo)) {
      // corpo NAO-JSON (ex: página de erro HTML): res.json() estoura
      return { ok: true, json: async () => { throw new SyntaxError('Unexpected token < in JSON') }, text: async () => '<html>' } as unknown as Response
    }
    const ids = idsDaUrl(url)
    const json: Record<string, unknown> = {}
    for (const id of ids) json[id] = { id, name: `Anuncio ${id}`, effective_status: 'ACTIVE' }
    return { ok: true, json: async () => json, text: async () => '' } as unknown as Response
  }) as typeof fetch
})

afterEach(() => { globalThis.fetch = fetchOriginal })

const seq = (n: number, off = 0) => Array.from({ length: n }, (_, i) => `a${i + off}`)

// ---- Fase 1 ----

test('fatia em lotes de 50: 120 ids -> 3 chamadas, todos no mapa', async () => {
  const map = await getAdsCreativeDetails(seq(120), 6, { cache })
  assert.equal(chamadas.length, 3)
  assert.equal(map.size, 120)
  assert.equal((map.get('a0') as { name: string }).name, 'Anuncio a0')
})

test('os lotes rodam em PARALELO (nao em serie)', async () => {
  await getAdsCreativeDetails(seq(120), 6, { cache })
  assert.ok(maxSimultaneas >= 2, `esperava lotes simultaneos, teve max ${maxSimultaneas}`)
})

test('fail-open: um lote que falha NAO derruba os outros', async () => {
  falharUrlContendo = 'a50'
  const map = await getAdsCreativeDetails(seq(120), 6, { cache })
  assert.ok(map.has('a0')); assert.ok(map.has('a100')); assert.ok(!map.has('a50'))
  assert.equal(map.size, 70)
})

test('fail-open no PARSE: um lote com corpo nao-JSON nao derruba os outros (item 121)', async () => {
  jsonEstouraUrlContendo = 'a50' // o 2o lote (a50..a99) responde corpo nao-JSON
  const map = await getAdsCreativeDetails(seq(120), 6, { cache })
  assert.ok(map.has('a0'), 'lote 1 deveria ter vindo')
  assert.ok(map.has('a100'), 'lote 3 deveria ter vindo')
  assert.ok(!map.has('a50'), 'lote 2 estourou no parse, nao deveria ter vindo')
  assert.equal(map.size, 70)
})

test('sem token ou sem ids -> mapa vazio, sem chamada', async () => {
  const semIds = await getAdsCreativeDetails([], 6, { cache })
  assert.equal(semIds.size, 0)
  assert.equal(chamadas.length, 0)
})

test('respeita o limite de concorrencia (nao dispara TODOS os lotes de uma vez)', async () => {
  const map = await getAdsCreativeDetails(seq(250), 2, { cache })
  assert.equal(map.size, 250)
  assert.ok(maxSimultaneas <= 2, `cap=2 deveria limitar a 2, teve ${maxSimultaneas}`)
  assert.ok(maxSimultaneas >= 2, `deveria usar o teto, teve ${maxSimultaneas}`)
})

// ---- Fase 2: cache por ad_id ----

test('reaproveita o cache: 2a chamada com os mesmos ids NAO re-busca', async () => {
  await getAdsCreativeDetails(seq(120), 6, { cache })
  const chamadasApos1 = chamadas.length
  const map = await getAdsCreativeDetails(seq(120), 6, { cache })
  assert.equal(chamadas.length, chamadasApos1, 'nao deveria ter feito nova chamada')
  assert.equal(map.size, 120, 'mesmo vindo do cache, devolve todos')
})

test('busca SO os ids que faltam (cache parcial)', async () => {
  await getAdsCreativeDetails(seq(50), 6, { cache })        // a0..a49 -> 1 lote
  const chamadasApos1 = chamadas.length
  const map = await getAdsCreativeDetails(seq(100), 6, { cache }) // a0..a99: a50..a99 faltam
  assert.equal(chamadas.length - chamadasApos1, 1, 'so o lote dos novos (a50..a99)')
  assert.equal(map.size, 100)
})

test('bust=true ignora o cache e re-busca tudo (botao Atualizar)', async () => {
  await getAdsCreativeDetails(seq(60), 6, { cache })
  const chamadasApos1 = chamadas.length
  const map = await getAdsCreativeDetails(seq(60), 6, { cache, bust: true })
  assert.ok(chamadas.length > chamadasApos1, 'com bust deveria re-buscar')
  assert.equal(map.size, 60)
})

test('cache expira pelo TTL', async () => {
  let agoraVal = 0
  const opts = { cache, agora: () => agoraVal, ttl: 1000 }
  await getAdsCreativeDetails(seq(50), 6, opts)
  const chamadasApos1 = chamadas.length
  agoraVal = 2000 // passou do TTL
  const map = await getAdsCreativeDetails(seq(50), 6, opts)
  assert.ok(chamadas.length > chamadasApos1, 'passado o TTL, re-busca')
  assert.equal(map.size, 50)
})
