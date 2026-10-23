import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizarAd, adsDoFunil, agregarFunil, metricasDoCriativo, serieDiaria } from './meta-funil'

const RAW = {
  name: 'VID_Ago_03',
  campaign: { name: 'CSP_Vendas_Frio_Advantage_TesteConta' },
  creative: { name: 'Toque em Saiba Mais', thumbnail_url: 'http://x/t.jpg' },
  insights: { data: [{
    spend: '139.74', impressions: '2612', reach: '1976',
    inline_link_clicks: '40', unique_clicks: '42',
    actions: [
      { action_type: 'landing_page_view', value: '30' },
      { action_type: 'initiate_checkout', value: '8' },
      { action_type: 'video_view', value: '2565' },
      { action_type: 'purchase', value: '3' },
    ],
  }] },
}

test('normaliza os campos do ad de video', () => {
  const a = normalizarAd(RAW)
  assert.equal(a.campanha, 'CSP_Vendas_Frio_Advantage_TesteConta')
  assert.equal(a.criativo, 'Toque em Saiba Mais')
  assert.equal(a.thumbnail, 'http://x/t.jpg')
  assert.equal(a.spend, 139.74)
  assert.equal(a.impressions, 2612)
  assert.equal(a.reach, 1976)
  assert.equal(a.inlineLinkClicks, 40)
  assert.equal(a.uniqueClicks, 42)
  assert.equal(a.landingPageView, 30)
  assert.equal(a.initiateCheckout, 8)
  assert.equal(a.videoView, 2565)
  assert.equal(a.isVideo, true)
})

test('creativoEhVideo vem do TIPO do criativo, nao da entrega (vídeo sem view ainda é vídeo)', () => {
  // object_type VIDEO sem nenhuma video_view no período -> isVideo false, mas creativoEhVideo true.
  const semEntrega = normalizarAd({ name: 'VID_parado', campaign: { name: 'CSP' }, creative: { object_type: 'VIDEO' } })
  assert.equal(semEntrega.isVideo, false)        // não teve view no período
  assert.equal(semEntrega.creativoEhVideo, true) // mas é um vídeo
  // por video_id também conta
  assert.equal(normalizarAd({ name: 'x', creative: { video_id: '123' } }).creativoEhVideo, true)
  // imagem (sem object_type VIDEO nem video_id) -> false
  assert.equal(normalizarAd({ name: 'IMG', creative: { object_type: 'SHARE', image_hash: 'abc' } }).creativoEhVideo, false)
})

test('extrai os marcos de video (video_pXX_watched_actions, array [{value}])', () => {
  const a = normalizarAd({
    name: 'VID', campaign: { name: 'CSP' }, creative: {},
    insights: { data: [{
      impressions: '265709',
      video_p25_watched_actions: [{ action_type: 'video_view', value: '14984' }],
      video_p50_watched_actions: [{ action_type: 'video_view', value: '10268' }],
      video_p75_watched_actions: [{ action_type: 'video_view', value: '7936' }],
      video_p95_watched_actions: [{ action_type: 'video_view', value: '1762' }],
    }] },
  })
  assert.equal(a.videoP25, 14984)
  assert.equal(a.videoP50, 10268)
  assert.equal(a.videoP75, 7936)
  assert.equal(a.videoP95, 1762)
})

test('ad sem os campos de video -> marcos em 0 (nao quebra)', () => {
  const a = normalizarAd({ name: 'IMG', campaign: { name: 'C' }, creative: {} })
  assert.equal(a.videoP50, 0)
  assert.equal(a.videoP95, 0)
})

test('ad sem insights / sem actions -> zeros, isVideo false, sem quebrar', () => {
  const a = normalizarAd({ name: 'IMG_01', campaign: { name: 'C' }, creative: {} })
  assert.equal(a.spend, 0)
  assert.equal(a.impressions, 0)
  assert.equal(a.landingPageView, 0)
  assert.equal(a.initiateCheckout, 0)
  assert.equal(a.videoView, 0)
  assert.equal(a.isVideo, false)
  assert.equal(a.thumbnail, null)
})

