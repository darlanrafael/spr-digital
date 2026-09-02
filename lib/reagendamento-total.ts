// Regras do reagendamento total (o "Agendar" apontado para uma venda que JÁ
// tem sessões). Vale para TODOS os produtos, não só para o Diagnóstico Guiado.
//
// Por que existe como módulo separado e puro: a decisão de recusar precisa
// acontecer ANTES de qualquer efeito colateral (apagar sessão, cancelar convite
// no Google), e a única forma de provar isso num teste automatizado é ter a
// decisão fora da rota, sem banco e sem rede.

/**
 * Status que o reagendamento total substitui (apaga e recria). Qualquer outro
 * status SOBREVIVE ao delete - hoje 'entregue' e 'cancelada', e amanhã o que
 * mais for criado. É essa sobrevivência que importa pra trava abaixo, não o
 * nome do status.
 */
export const STATUS_SUBSTITUIVEIS = ['pendente', 'agendada', 'remarcada'] as const

export function ehSubstituivel(status: string): boolean {
  return (STATUS_SUBSTITUIVEIS as readonly string[]).includes(status)
}

export type SessaoExistente = {
  id: string
  status: string
  numero_sessao: number
  google_event_id: string | null
}

export type PlanoReagendamento =
  | { ok: true; substituir: SessaoExistente[] }
  | { ok: false; erro: string; entregues: number[]; colidem: number[] }

function listar(numeros: number[]): string {
  return numeros.length === 1
    ? `a sessão ${numeros[0]}`
    : `as sessões ${numeros.slice(0, -1).join(', ')} e ${numeros[numeros.length - 1]}`
}

/**
 * Decide se dá para reagendar o pacote inteiro desta venda e, se der, devolve
 * exatamente quais sessões serão apagadas (com o evento do Google a cancelar).
 *
 * `totalASerCriado` é quantas sessões o insert vai gravar (numeradas de 1 até
 * ele). Sem esse número não dá pra saber se o pacote novo colide com o que
 * sobra no banco.
 *
 * Por que recusar: o reagendamento apaga só as substituíveis e recria a
 * numeração a partir da 1. Com QUALQUER sessão sobrevivente ocupando um número
 * dessa faixa, o insert bate no unique (sale_id, numero_sessao) e devolve
 * 23505 - só que nesse ponto as pendentes JÁ foram apagadas e os convites do
 * paciente JÁ foram cancelados no Google. O usuário via uma mensagem de erro
 * de banco e ficava com o pacote pela metade, sem forma de voltar atrás.
 * Medido em 01/09/2026: 32 vendas do banco estão nesse estado misto, com 64
 * sessões pendentes que têm evento no Calendar.
 *
 * Olhar só o status 'entregue' não bastava: 'cancelada' também sobrevive ao
 * delete (é o que /aprovacoes grava ao aprovar reembolso parcial, sem mexer no
 * numero_sessao) e destruía o pacote exatamente do mesmo jeito. A trava é por
 * SOBREVIVÊNCIA + numeração, então cobre também qualquer status que venha a
 * existir depois.
 */
