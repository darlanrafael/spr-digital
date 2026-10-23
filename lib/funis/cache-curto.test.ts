import { test } from 'node:test'
import assert from 'node:assert/strict'
import { criarCacheCurto } from './cache-curto'

// Cache curto em memoria da route de funis. O botao de refresh da tela precisa
// trazer o dado DAQUELE momento: ao acionar, manda bust=true e a busca ignora o
// cache (ver item 118 do spr-digital.md). Relogio injetavel pra o teste do TTL
// ser deterministico (sem sleep).

test('sem bust, dentro do TTL, chama a funcao UMA vez so (serve do cache)', async () => {
  let chamadas = 0
  const c = criarCacheCurto(1000, () => 0) // relogio parado em t=0
  const a = await c.get('k', async () => { chamadas++; return 'v1' })
  const b = await c.get('k', async () => { chamadas++; return 'v2' })
  assert.equal(a, 'v1')
  assert.equal(b, 'v1') // veio do cache, nao reexecutou
  assert.equal(chamadas, 1)
})

test('bust=true ignora o cache e reexecuta a funcao SEMPRE, mesmo dentro do TTL', async () => {
  let chamadas = 0
  const c = criarCacheCurto(1000, () => 0)
  await c.get('k', async () => { chamadas++; return 'v1' })           // popula o cache
  const fresco = await c.get('k', async () => { chamadas++; return 'v2' }, true) // refresh
  assert.equal(fresco, 'v2') // trouxe o dado do momento, nao o antigo
  assert.equal(chamadas, 2)
})

test('o refresh (bust) atualiza o cache: a proxima leitura sem bust pega o valor novo', async () => {
  let n = 0
  const c = criarCacheCurto(1000, () => 0)
  await c.get('k', async () => { n++; return 'antigo' })
  await c.get('k', async () => { n++; return 'novo' }, true) // refresh grava 'novo'
  const depois = await c.get('k', async () => { n++; return 'nao deveria' })
  assert.equal(depois, 'novo')
  assert.equal(n, 2) // a 3a leitura veio do cache atualizado pelo refresh
})

test('sem bust, passado o TTL, reexecuta a funcao', async () => {
  let t = 0
  let chamadas = 0
  const c = criarCacheCurto(1000, () => t)
  await c.get('k', async () => { chamadas++; return 'v1' }) // t=0
  t = 1500                                                  // passou do TTL
  const b = await c.get('k', async () => { chamadas++; return 'v2' })
  assert.equal(b, 'v2')
  assert.equal(chamadas, 2)
})
