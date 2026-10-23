const BASE_URL = 'https://graph.facebook.com/v19.0'

export interface MetaCampanha {
  name: string
  spend: number
  accountId: string
}

type RawCampaign = { name: string; insights?: { data?: Array<{ spend: string }> } }

function getToken(): string | null {
  return process.env.META_ACCESS_TOKEN ?? null
}

const FALLBACK_ACCOUNT_IDS = '839071654129606,634349981641861,648308663489123,414167410861240,1400409620438158'

export function getAccountIds(): string[] {
  const raw = process.env.META_AD_ACCOUNT_IDS ?? FALLBACK_ACCOUNT_IDS
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

async function fetchAccountPages(
  accountId: string,
  dateParam: string,  // "date_preset=today" ou "time_range=<encoded-json>"
  token: string,
): Promise<RawCampaign[]> {
  // A Meta API ignora time_range e date_preset como params separados para insights inline.
  // A forma correta é aplicar o modificador diretamente no campo: insights.date_preset(x){spend}
  // ou insights.time_range({"since":"...","until":"..."}){spend}
  let fields: string
  if (dateParam.startsWith('date_preset=')) {
    const preset = dateParam.slice('date_preset='.length)
    fields = `name,insights.date_preset(${preset}){spend}`
  } else {
    // "time_range=<encoded-json>" → decodifica e aplica inline
    const rangeJson = decodeURIComponent(dateParam.slice('time_range='.length))
    fields = `name,insights.time_range(${rangeJson}){spend}`
  }

  // No name filter sent to the API — CONTAIN can silently drop campaigns when
  // there are hundreds of results. Fetch everything and filter locally instead.
  let nextUrl: string | null =
    `${BASE_URL}/act_${accountId}/campaigns` +
    `?fields=${fields}` +
    `&limit=500` +
    `&access_token=${token}`

  const allCampaigns: RawCampaign[] = []

  while (nextUrl) {
    let res: Response
    try {
      res = await fetch(nextUrl)
    } catch (err) {
      console.error('[Meta API] Erro de rede na conta:', accountId, err)
      break
    }

    if (!res.ok) {
      const body = await res.text()
      console.error('[Meta API] Erro HTTP na conta:', accountId, res.status, body.slice(0, 300))
      break
    }

    const json = await res.json() as {
      data?: RawCampaign[]
      paging?: { next?: string }
      error?: { message: string }
    }

    if (json.error) {
      console.error('[Meta API] Erro na conta:', accountId, json.error.message)
      break
    }

    const page = json.data ?? []
    allCampaigns.push(...page)
    console.log(`[Meta API] conta ${accountId}: página com ${page.length} campanhas (total acumulado: ${allCampaigns.length})`)

    nextUrl = json.paging?.next ?? null
  }

  return allCampaigns
}

export async function getAdAccountCampaigns(
  accountId: string,
  dateStart: string,
  dateEnd: string,
  _nomenclaturas?: string[],
  datePreset?: string,
): Promise<{ name: string; spend: number }[]> {
  const token = getToken()
  if (!token) return []

  const dateParam = datePreset
    ? `date_preset=${datePreset}`
    : `time_range=${encodeURIComponent(JSON.stringify({ since: dateStart, until: dateEnd }))}`

  // Always fetch all campaigns without API-side name filter — filter locally in getProjectInvestment
  const rawCampaigns = await fetchAccountPages(accountId, dateParam, token)

  return rawCampaigns.map(c => ({
    name: c.name,
    spend: parseFloat(c.insights?.data?.[0]?.spend ?? '0') || 0,
  }))
}

export async function getProjectInvestment(
  nomenclaturas: string[],
  dateStart: string,
  dateEnd: string,
  datePreset?: string,
): Promise<{ total: number; campanhas: MetaCampanha[] }> {
  const accountIds = getAccountIds()

  const resultados = await Promise.all(
    accountIds.map(async (accountId) => {
      const campaigns = await getAdAccountCampaigns(accountId, dateStart, dateEnd, nomenclaturas, datePreset)
      const filtered = campaigns.filter(c =>
        nomenclaturas.some(n => c.name.toLowerCase().includes(n.toLowerCase()))
      )
      console.log('[Meta API] conta:', accountId, 'campanhas encontradas:', campaigns.length, 'filtradas:', filtered.length)
      return filtered.map(c => ({ ...c, accountId }))
    })
  )

  const allCampanhas: MetaCampanha[] = resultados.flat()
  const total = allCampanhas.reduce((sum, c) => sum + c.spend, 0)
  return { total, campanhas: allCampanhas }
}

export async function getAllAccountsInvestment(
  dateStart: string,
  dateEnd: string,
): Promise<number> {
  const accountIds = getAccountIds()
  const totals = await Promise.all(
    accountIds.map(async (accountId) => {
      const campaigns = await getAdAccountCampaigns(accountId, dateStart, dateEnd)
      return campaigns.reduce((sum, c) => sum + c.spend, 0)
    })
  )
  return totals.reduce((sum, t) => sum + t, 0)
}

// ---------------------------------------------------------------------------
// Fase 2B: anúncios (ads) com insights - funil + criativos + cadência diária
// ---------------------------------------------------------------------------

function buildDateParam(dateStart: string, dateEnd: string, datePreset?: string): string {
  return datePreset
    ? `date_preset=${datePreset}`
    : `time_range=${encodeURIComponent(JSON.stringify({ since: dateStart, until: dateEnd }))}`
}

// Converte "date_preset=x" / "time_range=<json>" no modificador inline do campo insights.
function insightsModifier(dateParam: string): string {
  if (dateParam.startsWith('date_preset=')) {
    return `date_preset(${dateParam.slice('date_preset='.length)})`
  }
  return `time_range(${decodeURIComponent(dateParam.slice('time_range='.length))})`
}

type AdsRow = Record<string, unknown>

// Pagina um endpoint de conta (ads ou campaigns) por paging.next; erro numa conta nunca propaga.
async function fetchPaginas(
  accountId: string,
  edge: 'ads' | 'campaigns',
  fields: string,
  token: string,
  limit: number,
  filtering?: string,
): Promise<AdsRow[]> {
  let nextUrl: string | null =
    `${BASE_URL}/act_${accountId}/${edge}` +
    `?fields=${fields}` +
    `&limit=${limit}` +
    (filtering ? `&filtering=${encodeURIComponent(filtering)}` : '') +
    `&access_token=${token}`

  const all: AdsRow[] = []

  while (nextUrl) {
    let res: Response
    try {
      res = await fetch(nextUrl)
    } catch (err) {
      console.error(`[Meta API] Erro de rede na conta (${edge}):`, accountId, err)
      break
    }

    if (!res.ok) {
      const body = await res.text()
      console.error(`[Meta API] Erro HTTP na conta (${edge}):`, accountId, res.status, body.slice(0, 300))
      break
    }

    const json = await res.json() as {
      data?: AdsRow[]
      paging?: { next?: string }
      error?: { message: string }
    }

    if (json.error) {
      console.error(`[Meta API] Erro na conta (${edge}):`, accountId, json.error.message)
      break
    }

    const page = json.data ?? []
    all.push(...page)
    console.log(`[Meta API] conta ${accountId}: página com ${page.length} ${edge} (total acumulado: ${all.length})`)

    nextUrl = json.paging?.next ?? null
  }

  return all
}

// Um fetch por termo (filtering campaign.name CONTAIN), junta e deduplica por id.
async function fetchAdsPorTermos(
  accountId: string,
  fields: string,
  termos: string[],
  token: string,
): Promise<AdsRow[]> {
  const ts = (termos ?? []).map(t => t.trim()).filter(Boolean)
  if (ts.length === 0) return []

  const porTermo = await Promise.all(ts.map(termo =>
    fetchPaginas(
      accountId, 'ads', fields, token, 200,
      JSON.stringify([{ field: 'campaign.name', operator: 'CONTAIN', value: termo }]),
    )
  ))

  const vistos = new Set<string>()
  const out: AdsRow[] = []
  for (const row of porTermo.flat()) {
    const id = row.id as string | undefined
    if (id) {
      if (vistos.has(id)) continue
      vistos.add(id)
    }
    out.push(row)
  }
  return out
}

const INSIGHT_FIELDS = 'spend,impressions,reach,inline_link_clicks,unique_clicks,actions,video_play_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p95_watched_actions'

// Endpoint /insights (nivel campanha/ad): devolve SO o que teve entrega no
// periodo, agregado pela Meta - muito mais rapido que listar todas as campanhas.
// Linhas "chatas": campaign_name/ad_name + metricas no topo (sem creative/thumb).
async function fetchInsights(
  accountId: string,
  level: 'campaign' | 'ad',
  fields: string,
  dateParam: string,
  token: string,
  filtering?: string,
): Promise<AdsRow[]> {
  let nextUrl: string | null =
    `${BASE_URL}/act_${accountId}/insights?level=${level}&fields=${fields}&${dateParam}&limit=500` +
    (filtering ? `&filtering=${encodeURIComponent(filtering)}` : '') +
    `&access_token=${token}`
  const all: AdsRow[] = []
  while (nextUrl) {
    let res: Response
    try { res = await fetch(nextUrl) } catch (err) {
      console.error('[Meta API] Erro de rede (insights):', accountId, err); break
    }
    try {
      if (!res.ok) { console.error('[Meta API] Erro HTTP (insights):', accountId, res.status, (await res.text()).slice(0, 300)); break }
      const json = await res.json() as { data?: AdsRow[]; paging?: { next?: string }; error?: { message: string } }
      if (json.error) { console.error('[Meta API] Erro (insights):', accountId, json.error.message); break }
      all.push(...(json.data ?? []))
      nextUrl = json.paging?.next ?? null
    } catch (err) { console.error('[Meta API] parse (insights):', accountId, err); break } // fail-open no parse (item 121)
  }
  return all
}

// Totais do funil / visão geral, RÁPIDO: insights nivel campanha (so campanhas
// com entrega no periodo). Devolve a linha "chata" pro normalizarInsight.
export async function getCampanhaInsights(
  accountId: string,
  dateStart: string,
  dateEnd: string,
  datePreset?: string,
): Promise<Record<string, unknown>[]> {
  const token = getToken()
  if (!token) return []
  const dateParam = buildDateParam(dateStart, dateEnd, datePreset)
  return fetchInsights(accountId, 'campaign', `campaign_name,${INSIGHT_FIELDS}`, dateParam, token)
}

// RÁPIDO: anúncios que TIVERAM ENTREGA no período (insights nível ad), filtrados
// por termo de campanha. Um fetch por termo, dedup por ad_id. Linha "chata"
// (ad_id/ad_name/campaign_name + métricas no topo), SEM creative/thumb - isso vem
// depois, em lote, só pros ads entregues. Alimenta a visão "somente ativos" dos
// criativos sem puxar os anúncios parados (que fazem a Imersão ter 300+ ads).
export async function getAdInsightsPorTermos(
  accountId: string, dateStart: string, dateEnd: string, termos: string[], datePreset?: string,
): Promise<Record<string, unknown>[]> {
  const token = getToken(); if (!token) return []
  const ts = (termos ?? []).map(t => t.trim()).filter(Boolean); if (ts.length === 0) return []
  const dateParam = buildDateParam(dateStart, dateEnd, datePreset)
  const fields = `ad_id,ad_name,campaign_name,${INSIGHT_FIELDS}`
  const porTermo = await Promise.all(ts.map(termo =>
    fetchInsights(accountId, 'ad', fields, dateParam, token, JSON.stringify([{ field: 'campaign.name', operator: 'CONTAIN', value: termo }])),
  ))
  const vistos = new Set<string>(); const out: Record<string, unknown>[] = []
  for (const row of porTermo.flat()) {
    const id = row.ad_id as string | undefined
    if (id) { if (vistos.has(id)) continue; vistos.add(id) }
    out.push(row)
  }
  return out
}

// Detalhes de criativo (nome, thumb, tipo, preview) de ADs específicos, em lote
// (até 50 por request). Usado só pros ads que tiveram entrega, então é leve.
type CacheCriativo = Map<string, { t: number; detail: Record<string, unknown> }>
// Cache por ad_id (Fase 2, item 119): trocar de periodo nao re-busca anuncio ja
// buscado. Modulo-level (persiste entre requests na mesma instancia); nos testes
// e injetado um Map novo por teste pra isolar.
const cacheCriativosModulo: CacheCriativo = new Map()
const TTL_CRIATIVO = 300_000 // 5 min: janela em que o detalhe (inclusive status) e reusado

type OpcoesCriativo = {
  /** Ignora o cache e re-busca tudo (botao Atualizar / ?nocache=1). */
  bust?: boolean
  /** Cache a usar (default: o do modulo). Injetado nos testes. */
  cache?: CacheCriativo
  /** Relogio (default Date.now). Injetado nos testes de TTL. */
  agora?: () => number
  /** Validade do cache em ms (default 5 min). */
  ttl?: number
}

export async function getAdsCreativeDetails(
  ids: string[],
  limiteConcorrencia = 6,
  opts: OpcoesCriativo = {},
): Promise<Map<string, Record<string, unknown>>> {
  const token = getToken(); const map = new Map<string, Record<string, unknown>>()
  if (!token || ids.length === 0) return map
  const cache = opts.cache ?? cacheCriativosModulo
  const agora = opts.agora ?? Date.now
  const ttl = opts.ttl ?? TTL_CRIATIVO
  const bust = opts.bust ?? false
  const fields = `id,name,effective_status,campaign{name},preview_shareable_link,creative{name,thumbnail_url,object_type,video_id,instagram_permalink_url}`

  // CACHE: ids com detalhe fresco saem do cache; so os que faltam vao na Meta.
  const faltam: string[] = []
  for (const id of ids) {
    const hit = bust ? undefined : cache.get(id)
    if (hit && agora() - hit.t < ttl) map.set(id, hit.detail)
    else faltam.push(id)
  }
  if (faltam.length === 0) return map

  // Divide os que faltam em lotes de 50 (teto da Meta por chamada).
  const lotes: string[][] = []
  for (let i = 0; i < faltam.length; i += 50) lotes.push(faltam.slice(i, i + 50))

  // Cada lote tem seu try/catch e NAO rejeita (fail-open): um lote que falha
  // (rede/HTTP) nao derruba os outros - grava o que deu e segue. Ver item 119.
  const buscarLote = async (lote: string[]): Promise<void> => {
    const url = `${BASE_URL}/?ids=${lote.join(',')}&fields=${fields}&access_token=${token}`
    let res: Response
    try { res = await fetch(url) } catch (err) { console.error('[Meta API] rede (creative details):', err); return }
    // fail-open tambem no PARSE: corpo nao-JSON (pagina de erro HTML, body truncado)
    // nao pode derrubar os outros lotes/contas. Ver item 121 do spr-digital.md.
    try {
      if (!res.ok) { console.error('[Meta API] HTTP (creative details):', res.status, (await res.text()).slice(0, 200)); return }
      const json = await res.json() as Record<string, unknown>
      for (const id of Object.keys(json)) {
        if (id === 'error') continue
        const detail = json[id] as Record<string, unknown>
        map.set(id, detail)
        cache.set(id, { t: agora(), detail })
      }
    } catch (err) { console.error('[Meta API] parse (creative details):', err); return }
  }

  // Lotes em PARALELO (antes era em serie), em ondas de ate `limiteConcorrencia`
  // pra nao disparar chamadas demais de uma vez se houver muitos anuncios.
  for (let i = 0; i < lotes.length; i += limiteConcorrencia) {
    await Promise.all(lotes.slice(i, i + limiteConcorrencia).map(buscarLote))
  }
  return map
}

// Tráfego DIÁRIO por campanha (nível campanha + time_increment=1). Muito mais
// barato que a cadência por-anúncio: poucas campanhas × dias, em vez de todos os
// ads. Usado pelo gráfico de resultado líquido diário.
export async function getCampanhaInsightsDiario(
  accountId: string,
  dateStart: string,
  dateEnd: string,
  datePreset?: string,
): Promise<{ campaign_name: string; date_start: string; spend: string; inline_link_clicks: string }[]> {
  const token = getToken()
  if (!token) return []
  const dateParam = buildDateParam(dateStart, dateEnd, datePreset)
  let nextUrl: string | null =
    `${BASE_URL}/act_${accountId}/insights?level=campaign&fields=campaign_name,spend,inline_link_clicks&${dateParam}&time_increment=1&limit=500&access_token=${token}`
  const all: { campaign_name: string; date_start: string; spend: string; inline_link_clicks: string }[] = []
  while (nextUrl) {
    let res: Response
    try { res = await fetch(nextUrl) } catch (err) { console.error('[Meta API] rede (camp diário):', accountId, err); break }
    try {
      if (!res.ok) { console.error('[Meta API] HTTP (camp diário):', accountId, res.status, (await res.text()).slice(0, 200)); break }
      const json = await res.json() as { data?: typeof all; paging?: { next?: string }; error?: { message: string } }
      if (json.error) { console.error('[Meta API] erro (camp diário):', accountId, json.error.message); break }
      all.push(...(json.data ?? []))
      nextUrl = json.paging?.next ?? null
    } catch (err) { console.error('[Meta API] parse (camp diário):', accountId, err); break } // fail-open no parse (item 121)
  }
  return all
}

// Totais do funil / visão geral: campanhas (poucas) em vez de todos os ads.
export async function getCampanhasComInsights(
  accountId: string,
  dateStart: string,
  dateEnd: string,
  datePreset?: string,
): Promise<Record<string, unknown>[]> {
  const token = getToken()
  if (!token) return []
  const mod = insightsModifier(buildDateParam(dateStart, dateEnd, datePreset))
  return fetchPaginas(accountId, 'campaigns', `name,insights.${mod}{${INSIGHT_FIELDS}}`, token, 500)
}

// Visão geral/detalhe: só as campanhas cujo nome contém algum termo (filtro no servidor da Meta).
export async function getCampanhasPorTermos(
  accountId: string,
  dateStart: string,
  dateEnd: string,
  termos: string[],
  datePreset?: string,
): Promise<Record<string, unknown>[]> {
  const token = getToken()
  if (!token) return []
  const ts = (termos ?? []).map(t => t.trim()).filter(Boolean)
  if (ts.length === 0) return []
  const mod = insightsModifier(buildDateParam(dateStart, dateEnd, datePreset))
  const fields = `id,name,insights.${mod}{${INSIGHT_FIELDS}}`

  const porTermo = await Promise.all(ts.map(termo =>
    fetchPaginas(
      accountId, 'campaigns', fields, token, 500,
      JSON.stringify([{ field: 'name', operator: 'CONTAIN', value: termo }]),
    )
  ))

  const vistos = new Set<string>()
  const out: AdsRow[] = []
  for (const row of porTermo.flat()) {
    const id = row.id as string | undefined
    if (id) {
      if (vistos.has(id)) continue
      vistos.add(id)
    }
    out.push(row)
  }
  return out
}

// Criativos do detalhe de um funil: ads filtrados por campanha no servidor da Meta.
export async function getAdsComInsights(
  accountId: string,
  dateStart: string,
  dateEnd: string,
  termos: string[],
  datePreset?: string,
): Promise<Record<string, unknown>[]> {
  const token = getToken()
  if (!token) return []
  const mod = insightsModifier(buildDateParam(dateStart, dateEnd, datePreset))
  const fields =
    `id,name,campaign{name},preview_shareable_link,creative{name,thumbnail_url,object_type,video_id,instagram_permalink_url},insights.${mod}{${INSIGHT_FIELDS}}`
  return fetchAdsPorTermos(accountId, fields, termos, token)
}

type LinhaDiaria = { campaign_name: string; date_start: string; spend: string; inline_link_clicks: string }

// Cadência do detalhe (escopo de 1 funil): um registro por dia por ad.
export async function getAdsDiariosComInsights(
  accountId: string,
  dateStart: string,
  dateEnd: string,
  termos: string[],
  datePreset?: string,
): Promise<LinhaDiaria[]> {
  const token = getToken()
  if (!token) return []
  const mod = insightsModifier(buildDateParam(dateStart, dateEnd, datePreset))
  const fields = `id,campaign{name},insights.${mod}.time_increment(1).limit(400){spend,inline_link_clicks}`
  const ads = await fetchAdsPorTermos(accountId, fields, termos, token)

  const linhas: LinhaDiaria[] = []
  for (const ad of ads) {
    const campaignName = ((ad.campaign as { name?: string } | undefined)?.name) ?? ''
    const dias = ((ad.insights as { data?: Array<Record<string, string>> } | undefined)?.data) ?? []
    for (const d of dias) {
      linhas.push({
        campaign_name: campaignName,
        date_start: d.date_start,
        spend: d.spend ?? '0',
        inline_link_clicks: d.inline_link_clicks ?? '0',
      })
    }
  }
  return linhas
}
