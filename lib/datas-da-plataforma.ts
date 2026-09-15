// Como a data de uma venda e lida, e como um dia de Brasilia vira faixa de
// consulta no banco.
//
// Modulo puro (sem Supabase) de proposito. As tres funcoes viviam dentro de
// `lib/services.ts`, sem `export`, e por isso nenhum teste as alcancava - em
// 639 linhas, `services.ts` e o maior modulo do projeto e nao tinha um unico
// teste. Sao elas que decidem a data de TODA venda em Vendas, Fechamentos, DRE
// e Analises, e o buraco apareceu na varredura de 15/09/2026.
//
// A regra que atravessa as tres: a Hubla grava `data_hora` em UTC de verdade; a
// Kiwify grava hora de Brasilia com sufixo `+00:00`, que NAO e UTC. Tratar as
// duas igual desloca a venda em tres horas - e o sinal do erro depende da
// plataforma, nao do horario.

/**
 * A data da venda, normalizada para hora de Brasilia, com 19 caracteres
 * (`YYYY-MM-DDTHH:mm:ss`) e SEM sufixo de fuso.
 *
 * Timestamps do Supabase (timestamptz) chegam com `+00:00` ou `Z`. A Hubla
 * grava `data_hora` em UTC real, entao converte-se para Brasilia (UTC-3)
 * subtraindo 3 horas. A Kiwify grava `data_hora` ja em horario de Brasilia, so
 * com o sufixo `+00:00` (nao e UTC de verdade) - se a mesma subtracao de 3h for
 * aplicada nela, o horario desloca 3h a mais do que deveria, e uma venda feita
 * entre 00:00 e 02:59 (BRT) passa a aparecer com data do DIA ANTERIOR em todo
 * filtro de periodo (Vendas, Fechamentos, DRE, Analises).
 *
 * O retorno nao tem fuso de proposito: e hora de parede de Brasilia, para a
 * tela. ATENCAO: por isso mesmo ele nao pode ser comparado como texto com
 * `data_confirmacao`, que vem em UTC com fracao e `+00:00` - foi exatamente
 * esse erro que prendeu R$ 3.181,85 de receita (item 67 do MD). Para comparar,
 * converta os dois lados em instante.
 */
export function normTs(ts: string | null | undefined, isKiwify = false): string {
  if (!ts) return ''
  if (!isKiwify && (ts.includes('+') || ts.endsWith('Z'))) {
    const date = new Date(ts)
    if (!isNaN(date.getTime())) {
      return new Date(date.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 19)
    }
  }
  return ts.slice(0, 19)
}

/**
 * Converte uma data de Brasilia (`YYYY-MM-DD`) nos limites UTC corretos para
 * filtro no Supabase. Brasilia = UTC-3: o dia D vai de `D T03:00:00Z` ate
 * `(D+1) T02:59:59Z`. Usado para HUBLA, que grava `data_hora` em UTC real.
 */
export function brtDayRangeToUTC(dateStr: string): { startUTC: string; endUTC: string } {
  const startUTC = `${dateStr}T03:00:00`
  // +1 dia via Date UTC para cobrir virada de mes e de ano corretamente
  const next = new Date(`${dateStr}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  const endUTC = `${next.toISOString().slice(0, 10)}T02:59:59`
  return { startUTC, endUTC }
}

/**
 * Limites para KIWIFY, que grava `data_hora` em BRT-como-UTC: hora de Brasilia
 * com sufixo `+00:00`, sem conversao para UTC real. Dia D em BRT vai de
 * `D T00:00:00` ate `D T23:59:59` no campo `data_hora`.
 */
export function kiwifyBrtRange(dateStr: string): { start: string; end: string } {
  return { start: `${dateStr}T00:00:00`, end: `${dateStr}T23:59:59` }
}
