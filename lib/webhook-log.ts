import { getSupabaseAdmin } from '@/lib/supabase'

// Auditoria permanente de todo webhook recebido — sem isso, uma vez que um
// evento é tratado como "duplicata"/"ignorado" não há como saber depois se
// aquilo foi uma decisão correta ou uma venda real descartada silenciosamente
// (só ficava em console.log, que expira nos logs da Vercel).
// Nunca deve derrubar o processamento do webhook — best-effort.
export async function logWebhookEvent(params: {
  plataforma: 'hubla' | 'kiwify'
  tipoEvento: string
  resultado: string
  saleId?: string | null
  detalhe?: string | null
  payload: unknown
}) {
  try {
    const client = getSupabaseAdmin()
    await client.from('webhook_events').insert({
      plataforma: params.plataforma,
      tipo_evento: params.tipoEvento,
      resultado: params.resultado,
      sale_id: params.saleId ?? null,
      detalhe: params.detalhe ?? null,
      payload: params.payload,
    })
  } catch (err) {
    console.error('[webhook-log] falha ao registrar evento:', err)
  }
}
