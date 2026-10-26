/**
 * Texto unico da etiqueta, usado nas cinco telas e no WhatsApp.
 *
 * `continuidade` (OPCIONAL): primeiro nome de quem da continuidade ao pacote
 * (Denise ou Leomir). So as telas do Pedro (overview/agenda) passam, pra ele
 * identificar de quem e a venda. O lembrete do WhatsApp do paciente NAO passa,
 * entao o texto dele continua sem esse sufixo.
 */
export function rotuloDiagnostico(params: {
  formato: 1 | 2 | 3
  numeroSessao: number
  totalSessoes: number
  continuidade?: string | null
}): string {
  const base = `Diagnóstico Guiado · Formato ${params.formato} · sessão ${params.numeroSessao} de ${params.totalSessoes}`
  return params.continuidade ? `${base} · continuidade: ${params.continuidade}` : base
}
