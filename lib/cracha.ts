// lib/cracha.ts
//
// SEM `import from 'crypto'`. Isto NAO e preferencia de estilo.
//
// Provado rodando em 15/09/2026: com `import * as crypto from 'crypto'`, o
// `npm run build` PASSA e o servidor devolve **HTTP 500 em toda rota de API**,
// com "The edge runtime does not support Node.js 'crypto' module". O middleware
// roda no runtime Edge, que nao tem os modulos do Node - e como o build nao
// executa o middleware, ele nao avisa nada.
//
// `globalThis.crypto.getRandomValues` e Web Crypto: existe no Edge E no Node
// 18+. Testado nos dois, com o mesmo resultado de 64 caracteres hexadecimais.

// A validade do cracha, e quando renova-la.
//
// Os numeros sao os mesmos que `lib/terapeutas-auth.ts` ja usa em producao
// desde 19/08/2026, e o motivo esta la: uma validade fixa de 7 dias fazia o
// Pedro voltar a digitar senha toda semana, que era exatamente o que a feature
// existia para evitar. Janela DESLIZANTE: cada uso empurra a validade para a
// frente, e o cracha so morre depois de 30 dias sem nenhum uso - que e o caso
// em que expirar protege mesmo (maquina perdida, pessoa desligada).
export const DIAS_DE_VALIDADE = 30
export const RENOVAR_QUANDO_FALTAR_DIAS = 15

const DIA_MS = 24 * 60 * 60 * 1000

/** A data em que um cracha emitido agora vence. Usada tambem na renovacao. */
export function novaValidade(agoraMs: number = Date.now()): string {
  return new Date(agoraMs + DIAS_DE_VALIDADE * DIA_MS).toISOString()
}

/** `agoraMs` existe para o teste poder fixar o instante. Ninguem passa. */
export function gerarCracha(agoraMs: number = Date.now()): { token: string; expiraEm: string } {
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes)
  return {
    token: Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''),
    expiraEm: novaValidade(agoraMs),
  }
}

/** Sem validade gravada, conta como vencido: na duvida, recusa. */
export function crachaVencido(expiraEm: string | null | undefined, agoraMs: number = Date.now()): boolean {
  if (!expiraEm) return true
  const t = new Date(expiraEm).getTime()
  if (Number.isNaN(t)) return true
  return t <= agoraMs
}

/** Renova so quando falta pouco, para nao escrever no banco a cada acao. */
export function precisaRenovar(expiraEm: string | null | undefined, agoraMs: number = Date.now()): boolean {
  if (!expiraEm) return false
  const t = new Date(expiraEm).getTime()
  if (Number.isNaN(t)) return false
  const falta = t - agoraMs
  return falta > 0 && falta < RENOVAR_QUANDO_FALTAR_DIAS * DIA_MS
}