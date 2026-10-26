// lib/funis/janela-do-periodo.ts
//
// A janela [de, ate] (YYYY-MM-DD, dia de Brasilia) de um preset da tela de funis.
// Usamos UMA janela explicita de datas para a Meta E para as vendas, pra os dois
// lados baterem exatamente o mesmo periodo (senao o ROAS compara janelas diferentes).
//
// Extraida de app/api/funis/performance/route.ts em 26/10/2026, quando entrou o
// preset "Ontem" (pedido do dono). Antes, preset desconhecido caia em 7 dias - um
// botao "Ontem" sem esta funcao mostraria 7 dias em silencio. Ver item 128.

const DIA_MS = 86_400_000
// Brasil sem horario de verao desde 2019: UTC-3 fixo.
const ymdBRT = (ms: number) => new Date(ms - 3 * 3_600_000).toISOString().slice(0, 10)

export function janelaDoPeriodo(
  datePreset: string,
  dateStart: string,
  dateEnd: string,
  agoraMs: number = Date.now(),
): { de: string; ate: string } {
  if (dateStart && dateEnd) return { de: dateStart, ate: dateEnd }
  if (datePreset === 'yesterday') {
    const ontem = ymdBRT(agoraMs - DIA_MS)
    return { de: ontem, ate: ontem }
  }
  const dias = datePreset === 'today' ? 1 : datePreset === 'last_30d' ? 30 : 7
  return { de: ymdBRT(agoraMs - (dias - 1) * DIA_MS), ate: ymdBRT(agoraMs) }
}
