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
