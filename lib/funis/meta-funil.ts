export type AdInsight = {
  campanha: string; criativo: string; thumbnail: string | null
  spend: number; impressions: number; reach: number
  inlineLinkClicks: number; uniqueClicks: number
  landingPageView: number; initiateCheckout: number
  videoView: number; isVideo: boolean
}

function num(v: unknown): number { const n = parseFloat(String(v ?? '')); return Number.isFinite(n) ? n : 0 }

function acao(actions: unknown, tipo: string): number {
  const arr = (actions as { action_type?: string; value?: unknown }[]) ?? []
  return num(arr.find(a => a.action_type === tipo)?.value)
}

export function normalizarAd(raw: Record<string, unknown>): AdInsight {
  const ins = ((raw.insights as { data?: Record<string, unknown>[] })?.data?.[0]) ?? {}
  const campaign = raw.campaign as { name?: string } | undefined
  const creative = raw.creative as { name?: string; thumbnail_url?: string } | undefined
  const videoView = acao(ins.actions, 'video_view')
  return {
    campanha: campaign?.name ?? '',
    criativo: creative?.name ?? (raw.name as string) ?? '',
    thumbnail: creative?.thumbnail_url ?? null,
    spend: num(ins.spend),
    impressions: num(ins.impressions),
    reach: num(ins.reach),
    inlineLinkClicks: num(ins.inline_link_clicks),
    uniqueClicks: num(ins.unique_clicks),
    landingPageView: acao(ins.actions, 'landing_page_view'),
    initiateCheckout: acao(ins.actions, 'initiate_checkout'),
    videoView,
    isVideo: videoView > 0,
  }
}

export function adsDoFunil(ads: AdInsight[], termos: string[]): AdInsight[] {
  const ts = (termos ?? []).map(t => t.trim().toLowerCase()).filter(Boolean)
  if (ts.length === 0) return []
  return ads.filter(a => { const c = a.campanha.toLowerCase(); return ts.some(t => c.includes(t)) })
}

function pct(num: number, den: number): number | null {
  if (!den) return null
  return Math.round((num / den * 100) * 100) / 100
}

function razao(num: number, den: number): number | null {
  if (!den) return null
  return Math.round((num / den) * 100) / 100
}

export type FunilAgregado = {
  investido: number; impressoes: number; cliques: number; visitas: number; checkouts: number
  ctr: number | null; hookRate: number | null; custoPorCheckout: number | null; alcanceAprox: number
}

export function agregarFunil(ads: AdInsight[]): FunilAgregado {
  const soma = (f: (a: AdInsight) => number) => ads.reduce((s, a) => s + f(a), 0)
  const investido = soma(a => a.spend)
  const impressoes = soma(a => a.impressions)
  const alcanceAprox = soma(a => a.reach)
  const uniq = soma(a => a.uniqueClicks)
  const checkouts = soma(a => a.initiateCheckout)
  const video = ads.filter(a => a.isVideo)
  const videoViews = video.reduce((s, a) => s + a.videoView, 0)
  const impressoesVideo = video.reduce((s, a) => s + a.impressions, 0)
  return {
    investido, impressoes, alcanceAprox,
    cliques: soma(a => a.inlineLinkClicks),
    visitas: soma(a => a.landingPageView),
    checkouts,
    ctr: pct(uniq, alcanceAprox),
    hookRate: pct(videoViews, impressoesVideo),
    custoPorCheckout: razao(investido, checkouts),
  }
}

export type CriativoMetricas = AdInsight & { ctr: number | null; hookRate: number | null }

export function metricasDoCriativo(ad: AdInsight): CriativoMetricas {
  return { ...ad, ctr: pct(ad.uniqueClicks, ad.reach), hookRate: ad.isVideo ? pct(ad.videoView, ad.impressions) : null }
}

export type PontoDia = { data: string; investido: number; cliques: number }

export function serieDiaria(linhas: { date_start: string; spend: unknown; inline_link_clicks: unknown }[]): PontoDia[] {
  const porDia = new Map<string, PontoDia>()
  for (const l of linhas ?? []) {
    const p = porDia.get(l.date_start) ?? { data: l.date_start, investido: 0, cliques: 0 }
    p.investido += num(l.spend)
    p.cliques += num(l.inline_link_clicks)
    porDia.set(l.date_start, p)
  }
  return [...porDia.values()].sort((a, b) => a.data.localeCompare(b.data))
}
