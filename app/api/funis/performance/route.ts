import { NextRequest, NextResponse } from 'next/server'
import { lerIdentidade, podeVerFunis } from '@/lib/identidade-da-chamada'
// Janela [de, ate] do preset (hoje/ontem/7/30 dias) em dia de Brasilia; a mesma vai pra Meta e pras vendas.
import { janelaDoPeriodo } from '@/lib/funis/janela-do-periodo'
import {
  getAccountIds, getCampanhaInsights, getCampanhaInsightsDiario,
  getAdInsightsPorTermos, getAdsCreativeDetails,
} from '@/lib/meta'
import {
  normalizarAd, normalizarInsight, adsDoFunil, agregarFunil, metricasDoCriativo, type AdInsight,
} from '@/lib/funis/meta-funil'
import { FUNIS, funilDaVenda, ehProdutoPrincipal, DATA_CORTE_FUNIS } from '@/lib/funis/funis-config'
import { aplicarCorte } from '@/lib/funis/corte-funil'
import { agregarEsteira } from '@/lib/funis/esteira-do-funil'
import { agregarVendasDoFunil } from '@/lib/funis/vendas-do-funil'
import { resultadoDoFunil } from '@/lib/funis/resultado-do-funil'
import { montarCriativos, type CriativoMeta } from '@/lib/funis/criativos-do-funil'
import { resultadoDiario, reembolsoDiario } from '@/lib/funis/cadencia-do-funil'
import { criarCacheCurto } from '@/lib/funis/cache-curto'
import { getSalesParaFunil, getReembolsosParaFunil } from '@/lib/services'
import type { Sale } from '@/types'

export const dynamic = 'force-dynamic'

// Cache curto em memória: a Meta é lenta (5 contas), então guardamos o resultado
// por período por 2 min. Navegar entre funis/períodos repetidos fica instantâneo.
// O botão "Atualizar" da tela manda ?nocache=1 e a busca ignora o cache, trazendo
// o dado daquele momento (ver item 118 do spr-digital.md).
const cacheCurto = criarCacheCurto(120_000)

