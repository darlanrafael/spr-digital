// O resumo que vai na faixa do topo de cada card do historico de fechamento da
// terapeuta: periodo apurado, quantos pacientes, e se houve antecipacao.
//
// POR QUE EXISTE (pedido do usuario em 11/09/2026): o historico da EMPRESA
// ganhou "o periodo apurado numa faixa no topo" em 17/08/2026 (registrado no
// spr-digital.md). O da terapeuta ficou de fora e mostrava so data de
// confirmacao, quantidade e valor - entao nao dava para saber, olhando o card,
// QUE periodo aquele pagamento cobriu.
//
// Isso importa porque a data de confirmacao NAO diz o periodo. O fechamento
// regularizado de 14/08/2026 e o exemplo: confirmado em 14/08, cobrindo sessoes
// entregues de 17/06 a 17/08. Sem a faixa, o card dizia "14/08/26, 15:00" e
// mais nada.
//
// O dado ja esta todo no snapshot gravado em `fechamentos_terapeutas.sessoes` -
// nao precisa consultar nada.

export type SessaoDoSnapshot = {
  sale_id?: string | null
  paciente_nome?: string | null
  data_entrega?: string | null
  data_agendada?: string | null
  comissao_valor?: number | null
}

export type ResumoDoFechamento = {
  /** A entrega mais antiga do snapshot, ISO. Null se o snapshot estiver vazio. */
  de: string | null
  /** A entrega mais recente, ISO. */
  ate: string | null
  /** Quantos pacientes distintos. Conta por `sale_id`, nao por nome. */
  pacientes: number
  /**
   * Sessoes pagas ANTES de serem entregues (antecipacao).
   *
   * Identificadas por nao ter `data_entrega`: a tela de antecipacao pega
   * sessoes `agendada`/`pendente`, que por definicao nao tem entrega. E a unica
   * marca que sobra no snapshot depois do fechamento.
   */
  antecipadas: number
}

/**
 * Conta por `sale_id` e nao por nome de proposito.
 *
 * O mesmo paciente aparece com nomes diferentes no sistema quando quem comprou
 * nao e quem e atendido - tres casos confirmados em 11/09/2026 (Billimaicon e
 * Raquel, Marcio e Lebian, Amanda e Julia). Contar por nome inflaria o numero
 * de pacientes; contar por venda nao.
 */
export function resumoDoFechamento(sessoes: SessaoDoSnapshot[] | null | undefined): ResumoDoFechamento {
  const lista = sessoes ?? []
  const entregas = lista.map(s => s.data_entrega).filter((d): d is string => !!d).sort()
  const vendas = new Set(lista.map(s => s.sale_id).filter(Boolean))

  return {
    de: entregas[0] ?? null,
    ate: entregas[entregas.length - 1] ?? null,
    pacientes: vendas.size,
    antecipadas: lista.filter(s => !s.data_entrega).length,
  }
}
