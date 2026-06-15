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
  timeRange: string,
  token: string,
  nameFilter?: string,
): Promise<RawCampaign[]> {
  const filteringParam = nameFilter
    ? `&filtering=${encodeURIComponent(JSON.stringify([{ field: 'name', operator: 'CONTAIN', value: nameFilter }]))}`
    : ''

  let nextUrl: string | null =
    `${BASE_URL}/act_${accountId}/campaigns` +
    `?fields=name,insights{spend}` +
    `&time_range=${timeRange}` +
    `&limit=500` +
    filteringParam +
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
  nomenclaturas?: string[],
): Promise<{ name: string; spend: number }[]> {
  const token = getToken()
  if (!token) return []

  const timeRange = encodeURIComponent(JSON.stringify({ since: dateStart, until: dateEnd }))

  let rawCampaigns: RawCampaign[]

  if (nomenclaturas && nomenclaturas.length > 0) {
    // Uma chamada por nomenclatura em paralelo; CONTAIN não suporta OR na mesma chamada
    const perNom = await Promise.all(
      nomenclaturas.map(n => fetchAccountPages(accountId, timeRange, token, n))
    )
    const seen = new Set<string>()
    rawCampaigns = perNom.flat().filter(c => {
      if (seen.has(c.name)) return false
      seen.add(c.name)
      return true
    })
  } else {
    rawCampaigns = await fetchAccountPages(accountId, timeRange, token)
  }

  return rawCampaigns.map(c => ({
    name: c.name,
    spend: parseFloat(c.insights?.data?.[0]?.spend ?? '0') || 0,
  }))
}

export async function getProjectInvestment(
  nomenclaturas: string[],
  dateStart: string,
  dateEnd: string,
): Promise<{ total: number; campanhas: MetaCampanha[] }> {
  const accountIds = getAccountIds()

  const resultados = await Promise.all(
    accountIds.map(async (accountId) => {
      const campaigns = await getAdAccountCampaigns(accountId, dateStart, dateEnd, nomenclaturas)
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
