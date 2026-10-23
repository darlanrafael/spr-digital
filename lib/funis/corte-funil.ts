// TRAVA de data do funil (dono 23/10/2026): contabiliza SO a partir da data de
// corte. Qualquer periodo selecionado e "clampado" pra comecar no corte - mesmo
// que o usuario escolha um periodo retroativo, a base e sempre o corte. Periodo
// todo antes do corte vem zerado. Ver item 120 do spr-digital.md.
//
// Datas no formato ISO 'YYYY-MM-DD' comparam cronologicamente como string.

export type JanelaComCorte = {
  /** Inicio efetivo (nunca antes do corte). */
  de: string
  /** Fim (inalterado). */
  ate: string
  /** true quando o periodo inteiro e anterior ao corte: pular a Meta (as vendas
   *  ja vem vazias porque de > ate). */
  semMeta: boolean
}

/**
 * Aplica a data de corte a uma janela [de, ate]. `corte` null = trava desligada
 * (passa direto). Puro, testavel.
 */
export function aplicarCorte(de: string, ate: string, corte: string | null): JanelaComCorte {
  if (!corte) return { de, ate, semMeta: false }
  if (ate < corte) return { de: corte, ate, semMeta: true } // periodo todo antes do corte
  return { de: de < corte ? corte : de, ate, semMeta: false } // clampa o inicio no corte
}
