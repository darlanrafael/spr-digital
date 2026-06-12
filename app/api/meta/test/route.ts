import { NextRequest, NextResponse } from 'next/server'

const NOMENCLATURAS = ['[F01-IRM]', '[PF01_RC]']

export async function GET(req: NextRequest) {
  const token = process.env.META_ACCESS_TOKEN ?? null
  const accountId = '839071654129606'

  if (!token) {
    return NextResponse.json({ tokenExiste: false, erro: 'META_ACCESS_TOKEN não configurado' })
  }

  // Autenticação simples: query param ?secret= deve bater com os últimos 12 chars do token
  const secret = new URL(req.url).searchParams.get('secret')
  if (secret !== token.slice(-12)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const hoje = new Date()
  const dateEnd = hoje.toISOString().split('T')[0]
  const dateStart = new Date(new Date().setDate(hoje.getDate() - 30)).toISOString().split('T')[0]
  const timeRange = encodeURIComponent(JSON.stringify({ since: dateStart, until: dateEnd }))

  const url =
    `https://graph.facebook.com/v19.0/act_${accountId}/campaigns` +
    `?fields=name,insights{spend}` +
    `&time_range=${timeRange}` +
    `&limit=100` +
    `&access_token=${token}`

  let apiResponse: unknown
  let apiError: string | null = null
  let allCampaigns: Array<{ name: string; insights?: { data?: Array<{ spend: string }>}; }> = []
  let nextUrl: string | null = url

  try {
    while (nextUrl) {
      const res = await fetch(nextUrl, { cache: 'no-store' })
      const page = await res.json() as {
        data?: typeof allCampaigns
        paging?: { next?: string }
        error?: { message: string }
      }
      if (!apiResponse) apiResponse = page
      if (page.error) { apiError = page.error.message; break }
      allCampaigns = allCampaigns.concat(page.data ?? [])
      nextUrl = page.paging?.next ?? null
    }
  } catch (err) {
    apiError = err instanceof Error ? err.message : String(err)
  }

  const campanhas = allCampaigns
  const filtradas = campanhas
    .map(c => ({
      name: c.name,
      spend: parseFloat(c.insights?.data?.[0]?.spend ?? '0') || 0,
    }))
    .filter(c => NOMENCLATURAS.some(n => c.name.toLowerCase().includes(n.toLowerCase())))

  const totalFiltrado = filtradas.reduce((sum, c) => sum + c.spend, 0)

  return NextResponse.json({
    tokenExiste: true,
    accountId,
    periodo: { dateStart, dateEnd },
    campanhasEncontradas: campanhas.length,
    campanhasFiltradas: filtradas.length,
    nomenclaturasUsadas: NOMENCLATURAS,
    totalInvestido: totalFiltrado,
    totalFormatado: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(totalFiltrado),
    campanhasDetalhe: filtradas,
    todasAsCampanhas: campanhas.map(c => ({
      name: c.name,
      spend: parseFloat(c.insights?.data?.[0]?.spend ?? '0') || 0,
    })),
    erroDeRede: apiError,
  })
}