export async function GET(req: NextRequest) {
  const quem = lerIdentidade(req)
  if (!quem) return NextResponse.json({ error: 'Você precisa entrar no sistema.' }, { status: 401 })
  if (!podeVerFunis(quem)) return NextResponse.json({ error: 'Só administradores e sócios do DRE podem ver os funis.' }, { status: 403 })

  try {
    const sp = req.nextUrl.searchParams
    const janelaBruta = janelaDoPeriodo(sp.get('datePreset') ?? '', sp.get('dateStart') ?? '', sp.get('dateEnd') ?? '')
    // TRAVA de data (item 120): contabiliza so a partir de DATA_CORTE_FUNIS. O inicio
    // e clampado no corte; periodo todo antes do corte -> semMeta (pula a Meta; as
    // vendas ja vem vazias porque de > ate).
    const { de: dateStart, ate: dateEnd, semMeta } = aplicarCorte(janelaBruta.de, janelaBruta.ate, DATA_CORTE_FUNIS)
    const funilId = sp.get('funilId')
    const periodo = `${dateStart}|${dateEnd}`
    // Botão "Atualizar" da tela: pula o cache e busca o dado daquele momento.
    const bust = sp.get('nocache') === '1'

    const metaDisponivel = !!process.env.META_ACCESS_TOKEN
    const aviso = metaDisponivel ? null : 'Os dados da Meta estão indisponíveis no momento. Verifique a conexão/token.'
    const contas = getAccountIds()

    // CRIATIVOS = parte LENTA, numa chamada à parte (?criativos=1). Busca vendas e
    // ads EM PARALELO; não depende de nada do resumo, então sai antes do resto.
    if (funilId && sp.get('criativos') === '1') {
      const funil = FUNIS.find(f => f.id === funilId)
      if (!funil) return NextResponse.json({ error: 'Funil não encontrado' }, { status: 404 })
      // CRIATIVOS: SEMPRE os anúncios que RODARAM no período (insights nível ad,
      // RÁPIDO - só os entregues, não os 300+ que nunca rodaram). O botão só muda
      // o filtro em memória:
      //   "Somente ativos" (padrão) -> só os que tiveram GASTO (>0)
      //   "todos" (?todos=1)        -> inclui os que rodaram sem gastar/pausados
      const todos = sp.get('todos') === '1'
      const adsEntregues = (funil.termosCampanha.length === 0 || semMeta)
        ? Promise.resolve([] as (ReturnType<typeof metricasDoCriativo> & { ativo: boolean })[])
        : cacheCurto.get(`adsEntregues|${funil.id}|${periodo}`, async () => {
          const rows = (await Promise.all(contas.map(a => getAdInsightsPorTermos(a, dateStart, dateEnd, funil.termosCampanha)))).flat()
          const ids = [...new Set(rows.map(r => String(r.ad_id)).filter(Boolean))]
          // bust = botao Atualizar (?nocache=1): fura tambem o cache por anuncio.
          const det = await getAdsCreativeDetails(ids, 6, { bust })
          return rows.map(row => {
            const d = det.get(String(row.ad_id)) ?? {}
            const m = metricasDoCriativo(normalizarAd({
              id: String(row.ad_id),
              name: (d.name as string) ?? row.ad_name,
              campaign: { name: row.campaign_name },
              preview_shareable_link: d.preview_shareable_link,
              creative: d.creative,
              insights: { data: [row] },
            }))
            // ATIVO = rodando agora na Meta (effective_status ACTIVE). Pausado,
            // em revisao, adset/campanha pausada etc. -> nao ativo.
            return { ...m, ativo: (d.effective_status as string) === 'ACTIVE' }
          })
        }, bust)
      const [vendas, adsBase] = await Promise.all([
        cacheCurto.get(`vendas|${periodo}`, async () => getSalesParaFunil(dateStart, dateEnd, ['aprovada']), bust),
        adsEntregues,
      ])
      // Só anúncios que GASTARAM no período (>0). Marcado (padrão): só os ATIVOS
      // agora. Desmarcado (todos): ativos + pausados, desde que tenham gasto.
      const ads = adsBase.filter(a => a.spend > 0 && (todos || a.ativo))
      const vendasDoFunil = vendas.filter(v => funilDaVenda(v)?.id === funil.id)
      const adsMeta: CriativoMeta[] = ads.map(a => ({
        // NOME do anúncio (a.anuncio = ad.name), não o nome do criativo (a.criativo),
        // que a Meta às vezes preenche com o texto/descrição do anúncio.
        adId: a.adId, criativo: a.anuncio || a.criativo, thumbnail: a.thumbnail,
        investido: a.spend, isVideo: a.creativoEhVideo, ctr: a.ctr, hookRate: a.hookRate,
        previewUrl: a.previewUrl,
        videoP25: a.videoP25, videoP50: a.videoP50, videoP75: a.videoP75, videoP95: a.videoP95,
      }))
      const criativos = montarCriativos(adsMeta, vendasDoFunil.map((v: Sale) => ({
        utm_content: v.utm_content, valor_pago_cliente: v.valor_pago_cliente, ehPrincipal: ehProdutoPrincipal(v, funil.id),
      })))
      return NextResponse.json({ criativos: criativos.linhas, naoAtribuido: criativos.naoAtribuido })
    }

    // RESUMO / VISÃO GERAL: as 4 buscas EM PARALELO (antes eram em série).
    const [vendas, reembolsos, campanhas, diariosCamp] = await Promise.all([
      cacheCurto.get(`vendas|${periodo}`, async () => getSalesParaFunil(dateStart, dateEnd, ['aprovada']), bust),
      cacheCurto.get(`reemb|${periodo}`, async () => getReembolsosParaFunil(dateStart, dateEnd), bust),
      cacheCurto.get(`camps|${periodo}`, async () => semMeta ? [] as AdInsight[] : (await Promise.all(contas.map(a => getCampanhaInsights(a, dateStart, dateEnd)))).flat().map(normalizarInsight) as AdInsight[], bust),
      cacheCurto.get(`campdia|${periodo}`, async () => semMeta ? [] : (await Promise.all(contas.map(a => getCampanhaInsightsDiario(a, dateStart, dateEnd)))).flat(), bust),
    ])

    // ---- Visão geral (sem funilId): um resumo por funil ----
    if (!funilId) {
      const funis = FUNIS.map(f => {
        const topo = agregarFunil(adsDoFunil(campanhas, f.termosCampanha))
        const vf = agregarVendasDoFunil(vendas, f.id)
        const r = resultadoDoFunil({ faturamentoBruto: vf.faturamentoBruto, taxas: vf.taxas, trafego: topo.investido, impostoRate: f.impostoRate })
        return {
          id: f.id, nome: f.nome,
          vendas: vf.vendas, faturamentoBruto: vf.faturamentoBruto, investido: topo.investido,
          resultadoLiquido: r.resultadoLiquido, roas: r.roas,
        }
      })
      return NextResponse.json({ funis, periodo: { de: dateStart, ate: dateEnd }, aviso })
    }

    // ---- Detalhe de um funil ----
    const funil = FUNIS.find(f => f.id === funilId)
    if (!funil) return NextResponse.json({ error: 'Funil não encontrado' }, { status: 404 })
    const termos = funil.termosCampanha
    const vendasDoFunil = vendas.filter(v => funilDaVenda(v)?.id === funil.id)

    // RESUMO = parte RÁPIDA (funil, resultado, gráficos). Sem puxar ads.
    const topo = agregarFunil(adsDoFunil(campanhas, termos))
    const vf = agregarVendasDoFunil(vendas, funil.id)
    const resultado = resultadoDoFunil({
      faturamentoBruto: vf.faturamentoBruto, taxas: vf.taxas, trafego: topo.investido, impostoRate: funil.impostoRate,
    })

    // Tráfego DIÁRIO por campanha (já buscado no topo), filtrado pelos termos -> gráfico.
    const ts = termos.map(t => t.trim().toLowerCase()).filter(Boolean)
    const trafPorDia = new Map<string, number>()
    for (const row of diariosCamp) {
      if (ts.some(t => String(row.campaign_name).toLowerCase().includes(t))) {
        trafPorDia.set(row.date_start, (trafPorDia.get(row.date_start) ?? 0) + (parseFloat(row.spend) || 0))
      }
    }
    const cadenciaFunil = [...trafPorDia.entries()].map(([data, investido]) => ({ data, investido }))
    const resultadoDia = resultadoDiario(vendasDoFunil, cadenciaFunil, funil.impostoRate)

    const reembolsosDoFunil = reembolsos.filter((v: Sale) => funilDaVenda(v)?.id === funil.id)
    const reembolsoDia = reembolsoDiario(reembolsosDoFunil.map((v: Sale) => ({ data_reembolso: v.data_reembolso, valor_pago_cliente: v.valor_pago_cliente })))

    // Melhores horarios: janela de 2h com mais vendas (data_hora ja em BRT).
    const porHora = new Array(24).fill(0)
    for (const v of vendasDoFunil) { const h = Number(v.data_hora.slice(11, 13)); if (h >= 0 && h < 24) porHora[h]++ }
    let bestH = 0, bestSum = -1
    for (let h = 0; h < 24; h++) { const s = porHora[h] + porHora[(h + 1) % 24]; if (s > bestSum) { bestSum = s; bestH = h } }
    const melhorHorario = bestSum > 0 ? `${bestH}h – ${(bestH + 2) % 24}h` : '—'

    // Lista das vendas do funil (aba "Vendas", igual ao setor de Vendas do DRE):
    // aprovadas pela data da compra, reembolsos pela data do reembolso (venda
    // antiga reembolsada hoje vai pro topo).
    const linhaVenda = (v: Sale) => ({
      id: v.id, nome: v.nome, email: v.email, telefone: v.telefone,
      produto: v.produto, plataforma: v.plataforma,
      bruto: v.valor_pago_cliente, liquido: v.valor_liquido,
      dataHora: v.data_hora, status: v.status, dataReembolso: v.data_reembolso ?? null,
    })
    const vendasLista = [...vendasDoFunil]
      .sort((a, b) => (a.data_hora < b.data_hora ? 1 : -1))
      .map(linhaVenda)
    const reembolsosLista = [...reembolsosDoFunil]
      .sort((a, b) => ((a.data_reembolso ?? a.data_hora) < (b.data_reembolso ?? b.data_hora) ? 1 : -1))
      .map(linhaVenda)

    // ESTEIRA (funil de produtos / value ladder): estagios FIXOS do config,
    // montados SEMPRE (zerados quando nao ha venda no periodo). Boca = principal;
    // order bumps numa linha so; upsell; backend. Ver item 119 do spr-digital.md.
    const esteira = agregarEsteira(vendasDoFunil, funil.id)

    return NextResponse.json({
      funil: { id: funil.id, nome: funil.nome, produtoLabel: funil.produtoLabel, impostoRate: funil.impostoRate },
      topo,
      vendas: vf.vendas, vendasPrincipal: vf.vendasPrincipal, faturamentoBruto: vf.faturamentoBruto, taxas: vf.taxas,
      investido: topo.investido,
      resultado,
      resultadoDiario: resultadoDia,
      reembolsoDiario: reembolsoDia,
      melhorHorario,
      totalReembolso: reembolsoDia.reduce((s, p) => s + p.reembolso, 0),
      vendasLista,
      reembolsosLista,
      esteira,
      periodo: { de: dateStart, ate: dateEnd },
      aviso,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro inesperado' }, { status: 500 })
  }
}
