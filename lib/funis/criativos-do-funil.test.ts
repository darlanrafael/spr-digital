import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarCriativos, type CriativoMeta, type VendaAtribuivel } from './criativos-do-funil'

const ad = (o: Partial<CriativoMeta>): CriativoMeta => ({
  adId: '100', criativo: 'Anúncio X', thumbnail: null, investido: 1000,
  isVideo: true, ctr: 2.5, hookRate: 30, previewUrl: '', videoP25: 0, videoP50: 0, videoP75: 0, videoP95: 0, ...o,
})
const venda = (adId: string | null, valor: number, ehPrincipal = false): VendaAtribuivel => ({
  utm_content: adId ? `nome|${adId}::trk::` : 'link_in_bio', valor_pago_cliente: valor, ehPrincipal,
})

test('atribui vendas ao criativo pelo ad id; calcula ROAS e CPA', () => {
  const r = montarCriativos([ad({ adId: '100', investido: 1000 })], [venda('100', 300), venda('100', 200)])
  const c = r.linhas[0]
  assert.equal(c.vendas, 2)
  assert.equal(c.faturamento, 500)
  assert.equal(c.roas, 0.5)        // 500 / 1000
  assert.equal(c.cpa, 500)         // 1000 / 2
  assert.deepEqual(r.naoAtribuido, { vendas: 0, faturamento: 0 })
})

test('separa vendas do PRINCIPAL das vendas COM AGREGADOS', () => {
  // mesmo anuncio: 1 venda do principal (CSP) + 2 de agregados (bumps).
  const r = montarCriativos([ad({ adId: '100', investido: 1000 })], [
    venda('100', 169, true),   // principal
    venda('100', 97, false),   // agregado (bump)
    venda('100', 50, false),   // agregado (bump)
  ])
  const c = r.linhas[0]
  assert.equal(c.vendasPrincipal, 1)   // só o Como Ser Perdoado
  assert.equal(c.vendas, 3)            // com agregados (1 + 2)
  assert.equal(c.faturamento, 316)     // 169 + 97 + 50 (total)
  assert.equal(c.roasPrincipal, 0.17)  // 169 / 1000 (só o principal)
  assert.equal(c.roas, 0.32)           // 316 / 1000 (com agregados)
  assert.equal(c.cpaPrincipal, 1000)   // 1000 / 1 venda do principal
  assert.equal(c.cpa, 333.33)          // 1000 / 3 vendas totais
})

test('criativo sem venda: vendas 0, roas 0, cpa null (nao divide por zero)', () => {
  const r = montarCriativos([ad({ adId: '100', investido: 800 })], [])
  assert.equal(r.linhas[0].vendas, 0)
  assert.equal(r.linhas[0].faturamento, 0)
  assert.equal(r.linhas[0].roas, 0)
  assert.equal(r.linhas[0].cpa, null)
})

test('venda sem ad id (organico/link bio) vai pro balde "nao atribuido"', () => {
  const r = montarCriativos([ad({ adId: '100' })], [venda(null, 150), venda('100', 100)])
  assert.equal(r.linhas[0].vendas, 1)
  assert.deepEqual(r.naoAtribuido, { vendas: 1, faturamento: 150 })
})

test('venda com ad id que NAO esta entre os criativos do funil tambem vai pro nao atribuido', () => {
  const r = montarCriativos([ad({ adId: '100' })], [venda('999', 250)])
  assert.equal(r.linhas[0].vendas, 0)
  assert.deepEqual(r.naoAtribuido, { vendas: 1, faturamento: 250 })
})

test('ordena criativos por vendas (desc)', () => {
  const r = montarCriativos(
    [ad({ adId: '1', criativo: 'A' }), ad({ adId: '2', criativo: 'B' })],
    [venda('2', 10), venda('2', 10), venda('1', 10)],
  )
  assert.deepEqual(r.linhas.map(l => l.criativo), ['B', 'A'])
})

test('formato: video -> "Vídeo", resto -> "Imagem"', () => {
  const r = montarCriativos([ad({ adId: '1', isVideo: true }), ad({ adId: '2', isVideo: false })], [])
  const porId = Object.fromEntries(r.linhas.map(l => [l.adId, l.formato]))
  assert.equal(porId['1'], 'Vídeo')
  assert.equal(porId['2'], 'Imagem')
})
