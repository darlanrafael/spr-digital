import { test } from 'node:test'
import assert from 'node:assert/strict'
import { criarCacheCurto } from './cache-curto'
import { buscarMetaNoCache, emCadaConta } from './busca-meta-funil'
import type { RelatoMeta } from '../meta'

// A rota de Funis busca cada pedaco da Meta por aqui (Task 5, revisao Codex t5):
// cria o relato, entrega a busca, devolve { linhas, falhou } e so guarda no cache
// o que veio completo. Relogio parado (TTL deterministico).

test('busca completa: falhou false e fica no cache', async () => {
  const cache = criarCacheCurto(120_000, () => 0)
  let chamadas = 0
  const a = await buscarMetaNoCache(cache, 'k', false, async () => { chamadas++; return [1, 2] })
  const b = await buscarMetaNoCache(cache, 'k', false, async () => { chamadas++; return [9] })
  assert.deepEqual(a, { linhas: [1, 2], falhou: false })
  assert.deepEqual(b, { linhas: [1, 2], falhou: false })
  assert.equal(chamadas, 1)
})

test('busca com falha: devolve o parcial com falhou true e nao guarda (a proxima busca de novo)', async () => {
  const cache = criarCacheCurto(120_000, () => 0)
  const parcial = await buscarMetaNoCache(cache, 'k', false, async (relato: RelatoMeta) => { relato.falhas++; return [1] })
  assert.deepEqual(parcial, { linhas: [1], falhou: true })
  const recuperada = await buscarMetaNoCache(cache, 'k', false, async () => [1, 2])
  assert.deepEqual(recuperada, { linhas: [1, 2], falhou: false })
})

test('falha num Atualizar (bust) nao apaga o valor completo guardado', async () => {
  const cache = criarCacheCurto(120_000, () => 0)
  await buscarMetaNoCache(cache, 'k', false, async () => [1, 2])
  const r = await buscarMetaNoCache(cache, 'k', true, async (relato: RelatoMeta) => { relato.falhas++; return [] })
  assert.equal(r.falhou, true)
  assert.deepEqual(await buscarMetaNoCache(cache, 'k', false, async () => [7]), { linhas: [1, 2], falhou: false })
})

test('cada chamada recebe um relato novo, zerado', async () => {
  const cache = criarCacheCurto(120_000, () => 0)
  const vistos: number[] = []
  await buscarMetaNoCache(cache, 'k1', false, async (relato: RelatoMeta) => { vistos.push(relato.falhas); relato.falhas++; return [] })
  await buscarMetaNoCache(cache, 'k2', false, async (relato: RelatoMeta) => { vistos.push(relato.falhas); return [] })
  assert.deepEqual(vistos, [0, 0])
})

// Revisao final 13/11 (Codex + Gemini): META_AD_ACCOUNT_IDS vazio fazia os Funis
// mostrarem investimento R$ 0,00 como completo, sem aviso e guardado no cache.
test('emCadaConta: sem nenhuma conta conta 1 falha e nao busca', async () => {
  const relato = { falhas: 0 }
  let chamou = 0
  assert.deepEqual(await emCadaConta([], relato, async () => { chamou++; return [1] }), [])
  assert.equal(relato.falhas, 1)
  assert.equal(chamou, 0)
})

test('emCadaConta: junta as linhas de cada conta na ordem e nao conta falha', async () => {
  const relato = { falhas: 0 }
  const linhas = await emCadaConta(['A', 'B'], relato, async c => [`${c}1`, `${c}2`])
  assert.deepEqual(linhas, ['A1', 'A2', 'B1', 'B2'])
  assert.equal(relato.falhas, 0)
})

test('emCadaConta: sem contas dentro de buscarMetaNoCache volta falhou e nao fica no cache', async () => {
  const cache = criarCacheCurto(60_000, () => 0)
  let buscas = 0
  const buscar = (relato: { falhas: number }) => { buscas++; return emCadaConta([], relato, async () => [1]) }
  assert.deepEqual(await buscarMetaNoCache(cache, 'k', false, buscar), { linhas: [], falhou: true })
  await buscarMetaNoCache(cache, 'k', false, buscar)
  assert.equal(buscas, 2)
})
