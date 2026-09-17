export type ResumoReconciliacao = {
  recuperadas: { plataforma: string; cliente: string; produto: string; valor: number; order_id: string }[]
  naoRecuperadas: { plataforma: string; cliente: string; produto: string; motivo: string }[]
}

/** Avisa por WhatsApp (via n8n) o que a reconciliacao fez. Best-effort: nunca lanca. */
export async function alertarReconciliacao(resumo: ResumoReconciliacao): Promise<void> {
  const url = process.env.N8N_RECONCILIACAO_WEBHOOK_URL
  if (!url) return
  if (resumo.recuperadas.length === 0 && resumo.naoRecuperadas.length === 0) return
  try {
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(resumo) })
  } catch (err) {
    console.error('[alerta-reconciliacao] falha ao avisar:', err)
  }
}
