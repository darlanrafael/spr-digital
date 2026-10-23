import { adIdDaVenda } from './atribuicao-criativo'

const cent = (n: number) => Math.round(n * 100) / 100

/** O criativo como a Meta entrega (ja com investido e metricas de topo). */
export type CriativoMeta = {
  adId: string
  criativo: string
  thumbnail: string | null
  investido: number
  isVideo: boolean
  ctr: number | null
  hookRate: number | null
  /** Link pra ver o anúncio (Instagram ou preview da Meta). */
  previewUrl: string
  /** Quantas pessoas assistiram X% do vídeo (Meta). 0 quando não é vídeo. */
  videoP25: number
  videoP50: number
  videoP75: number
  videoP95: number
}

/** O minimo da venda pra atribuir a um criativo. (Ja filtrada pelo funil/periodo/aprovada.) */
export type VendaAtribuivel = {
  utm_content?: string | null
  valor_pago_cliente: number
  /** A venda e do produto PRINCIPAL do funil (nao um agregado/order bump). */
  ehPrincipal?: boolean
}

export type CriativoLinha = {
  adId: string
  criativo: string
  formato: 'Vídeo' | 'Imagem'
  thumbnail: string | null
  investido: number
  /** Vendas do produto PRINCIPAL atribuidas a este anuncio (venda unica). */
  vendasPrincipal: number
  /** Vendas totais (principal + agregados/order bumps) atribuidas a este anuncio. */
  vendas: number
  faturamento: number
  /** ROAS só do produto PRINCIPAL (faturamentoPrincipal / investido). */
  roasPrincipal: number | null
  /** ROAS com agregados = faturamento TOTAL / investido. 0 sem investimento. */
  roas: number | null
  /** CPA do principal = investido / vendasPrincipal. null quando 0 venda do principal. */
  cpaPrincipal: number | null
  /** CPA com agregados = investido / vendas totais. null quando 0 vendas. */
  cpa: number | null
  ctr: number | null
  hookRate: number | null
  previewUrl: string
  videoP25: number
  videoP50: number
  videoP75: number
  videoP95: number
}

export type CriativosDoFunil = {
  /** Um por anuncio da Meta, ordenado por vendas (desc). */
  linhas: CriativoLinha[]
  /**
   * Vendas do funil que NAO cairam em nenhum criativo: sem ad id na UTM
   * (organico/link na bio) ou ad id que nao esta entre os anuncios do funil.
   * Mostrado a parte pra o somatorio dos criativos nao mentir sobre o total.
   */
  naoAtribuido: { vendas: number; faturamento: number }
}

/**
 * Junta os criativos da Meta (investido + metricas) com as vendas REAIS do funil,
 * casando pelo ad id que vem no utm_content da venda. O que nao casa vai pro
 * balde "naoAtribuido" - nunca some em silencio. Ver item 114 do spr-digital.md.
 */
export function montarCriativos(ads: CriativoMeta[], vendas: VendaAtribuivel[]): CriativosDoFunil {
  // agrupa vendas por ad id
  const porAd = new Map<string, { vendas: number; vendasPrincipal: number; faturamento: number; faturamentoPrincipal: number }>()
  const naoAtribuido = { vendas: 0, faturamento: 0 }
  const adsValidos = new Set(ads.map(a => a.adId))
  for (const v of vendas) {
    const id = adIdDaVenda(v.utm_content)
    if (id && adsValidos.has(id)) {
      const e = porAd.get(id) ?? { vendas: 0, vendasPrincipal: 0, faturamento: 0, faturamentoPrincipal: 0 }
      e.vendas++
      e.faturamento = cent(e.faturamento + v.valor_pago_cliente)
      if (v.ehPrincipal) { e.vendasPrincipal++; e.faturamentoPrincipal = cent(e.faturamentoPrincipal + v.valor_pago_cliente) }
      porAd.set(id, e)
    } else {
      naoAtribuido.vendas++
      naoAtribuido.faturamento = cent(naoAtribuido.faturamento + v.valor_pago_cliente)
    }
  }

  const linhas: CriativoLinha[] = ads.map(a => {
    const vd = porAd.get(a.adId) ?? { vendas: 0, vendasPrincipal: 0, faturamento: 0, faturamentoPrincipal: 0 }
    return {
      adId: a.adId,
      criativo: a.criativo,
      formato: (a.isVideo ? 'Vídeo' : 'Imagem') as 'Vídeo' | 'Imagem',
      thumbnail: a.thumbnail,
      investido: a.investido,
      vendasPrincipal: vd.vendasPrincipal,
      vendas: vd.vendas,
      faturamento: vd.faturamento,
      roasPrincipal: a.investido > 0 ? cent(vd.faturamentoPrincipal / a.investido) : 0,
      roas: a.investido > 0 ? cent(vd.faturamento / a.investido) : 0,
      cpaPrincipal: vd.vendasPrincipal > 0 ? cent(a.investido / vd.vendasPrincipal) : null,
      cpa: vd.vendas > 0 ? cent(a.investido / vd.vendas) : null,
      ctr: a.ctr,
      hookRate: a.hookRate,
      previewUrl: a.previewUrl,
      videoP25: a.videoP25,
      videoP50: a.videoP50,
      videoP75: a.videoP75,
      videoP95: a.videoP95,
    }
  }).sort((x, y) => y.vendas - x.vendas)

  return { linhas, naoAtribuido }
}
