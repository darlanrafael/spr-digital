import { isHojeBrasilia } from './terapeutas-auth'

/**
 * Qual sessao de um agendamento vira o aviso imediato de "VENDA DE ENCAIXE" no
 * grupo do terapeuta (lib/notificar-encaixe.ts). `null` = nao avisa.
 *
 * - Sessao avulsa marcada pra hoje: avisa (a regra de sempre).
 * - Venda NOVA (sem sessao antes) com sessao hoje: avisa a mais cedo de hoje,
 *   mesmo com mais sessoes no pacote. Entrou em 29/10/2026: a Priscilla (Pedro)
 *   comprou 2 sessoes com a 1a no mesmo dia e o grupo nao soube.
 * - REFAZER pacote que ja existia: nao avisa. Era o alarme falso que levou ao
 *   corte antigo de "so 1 sessao": recriar historico com datas de hoje mandava
 *   um "Venda de Encaixe" por sessao pra paciente que ja estava na agenda.
 *
 * Um aviso so por agendamento: com sessoes coladas no mesmo dia, o grupo ja
 * fica sabendo da venda pela primeira; as demais seguem o lembrete de 30 min.
 */
export function sessaoDeEncaixe<T extends { data_agendada: string }>(
  sessoes: T[],
  vendaNova: boolean,
  agoraMs: number = Date.now(),
): T | null {
  if (sessoes.length === 1) return isHojeBrasilia(sessoes[0].data_agendada, agoraMs) ? sessoes[0] : null
  if (!vendaNova) return null
  const deHoje = sessoes
    .filter(s => isHojeBrasilia(s.data_agendada, agoraMs))
    .sort((a, b) => new Date(a.data_agendada).getTime() - new Date(b.data_agendada).getTime())
  return deHoje[0] ?? null
}
