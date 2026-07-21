// Dispara um aviso imediato (fora do fluxo normal de véspera/30-min) quando
// uma sessão é agendada pro mesmo dia — "venda de encaixe". O n8n recebe os
// dados brutos, monta as mensagens (grupo + paciente, com "faltam X minutos"
// calculado na hora) e já marca os lembretes de 30 min como enviados, pra o
// cron normal não mandar de novo depois.
export type DadosEncaixe = {
  sessao_id: string
  terapeuta_id: string
  grupo_whatsapp_id: string | null
  paciente_nome: string
  paciente_telefone: string | null
  numero_sessao: number
  total_sessoes: number
  data_agendada: string
  link_meet: string | null
}

export async function notificarEncaixe(dados: DadosEncaixe): Promise<void> {
  const url = process.env.N8N_ENCAIXE_WEBHOOK_URL
  if (!url) return
  if (!dados.grupo_whatsapp_id) return // sem grupo configurado pro terapeuta, sem o que avisar
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dados),
    })
  } catch (err) {
    console.error('[notificar-encaixe] falha ao chamar webhook:', err)
  }
}
