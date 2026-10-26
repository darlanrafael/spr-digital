// lib/falta-comissao.ts
//
// A regra do "nao compareceu" (falta): o que acontece com a sessao e com a
// comissao quando um terapeuta marca que o paciente faltou.
//
// Decisao do dono (25/10/2026):
//   - A falta sempre faz o paciente PERDER a sessao: ela vira `entregue` (o
//     pacote anda e ela sai dos "Pendentes de conclusao") e fica registrada no
//     prontuario. Isso vale pra TODOS os terapeutas.
//   - A comissao e caso a caso, so pra Denise/Leomir: a sessao sai com
//     `comissao_valor = 0` (nao conta) e cria uma "falta aguardando aprovacao"
//     guardando o valor original. O dono decide Pagar (volta o valor) ou Nao
//     pagar (continua 0).
//   - Pedro nao recebe por aqui (e socio, recebe no fechamento): a sessao sai
//     com comissao 0 e NAO cria aprovacao.
//
// Logica pura (sem banco) pra poder testar a regra isolada; as escritas ficam
// na rota. Ver item 125 do spr-digital.md.

export type PlanoDaFalta = {
  updateData: {
    status: 'entregue'
    status_consulta: 'nao_compareceu'
    data_entrega: string
    concluido_em: string
    entregue_confirmado_por: string
    comissao_valor: 0
  }
  ocorrenciaTitulo: string
  ocorrenciaDesc: string
  /** Cria "falta aguardando aprovacao"? So pra nao-Pedro COM comissao a decidir. */
  criarFalta: boolean
  /** O valor que fica guardado na falta (e que volta pra sessao se aprovado). */
  faltaComissaoValor: number
}

export function planejarFalta(params: {
  ehPedro: boolean
  comissaoValorSessao: number
  numeroSessao: number
  usuarioNome: string
  agoraMs: number
}): PlanoDaFalta {
  const { ehPedro, comissaoValorSessao, numeroSessao, usuarioNome, agoraMs } = params
  const now = new Date(agoraMs).toISOString()
  const horaLocal = new Date(agoraMs).toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
  })
  const criarFalta = !ehPedro && comissaoValorSessao > 0
  return {
    updateData: {
      status: 'entregue',
      status_consulta: 'nao_compareceu',
      data_entrega: now,
      concluido_em: now,
      entregue_confirmado_por: usuarioNome,
      comissao_valor: 0,
    },
    ocorrenciaTitulo: `Paciente Não Compareceu — Sessão ${numeroSessao}`,
    ocorrenciaDesc: `Paciente não compareceu à sessão. Registrado por ${usuarioNome} às ${horaLocal}`,
    criarFalta,
    faltaComissaoValor: criarFalta ? comissaoValorSessao : 0,
  }
}

/**
 * A decisao do dono sobre uma falta pendente.
 *   - 'pagar'     -> falta aprovada; a comissao volta pro valor original.
 *   - 'nao_pagar' -> falta negada; a comissao da sessao continua 0.
 */
export function decisaoDaFalta(
  decisao: 'pagar' | 'nao_pagar',
  comissaoOriginal: number,
): { novoStatusFalta: 'aprovado' | 'negado'; comissaoDaSessao: number } {
  return decisao === 'pagar'
    ? { novoStatusFalta: 'aprovado', comissaoDaSessao: comissaoOriginal }
    : { novoStatusFalta: 'negado', comissaoDaSessao: 0 }
}
