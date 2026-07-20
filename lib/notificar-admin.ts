// Dispara um alerta pro admin via webhook do n8n — o n8n decide quem recebe
// (números configurados só lá dentro) e como formata a mensagem. Sem webhook
// configurado, isso é um no-op silencioso (mesmo padrão de lib/google-meet.ts
// quando as credenciais do Google não estão setadas) — nunca lança erro,
// porque um alerta que falha não pode derrubar o fluxo principal que o chamou.
export async function notificarAdmin(mensagem: string): Promise<void> {
  const url = process.env.N8N_ALERTA_WEBHOOK_URL
  if (!url) return
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mensagem }),
    })
  } catch (err) {
    console.error('[notificar-admin] falha ao chamar webhook:', err)
  }
}
