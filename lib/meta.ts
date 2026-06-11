const BASE_URL = 'https://graph.facebook.com/v19.0'

export interface MetaCampanha {
  name: string
  spend: number
  accountId: string
}

function getToken(): string | null {
  return process.env.META_ACCESS_TOKEN ?? null
}

function getAccountIds(): string[] {
  const raw = process.env.META_AD_ACCOUNT_IDS ?? ''
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

export async function getAdAccountCampaigns(
  accountId: string,
  dateStart: string,
  dateEnd: string,
): Promise<{ name: string; spend: number }[]> {
  const token = getToken()
  if (!token) return []

  const timeRange = JSON.stringify({ since: dateStart, until: dateEnd })
  const url =
    `${BASE_URL}/act_${accountId}/campaigns` +
    `?fields=name,insights{spend}` +
    `&time_range=${encodeURIComponent(timeRange)}` +
    `&access_token=${token}`

  let res: Response
  try {
    res = await fetch(url, { cache: 'no-store' })
  } catch (err) {
    console.error('[Meta API] Erro de rede na conta:', accountId, err)
    return []
  }

  if (!res.ok) {
    const body = await res.text()
    console.error('[Meta API] Erro HTTP na conta:', accountId, res.status, body.slice(0, 200))
    return []
  }

  const json = await res.json() as {
    data?: Array<{ name: string; insights?: { data?: Array<{ spend: string }> } }>
  }

  return (json.data ?? []).map(c => ({
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
  const allCampanhas: MetaCampanha[] = []

  for (const accountId of accountIds) {
    const campaigns = await getAdAccountCampaigns(accountId, dateStart, dateEnd)
    const filtered = campaigns.filter(c =>
      nomenclaturas.some(n => c.name.toLowerCase().includes(n.toLowerCase()))
    )
    console.log('[Meta API] conta:', accountId, 'campanhas encontradas:', campaigns.length, 'filtradas:', filtered.length)
    for (const c of filtered) {
      allCampanhas.push({ ...c, accountId })
    }
  }

  const total = allCampanhas.reduce((sum, c) => sum + c.spend, 0)
  return { total, campanhas: allCampanhas }
}

export async function getAllAccountsInvestment(
  dateStart: string,
  dateEnd: string,
): Promise<number> {
  const accountIds = getAccountIds()
  let total = 0
  for (const accountId of accountIds) {
    const campaigns = await getAdAccountCampaigns(accountId, dateStart, dateEnd)
    total += campaigns.reduce((sum, c) => sum + c.spend, 0)
  }
  return total
}