const mk = (campanha: string): any => ({ campanha, criativo: 'x', thumbnail: null, spend: 1, impressions: 1, reach: 1, inlineLinkClicks: 0, uniqueClicks: 0, landingPageView: 0, initiateCheckout: 0, videoView: 0, isVideo: false })

test('pega anuncios cuja campanha CONTEM o termo (case-insensitive)', () => {
  const ads = [mk('CSP_Vendas_Frio'), mk('IAR_Topo'), mk('Outra')]
  assert.equal(adsDoFunil(ads, ['csp']).length, 1)
  assert.equal(adsDoFunil(ads, ['CSP', 'IAR']).length, 2)
})

test('funil organico (sem termos) -> nenhum anuncio', () => {
  assert.equal(adsDoFunil([mk('CSP')], []).length, 0)
})

const ad = (o: Partial<any> = {}): any => ({ campanha: 'C', criativo: 'x', thumbnail: null, spend: 0, impressions: 0, reach: 0, inlineLinkClicks: 0, uniqueClicks: 0, landingPageView: 0, initiateCheckout: 0, videoView: 0, isVideo: false, ...o })

test('agrega: soma aditivos; CTR = uniq/reach; Hook so sobre video; custo/checkout', () => {
  const ads = [
    ad({ spend: 100, impressions: 1000, reach: 800, inlineLinkClicks: 50, uniqueClicks: 40, landingPageView: 30, initiateCheckout: 10, videoView: 200, isVideo: true }),
    ad({ spend: 50, impressions: 500, reach: 400, inlineLinkClicks: 20, uniqueClicks: 20, landingPageView: 10, initiateCheckout: 5, videoView: 0, isVideo: false }),
  ]
  const r = agregarFunil(ads)
  assert.equal(r.investido, 150)
  assert.equal(r.impressoes, 1500)
  assert.equal(r.cliques, 70)
  assert.equal(r.visitas, 40)
  assert.equal(r.checkouts, 15)
  assert.equal(r.alcanceAprox, 1200)
  assert.equal(r.ctr, Math.round((60 / 1200 * 100) * 100) / 100) // uniq 60 / reach 1200
  assert.equal(r.hookRate, Math.round((200 / 1000 * 100) * 100) / 100) // video: 200 / impressions-de-video 1000
  assert.equal(r.custoPorCheckout, 10) // 150 / 15
})

test('divisao por zero -> null (nao NaN)', () => {
  const r = agregarFunil([ad()])
  assert.equal(r.ctr, null)
  assert.equal(r.hookRate, null)
  assert.equal(r.custoPorCheckout, null)
})

test('criativo de video tem hookRate; imagem tem null', () => {
  assert.equal(metricasDoCriativo(ad({ impressions: 1000, reach: 500, uniqueClicks: 25, videoView: 300, isVideo: true })).hookRate, 30)
  assert.equal(metricasDoCriativo(ad({ impressions: 1000, isVideo: false })).hookRate, null)
  assert.equal(metricasDoCriativo(ad({ reach: 500, uniqueClicks: 25 })).ctr, 5)
  assert.equal(metricasDoCriativo(ad({ reach: 0, uniqueClicks: 0 })).ctr, null)
})

test('soma por dia e ordena por data', () => {
  const linhas = [
    { date_start: '2026-10-02', spend: '100', inline_link_clicks: '10' },
    { date_start: '2026-10-01', spend: '50', inline_link_clicks: '5' },
    { date_start: '2026-10-02', spend: '25', inline_link_clicks: '3' },
  ]
  const s = serieDiaria(linhas)
  assert.deepEqual(s, [
    { data: '2026-10-01', investido: 50, cliques: 5 },
    { data: '2026-10-02', investido: 125, cliques: 13 },
  ])
})

test('linha de CAMPANHA (nome no topo, sem campaign aninhado) casa e agrega o funil', () => {
  const a = normalizarAd({ name: 'CSP_X', insights: { data: [{ spend: '10', impressions: '100' }] } })
  assert.equal(a.campanha, 'CSP_X')
  const f = adsDoFunil([a], ['csp_x'])
  assert.equal(f.length, 1)
  const ag = agregarFunil(f)
  assert.equal(ag.investido, 10)
  assert.equal(ag.impressoes, 100)
})
