// Quanto tempo uma consulta REALMENTE ocupa na agenda.
//
// Módulo puro (sem Supabase, sem React) de propósito: a mesma regra precisa
// valer na tela da agenda, no aviso de conflito do compromisso e na trava do
// servidor. Quando cada lugar calculava do seu jeito, a tela mostrava um
// horário como "Livre" e o aviso dizia que tinha conflito — no mesmo clique.

/** "14:10" → 850 (minutos desde a meia-noite). */
export function horarioParaMinutos(horario: string): number {
  const [h, m] = horario.split(':').map(Number)
  return h * 60 + m
}

/**
 * Fim efetivo de uma consulta que começa em `inicioMin`.
 *
 * Terapeuta de horário fixo pode ter horários mais próximos entre si do que a
 * duração cadastrada. Na grade do Pedro (sessão de 50min): 13:30 → 14:10 são
 * 40 minutos, 12:10 → 12:40 são 30, 17:30 → 18:15 são 45. Somar 50 minutos
 * cegamente faz a consulta das 13:30 "terminar" 14:20 e invadir o horário das
 * 14:10 — que a própria grade oferece como atendível.
 *
 * Então o fim é o menor entre (início + duração) e o próximo horário da grade.
 * Sem grade fixa (o padrão), a duração vale inteira.
 */
export function fimEfetivoSessao(
  inicioMin: number,
  duracaoMinutos: number,
  horariosFixos?: string[] | null,
): number {
  const fimPorDuracao = inicioMin + duracaoMinutos
  if (!horariosFixos || horariosFixos.length === 0) return fimPorDuracao

  let proximo: number | null = null
  for (const h of horariosFixos) {
    const m = horarioParaMinutos(h)
    if (m > inicioMin && (proximo === null || m < proximo)) proximo = m
  }
  return proximo === null ? fimPorDuracao : Math.min(fimPorDuracao, proximo)
}