export function planejarReagendamentoTotal(
  sessoes: SessaoExistente[],
  totalASerCriado: number,
): PlanoReagendamento {
  // Sem um total confiável, assume o pior caso (toda sobrevivente colide) em
  // vez de liberar a destruição: errar pra recusa é reversível, errar pro
  // outro lado apaga o pacote do paciente.
  const total = Number.isFinite(totalASerCriado) ? totalASerCriado : Infinity

  const entregues = sessoes
    .filter(s => s.status === 'entregue')
    .map(s => s.numero_sessao)
    .sort((a, b) => a - b)

  // Entregue bloqueia sempre, mesmo fora da faixa 1..N: refazer o pacote
  // reescreveria o total_sessoes e a comissão de um atendimento que já
  // aconteceu e já pode ter sido pago. Mensagem própria porque é o caso que o
  // comercial mais encontra e a saída dele (remarcar uma a uma) é específica.
  if (entregues.length > 0) {
    return {
      ok: false,
      entregues,
      colidem: [],
      erro: `Esta venda já tem ${entregues.length} sessão(ões) entregue(s) (${listar(entregues)}), então o pacote inteiro não pode ser reagendado: as sessões seriam recriadas a partir da número 1 e colidiriam com as que já foram feitas. Para mudar as datas das que faltam, remarque uma a uma pelo prontuário.`,
    }
  }

  // Qualquer outra sobrevivente (hoje 'cancelada') ocupando 1..N: o delete não
  // a leva e o insert bate nela.
  const colidem = sessoes
    .filter(s => !ehSubstituivel(s.status) && s.numero_sessao <= total)
    .sort((a, b) => a.numero_sessao - b.numero_sessao)

  if (colidem.length > 0) {
    const numeros = colidem.map(s => s.numero_sessao)
    const statusList = [...new Set(colidem.map(s => s.status))].join(', ')
    return {
      ok: false,
      entregues,
      colidem: numeros,
      erro: `Esta venda tem ${colidem.length} sessão(ões) que o reagendamento não apaga (${listar(numeros)}, com status ${statusList}) ocupando a numeração do pacote novo. Refazer o pacote criaria as sessões de 1 a ${Number.isFinite(total) ? total : '?'} e elas colidiriam com essa(s): o banco recusaria a gravação DEPOIS de as sessões pendentes terem sido apagadas e os convites do paciente cancelados. Para mudar as datas das que faltam, remarque uma a uma pelo prontuário.`,
    }
  }

  return {
    ok: true,
    substituir: sessoes.filter(s => ehSubstituivel(s.status)),
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
  /** Sobreviventes não entregues que colidiriam com a numeração 1..N do pacote novo. */
  colidem: number[]
  /** Substituíveis que têm convite no Google hoje, ou seja, que o paciente perde. */
  comConvite: number
  bloqueado: boolean
  /** Por que está bloqueado - a tela precisa explicar a coisa certa. */
  motivoBloqueio: 'entregue' | 'numeracao' | null
}

/**
 * Contagens do que o "Agendar" faria nessa venda. Existe para a tela poder
 * avisar ANTES de confirmar: o link "Agendar" da tela do terapeuta também
 * chega em venda que já tem sessões (é como um pacote do Diagnóstico agendado
 * pelo Pedro aparece na lista de Pendentes da Denise), e ali confirmar não é
 * "criar", é "apagar e refazer" - apaga as sessões pendentes, cancela os
 * convites do paciente e recria o pacote inteiro com outra comissão.
 *
 * Mesma regra de planejarReagendamentoTotal, de propósito: se a tela e a rota
 * discordassem, a pessoa veria botão verde e receberia erro 400 na cara.
 */
export function resumirReagendamentoTotal(
  sessoes: SessaoResumivel[],
  totalASerCriado: number,
): ResumoReagendamento {
  const total = Number.isFinite(totalASerCriado) ? totalASerCriado : Infinity
  const substituiveis = sessoes.filter(s => ehSubstituivel(s.status))
  const entregues = sessoes.filter(s => s.status === 'entregue')
  const colidem = sessoes
    .filter(s => !ehSubstituivel(s.status) && s.status !== 'entregue' && s.numero_sessao <= total)
    .map(s => s.numero_sessao)
    .sort((a, b) => a - b)
  const motivoBloqueio = entregues.length > 0
    ? 'entregue' as const
    : colidem.length > 0 ? 'numeracao' as const : null
  return {
    total: sessoes.length,
    substituiveis: substituiveis.length,
    entregues: entregues.length,
    colidem,
    comConvite: substituiveis.filter(s => !!(s.google_event_id || s.link_meet)).length,
    bloqueado: motivoBloqueio !== null,
    motivoBloqueio,
  }
}
