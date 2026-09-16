// lib/cracha-no-fetch.ts
//
// Anexa o cracha em toda chamada que a tela faz para /api/.
//
// POR QUE EMBRULHO, e nao editar as chamadas: sao 55 chamadas a `/api/` em 11
// arquivos. Editar as 55 e 55 chances de esquecer uma, e a esquecida so
// apareceria como tela quebrada depois que o middleware passasse a exigir.
// Mesmo padrao de `lib/fetch-com-retry.ts`, que ja embrulha o fetch do Supabase.

import { CABECALHO_DO_CRACHA } from './cabecalhos-da-identidade'
export { CABECALHO_DO_CRACHA }

const CHAVE_DRE = 'spr_session'
const CHAVE_TERAPEUTAS = 'terapeutas_session'

/** O cracha guardado no navegador, de qualquer uma das duas areas de login. */
export function crachaGuardado(): string | null {
  if (typeof window === 'undefined') return null
  for (const chave of [CHAVE_DRE, CHAVE_TERAPEUTAS]) {
    try {
      const cru = window.localStorage.getItem(chave)
      if (!cru) continue
      const s = JSON.parse(cru) as { token?: string } | null
      if (s && typeof s.token === 'string' && s.token) return s.token
    } catch { /* sessao corrompida nao derruba a chamada */ }
  }
  return null
}

/**
 * So chamada para /api/ do PROPRIO sistema leva o cracha junto.
 *
 * Resolve tanto endereco relativo (`/api/x`) quanto absoluto do proprio site
 * (`http://localhost:3000/api/x`) e objeto URL, contra a origem do site. Um
 * endereco de fora (Facebook, outro dominio) fica de fora: o cracha e
 * credencial e nao pode vazar para terceiro.
 *
 * A origem vem de `window.location.origin` no navegador; em teste (sem window)
 * usa uma origem local, e por isso a deteccao NAO depende de `window` existir -
 * a primeira versao dependia, e o teste de URL absoluta falhava com o cracha
 * nao anexado. Provado em 15/09/2026.
 */
function ehChamadaDaCasa(entrada: RequestInfo | URL): boolean {
  const url = typeof entrada === 'string' ? entrada
    : entrada instanceof URL ? entrada.href
    : entrada.url
  const origem = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
  try {
    const u = new URL(url, origem)
    return u.origin === origem && u.pathname.startsWith('/api/')
  } catch { return false }
}

export function fetchComCracha(
  fetchOriginal: typeof fetch,
  lerCracha: () => string | null = crachaGuardado,
): typeof fetch {
  return async (entrada: RequestInfo | URL, init?: RequestInit) => {
    if (!ehChamadaDaCasa(entrada)) return fetchOriginal(entrada, init)
    const cracha = lerCracha()
    if (!cracha) return fetchOriginal(entrada, init)
    const cabecalhos = new Headers(init?.headers)
    cabecalhos.set(CABECALHO_DO_CRACHA, cracha)
    return fetchOriginal(entrada, { ...init, headers: cabecalhos })
  }
}

let instalado = false

/** Instala o embrulho uma vez so, no navegador. */
export function instalarCrachaNoFetch(): void {
  if (typeof window === 'undefined' || instalado) return
  instalado = true
  window.fetch = fetchComCracha(window.fetch.bind(window))
}