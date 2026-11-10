// Aviso amarelo da tela de Funis sobre a Meta (dono 10/11/2026, Task 5 do plano
// docs/superpowers/plans/2026-11-10-botao-resgate-funis.md).

export const AVISO_SEM_TOKEN = 'Os dados da Meta estão indisponíveis no momento. Verifique a conexão/token.'
export const AVISO_META_INCOMPLETA = 'A Meta não respondeu por completo. O Investido, o ROAS e os anúncios podem estar menores do que o real. Clique em Atualizar.'

/** Texto do aviso do resumo, ou null. Na visao geral, a falha do diario nao entra (ela nao usa o diario). */
export function avisoDoResumoMeta(o: { semToken: boolean; falhouCampanhas: boolean; falhouDiario: boolean; visaoGeral: boolean }): string | null {
  const partes: string[] = []
  if (o.semToken) partes.push(AVISO_SEM_TOKEN)
  if (o.falhouCampanhas || (!o.visaoGeral && o.falhouDiario)) partes.push(AVISO_META_INCOMPLETA)
  return partes.length ? partes.join(' ') : null
}
