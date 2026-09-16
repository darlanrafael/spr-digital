// lib/cabecalhos-da-identidade.ts
//
// Os nomes dos cabecalhos, e nada mais. Sem import nenhum, de proposito: este
// arquivo e lido pelo navegador, pelo middleware (Edge) e pelas rotas (Node).
// Qualquer dependencia aqui vira dependencia nos tres.

/** Onde o navegador manda o cracha. */
export const CABECALHO_DO_CRACHA = 'x-spr-cracha'

/**
 * Onde o middleware escreve QUEM esta chamando.
 *
 * O middleware APAGA estes cabecalhos antes de escrever. Sem isso, quem chama
 * mandaria `x-spr-quem-tipo: dashboard:admin` na mao e viraria admin.
 */
export const CABECALHOS_DA_IDENTIDADE = {
  tipo: 'x-spr-quem-tipo',
  id: 'x-spr-quem-id',
  terapeutaId: 'x-spr-quem-terapeuta-id',
  email: 'x-spr-quem-email',
} as const