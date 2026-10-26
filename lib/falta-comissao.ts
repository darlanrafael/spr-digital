// lib/falta-comissao.ts
//
// A regra do "nao compareceu" (falta): o que acontece com a sessao e com a
// comissao quando um terapeuta marca que o paciente faltou.
//
// Decisao do dono (25/10/2026, corrigida em 26/10/2026 - v2):
//   - A falta sempre faz o paciente PERDER a sessao: ela vira `entregue` (o
//     pacote anda e ela sai dos "Pendentes de conclusao") e fica registrada no
//     prontuario. Isso vale pra TODOS os terapeutas.
//   - A comissao NUNCA e zerada. A sessao e apenas TRAVADA
//     (`comissao_bloqueada = true`) quando ha comissao em jogo:
//       - Socio (Pedro): sempre trava; recebe no fechamento; nao cria aprovacao.
//       - Contratado COM comissao (Denise/Leomir): trava e cria uma "falta
//         aguardando aprovacao". Pagar desbloqueia a sessao (comissao intacta);
//         Nao pagar mantem a sessao travada.
//       - Contratado SEM comissao: nada a travar, nada a decidir.
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
    comissao_bloqueada: boolean
  }
  ocorrenciaTitulo: string
  ocorrenciaDesc: string
  /** Cria "falta aguardando aprovacao"? So pra contratado COM comissao. */
  criarFalta: boolean
}

export function planejarFalta(params: {
  ehSocio: boolean
  temComissao: boolean
  numeroSessao: number
  usuarioNome: string
  agoraMs: number
}): PlanoDaFalta {
  const { ehSocio, temComissao, numeroSessao, usuarioNome, agoraMs } = params
  const now = new Date(agoraMs).toISOString()
  const horaLocal = new Date(agoraMs).toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
  })
  return {
    updateData: {
      status: 'entregue',
      status_consulta: 'nao_compareceu',
      data_entrega: now,
      concluido_em: now,
      entregue_confirmado_por: usuarioNome,
      comissao_bloqueada: ehSocio || temComissao,
    },
    ocorrenciaTitulo: `Paciente Não Compareceu — Sessão ${numeroSessao}`,
    ocorrenciaDesc: `Paciente não compareceu à sessão. Registrado por ${usuarioNome} às ${horaLocal}`,
    criarFalta: !ehSocio && temComissao,
  }
}

/**
 * A decisao do dono sobre uma falta pendente.
 *   - 'pagar'     -> falta aprovada; a sessao e desbloqueada (comissao intacta).
 *   - 'nao_pagar' -> falta negada; a sessao continua travada.
 */
export function decisaoDaFalta(
  decisao: 'pagar' | 'nao_pagar',
): { novoStatusFalta: 'aprovado' | 'negado'; desbloquear: boolean } {
  return decisao === 'pagar'
    ? { novoStatusFalta: 'aprovado', desbloquear: true }
    : { novoStatusFalta: 'negado', desbloquear: false }
}
