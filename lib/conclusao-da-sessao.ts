// lib/conclusao-da-sessao.ts
//
// A regra de "concluir uma sessao" (marcar como entregue): o que grava na
// linha de `sessoes`, o que vira ocorrencia no prontuario e o que vai pro log.
//
// Mora aqui, pura, pra que DOIS caminhos usem a MESMA regra sem copiar:
//   - o botao ✓ verde individual (PATCH /api/terapeutas/sessoes, acao=concluir)
//   - o "concluir varias de uma vez" (POST /api/terapeutas/sessoes/concluir-lote)
// Se cada um montasse o objeto por conta propria, uma sessao concluida em lote
// divergiria de uma concluida no botao - mesma classe de bug do oferta_nome.

import { brasiliaLocalToISO } from './terapeutas-auth'

export type Conclusao = {
  updateData: {
    status_consulta: 'concluida'
    status: 'entregue'
    data_entrega: string
    concluido_em: string
    entregue_confirmado_por: string
  }
  ocorrenciaTipo: 'confirmacao_entrega'
  ocorrenciaTitulo: string
  ocorrenciaDesc: string
  logAcao: 'confirmacao_entrega'
}

/**
 * Esta sessao pode ser concluida (marcada entregue)? So quem ainda esta
 * `agendada`/`pendente`. Uma sessao ja `entregue` nao pode: reconcluir
 * reescreveria a data_entrega, duplicaria a ocorrencia no prontuario e o log
 * de comissao. O lote usa isto pra pular silenciosamente os ids que nao cabem.
 */
export function sessaoConcluivel(status: string | null | undefined): boolean {
  return status === 'agendada' || status === 'pendente'
}

export function montarConclusaoDaSessao(params: {
  numeroSessao: number
  usuarioNome: string
  /** String do <input datetime-local> quando a data de entrega foi informada a
   *  mao. Ausente/null => usa o instante atual (`agoraMs`). O lote sempre usa
   *  agora; so o botao individual oferece data manual. */
  dataEntregaManual?: string | null
  agoraMs: number
}): Conclusao {
  const { numeroSessao, usuarioNome, dataEntregaManual, agoraMs } = params
  const now = new Date(agoraMs).toISOString()
  const horaLocal = new Date(agoraMs).toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
  })
  const dataEntregaFinal = dataEntregaManual ? brasiliaLocalToISO(dataEntregaManual) : now

  return {
    updateData: {
      status_consulta: 'concluida',
      status: 'entregue',
      data_entrega: dataEntregaFinal,
      concluido_em: now,
      entregue_confirmado_por: usuarioNome,
    },
    ocorrenciaTipo: 'confirmacao_entrega',
    ocorrenciaTitulo: `Consulta Concluída — Sessão ${numeroSessao}`,
    ocorrenciaDesc: dataEntregaManual
      ? `Consulta concluída por ${usuarioNome} (data de entrega informada manualmente: ${new Date(dataEntregaFinal).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })})`
      : `Consulta concluída por ${usuarioNome} às ${horaLocal}`,
    logAcao: 'confirmacao_entrega',
  }
}
