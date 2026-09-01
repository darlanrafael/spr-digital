/** Texto unico da etiqueta, usado nas cinco telas e no WhatsApp. */
export function rotuloDiagnostico(params: {
  formato: 1 | 2 | 3
  numeroSessao: number
  totalSessoes: number
}): string {
  return `Diagnóstico Guiado · Formato ${params.formato} · sessão ${params.numeroSessao} de ${params.totalSessoes}`
}
