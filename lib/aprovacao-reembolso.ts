// Decide o que fazer com as sessões de uma solicitação de reembolso no momento
// em que o CEO aprova. Vive fora da rota pelo mesmo motivo de
// lib/reagendamento-total.ts: só assim dá para provar num teste que a recusa
// acontece ANTES de cancelar qualquer coisa, em vez de confiar na ordem das
// linhas de um handler.

export type SessaoDaSolicitacao = {
  id: string
  numero_sessao: number
  status: string
  google_event_id: string | null
}

export type DecisaoAprovacao =
  | { ok: false; motivo: 'sessao_ja_entregue'; numeros: number[] }
  | { ok: true; cancelar: string[]; eventosACancelar: string[] }

export function planejarAprovacaoReembolso(sessoes: SessaoDaSolicitacao[]): DecisaoAprovacao {
  // A solicitação fica parada esperando o CEO, e nesse intervalo uma das
  // sessões pedidas pode ter sido ENTREGUE (a de Miguel Pires ficou 8 dias na
  // fila e a sessão 2 foi atendida nesse meio tempo). Aprovar assim
  // reescreveria para 'cancelada' um atendimento que aconteceu, e o valor do
  // reembolso foi calculado contando com ela. Quanto devolver por sessão já
  // prestada é decisão de negócio, não de código: recusa e diz qual mudou.
  const entregues = sessoes.filter(s => s.status === 'entregue')
  if (entregues.length > 0) {
    return { ok: false, motivo: 'sessao_ja_entregue', numeros: entregues.map(s => s.numero_sessao).sort((a, b) => a - b) }
  }

  // Sessão já cancelada não é erro: aprovar duas vezes, ou aprovar um pedido
  // que se sobrepõe a outro já aprovado, tem que ser inofensivo. Ela só não
  // entra de novo na lista, e o evento dela já foi cancelado antes.
  const pendentes = sessoes.filter(s => s.status !== 'cancelada')

  return {
    ok: true,
    cancelar: pendentes.map(s => s.id),
    eventosACancelar: pendentes.map(s => s.google_event_id).filter((id): id is string => !!id),
  }
}
