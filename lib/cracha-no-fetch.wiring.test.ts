// lib/cracha-no-fetch.wiring.test.ts
//
// `cracha-no-fetch.test.ts` testa `fetchComCracha` e `crachaGuardado` chamados
// DIRETO, isolados. Isso prova a logica, mas nao prova a FIACAO: que
// `instalarCrachaNoFetch()`, quando instalado sobre `window` de verdade,
// realmente troca `window.fetch` de um jeito que a tela (que so chama
// `fetch(...)` puro, sem saber do embrulho) sai com o cabecalho anexado.
//
// Este arquivo fecha essa lacuna: monta um `window` falso com um
// `localStorage` em memoria e um `fetch` original que captura os cabecalhos
// vistos, chama a funcao real `instalarCrachaNoFetch()` (a mesma que
// `contexts/AppContext.tsx` chama no boot), e entao chama `window.fetch(...)`
// como a tela chamaria - sem invocar `fetchComCracha` por fora.
import { test } from 'node:test'
import assert from 'node:assert/strict'

// localStorage em memoria, mutavel entre casos (mesmo objeto do inicio ao
// fim - a fiacao real nao troca de window a cada chamada, so a sessao
// guardada muda).
const store: Record<string, string> = {}
const localStorageFalso = {
  getItem: (chave: string) => store[chave] ?? null,
  setItem: (chave: string, valor: string) => { store[chave] = valor },
  removeItem: (chave: string) => { delete store[chave] },
}

function limparSessoes(): void {
  delete store.spr_session
  delete store.terapeutas_session
}

// O `fetch` ORIGINAL do window falso - o que `instalarCrachaNoFetch` embrulha.
// Grava os cabecalhos que efetivamente chegaram nele, depois do embrulho.
let cabecalhosVistos: Headers | null = null
const fetchOriginalFalso = async (_entrada: RequestInfo | URL, init?: RequestInit) => {
  cabecalhosVistos = new Headers(init?.headers)
  return new Response('{}', { status: 200 })
}

// Monta o window falso ANTES de importar o modulo, como o brief pede -
// garante que nao ha nenhuma pressuposicao de ordem entre o import e a
// existencia de `window`.
const g = globalThis as unknown as { window?: unknown }
g.window = {
  localStorage: localStorageFalso,
  location: { origin: 'http://localhost', pathname: '/dashboard' },
  fetch: fetchOriginalFalso,
}

import { instalarCrachaNoFetch, CABECALHO_DO_CRACHA } from './cracha-no-fetch'

test('FIACAO: instalarCrachaNoFetch troca window.fetch pelo embrulho', () => {
  const janela = g.window as { fetch: unknown }
  instalarCrachaNoFetch()
  assert.notEqual(janela.fetch, fetchOriginalFalso, 'window.fetch tem que ter sido substituido pelo embrulho')
})

test('a. sessao do DRE (spr_session) -> window.fetch("/api/sales") leva x-spr-cracha', async () => {
  limparSessoes()
  store.spr_session = JSON.stringify({ token: 'DRE123' })
  cabecalhosVistos = null
  const janela = g.window as { fetch: typeof fetch }
  await janela.fetch('/api/sales')
  assert.equal(cabecalhosVistos!.get(CABECALHO_DO_CRACHA), 'DRE123')
})

test('b. sessao de terapeutas (terapeutas_session), sem spr_session -> leva x-spr-cracha', async () => {
  limparSessoes()
  store.terapeutas_session = JSON.stringify({ token: 'TER456' })
  cabecalhosVistos = null
  const janela = g.window as { fetch: typeof fetch }
  await janela.fetch('/api/sales')
  assert.equal(cabecalhosVistos!.get(CABECALHO_DO_CRACHA), 'TER456')
})

test('c. sem sessao nenhuma -> NAO leva o header (rota protegida devolveria 401, correto)', async () => {
  limparSessoes()
  cabecalhosVistos = null
  const janela = g.window as { fetch: typeof fetch }
  await janela.fetch('/api/sales')
  assert.equal(cabecalhosVistos!.has(CABECALHO_DO_CRACHA), false)
})
