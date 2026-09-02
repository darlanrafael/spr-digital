// Regras do reagendamento total (o "Agendar" apontado para uma venda que JÁ
// tem sessões). Vale para TODOS os produtos, não só para o Diagnóstico Guiado.
//
// Por que existe como módulo separado e puro: a decisão de recusar precisa
// acontecer ANTES de qualquer efeito colateral (apagar sessão, cancelar convite
// no Google), e a única forma de provar isso num teste automatizado é ter a
// decisão fora da rota, sem banco e sem rede.

/** Status que o reagendamento total substitui. Entregue e cancelada ficam. */
export const STATUS_SUBSTITUIVEIS = ['pendente', 'agendada', 'remarcada'] as const

export type SessaoExistente = {
  id: string
  status: string
  numero_sessao: number
  google_event_id: string | null
}

export type PlanoReagendamento =
  | { ok: true; substituir: SessaoExistente[] }
  | { ok: false; erro: string; entregues: number[] }

/**
 * Decide se dá para reagendar o pacote inteiro desta venda e, se der, devolve
 * exatamente quais sessões serão apagadas (com o evento do Google a cancelar).
 *
 * Por que recusar quando há sessão entregue: o reagendamento apaga só as não
 * entregues e recria a numeração a partir da 1. Com uma entregue no meio, o
 * insert bate no unique (sale_id, numero_sessao) e devolve 23505 - só que
 * nesse ponto as pendentes JÁ foram apagadas e os convites do paciente JÁ
 * foram cancelados no Google. O usuário via uma mensagem de erro de banco e
 * ficava com o pacote pela metade, sem forma de voltar atrás. Medido em
 * 01/09/2026: 32 vendas do banco estão nesse estado misto, com 64 sessões
 * pendentes que têm evento no Calendar.
 */
export function planejarReagendamentoTotal(sessoes: SessaoExistente[]): PlanoReagendamento {
  const entregues = sessoes
    .filter(s => s.status === 'entregue')
    .map(s => s.numero_sessao)
    .sort((a, b) => a - b)

  if (entregues.length > 0) {
    const lista = entregues.length === 1
      ? `a sessão ${entregues[0]}`
      : `as sessões ${entregues.slice(0, -1).join(', ')} e ${entregues[entregues.length - 1]}`
    return {
      ok: false,
      entregues,
      erro: `Esta venda já tem ${entregues.length} sessão(ões) entregue(s) (${lista}), então o pacote inteiro não pode ser reagendado: as sessões seriam recriadas a partir da número 1 e colidiriam com as que já foram feitas. Para mudar as datas das que faltam, remarque uma a uma pelo prontuário.`,
    }
  }

  return {
    ok: true,
    substituir: sessoes.filter(s => (STATUS_SUBSTITUIVEIS as readonly string[]).includes(s.status)),
  }
}

/** O que a tela precisa saber antes de deixar alguém confirmar. */
export type SessaoResumivel = {
  status: string
  numero_sessao: number
  link_meet?: string | null
  google_event_id?: string | null
}

export type ResumoReagendamento = {
  /** Sessões que já existem nessa venda, de qualquer status. */
  total: number
  /** As que seriam apagadas e recriadas. */
  substituiveis: number
  /** As entregues, que bloqueiam a operação inteira (ver planejarReagendamentoTotal). */
  entregues: number
  /** Substituíveis que têm convite no Google hoje, ou seja, que o paciente perde. */
  comConvite: number
  bloqueado: boolean
}

/**
 * Contagens do que o "Agendar" faria nessa venda. Existe para a tela poder
 * avisar ANTES de confirmar: o link "Agendar" da tela do terapeuta também
 * chega em venda que já tem sessões (é como um pacote do Diagnóstico agendado
 * pelo Pedro aparece na lista de Pendentes da Denise), e ali confirmar não é
 * "criar", é "apagar e refazer" - apaga as sessões pendentes, cancela os
 * convites do paciente e recria o pacote inteiro com outra comissão.
 */
export function resumirReagendamentoTotal(sessoes: SessaoResumivel[]): ResumoReagendamento {
  const substituiveis = sessoes.filter(s => (STATUS_SUBSTITUIVEIS as readonly string[]).includes(s.status))
  const entregues = sessoes.filter(s => s.status === 'entregue')
  return {
    total: sessoes.length,
    substituiveis: substituiveis.length,
    entregues: entregues.length,
    comConvite: substituiveis.filter(s => !!(s.google_event_id || s.link_meet)).length,
    bloqueado: entregues.length > 0,
  }
}
