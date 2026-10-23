import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adIdDaVenda } from './atribuicao-criativo'

// A venda carrega o ad id da Meta no utm_content, no formato
//   "<nome do anuncio>|<adId>::<tracking>::"  ou  "<nome>|<adId>".
// E assim que a gente liga venda -> criativo de verdade (o Meta nao sabe qual
// anuncio gerou a venda; a UTM sabe). adId do Meta e sempre numerico.
// Preenchido em ~96% das vendas (item 114 do spr-digital.md). Venda sem UTM
// utilizavel -> null (cai no balde "nao atribuido").

test('extrai o ad id depois do "|", cortando o tracking "::"', () => {
  assert.equal(adIdDaVenda('VID_08.10_OUT26_CSP_AD03|120253136277370668::PAYW9le_aem_x::'), '120253136277370668')
})

test('extrai quando nao tem tracking', () => {
  assert.equal(adIdDaVenda('vid_AD08|120251581661960566'), '120251581661960566')
})

test('sem "|" (link_in_bio, organico) -> null', () => {
  assert.equal(adIdDaVenda('link_in_bio'), null)
})

test('vazio/nulo -> null', () => {
  assert.equal(adIdDaVenda(''), null)
  assert.equal(adIdDaVenda(null), null)
  assert.equal(adIdDaVenda(undefined), null)
})

test('segmento do id nao-numerico -> null (nao inventa atribuicao)', () => {
  assert.equal(adIdDaVenda('algumacoisa|nao_e_numero::x'), null)
})

test('aceita espacos em volta', () => {
  assert.equal(adIdDaVenda('  nome | 120251581661960566 '), '120251581661960566')
})
