import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizarAd } from './meta-funil'

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
