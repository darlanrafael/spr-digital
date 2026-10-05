// Desembrulha o envelope de um payload guardado em webhook_events.
// Hubla aninha o evento em payload.event; Kiwify manda o order no topo (ou em payload.order).
export function eventoDoWebhook(plataforma: string, payload: Record<string, unknown>): Record<string, unknown> {
  const p = payload ?? {}
  if (plataforma === 'hubla') return (p.event as Record<string, unknown>) ?? p
  if (plataforma === 'kiwify') return (p.order as Record<string, unknown>) ?? p
  return p
}
