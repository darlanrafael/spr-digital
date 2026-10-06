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

function getAccountIds(): string[] {
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

// Pagina act_<id>/ads por paging.next; erro numa conta nunca propaga (devolve o que tem).
async function fetchAdsPages(
  accountId: string,
  fields: string,
  token: string,
): Promise<Record<string, unknown>[]> {
  let nextUrl: string | null =
    `${BASE_URL}/act_${accountId}/ads` +
    `?fields=${fields}` +
    `&limit=500` +
    `&access_token=${token}`

  const all: Record<string, unknown>[] = []

  while (nextUrl) {
    let res: Response
    try {
      res = await fetch(nextUrl)
    } catch (err) {
      console.error('[Meta API] Erro de rede na conta (ads):', accountId, err)
      break
    }

    if (!res.ok) {
      const body = await res.text()
      console.error('[Meta API] Erro HTTP na conta (ads):', accountId, res.status, body.slice(0, 300))
      break
    }

    const json = await res.json() as {
      data?: Record<string, unknown>[]
      paging?: { next?: string }
      error?: { message: string }
    }

    if (json.error) {
      console.error('[Meta API] Erro na conta (ads):', accountId, json.error.message)
      break
    }

    const page = json.data ?? []
    all.push(...page)
    console.log(`[Meta API] conta ${accountId}: página com ${page.length} ads (total acumulado: ${all.length})`)

    nextUrl = json.paging?.next ?? null
  }

  return all
}

export async function getAdsComInsights(
  accountId: string,
  dateStart: string,
  dateEnd: string,
  datePreset?: string,
): Promise<Record<string, unknown>[]> {
  const token = getToken()
  if (!token) return []

  const mod = insightsModifier(buildDateParam(dateStart, dateEnd, datePreset))
  const fields =
    `name,campaign{name},creative{name,thumbnail_url},` +
    `insights.${mod}{spend,impressions,reach,inline_link_clicks,unique_clicks,actions,video_play_actions}`

  return fetchAdsPages(accountId, fields, token)
}

export async function getAdsDiariosComInsights(
  accountId: string,
  dateStart: string,
  dateEnd: string,
  datePreset?: string,
): Promise<{ campaign_name: string; date_start: string; spend: string; inline_link_clicks: string }[]> {
  const token = getToken()
  if (!token) return []

  const mod = insightsModifier(buildDateParam(dateStart, dateEnd, datePreset))
  const fields = `campaign{name},insights.${mod}.time_increment(1){spend,inline_link_clicks}`

  const ads = await fetchAdsPages(accountId, fields, token)

  const linhas: { campaign_name: string; date_start: string; spend: string; inline_link_clicks: string }[] = []
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
