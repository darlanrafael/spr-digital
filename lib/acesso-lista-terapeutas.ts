export type TerapeutaSessionMin = { tipo: string; terapeuta_id: string | null } | null

/**
 * Para onde a tela /terapeutas/lista deve mandar o usuário - ou `null` pra
 * deixar ele ver a lista.
 *
 * Mesma precedência do layout (app/terapeutas/layout.tsx:27): quem tem sessão
 * de admin do dashboard (`temAdmin`) vê a lista inteira, mesmo que o navegador
 * também guarde um login de terapeuta. Isso é o que faltava aqui: a página só
 * olhava o `terapeutas_session` e expulsava o Pedro - que é admin E terapeuta
 * (duas contas, mesmo email) - pro próprio painel, enquanto o layout já o
 * deixava entrar em todo o resto do módulo.
 *
 * Só o terapeuta "puro" (sem sessão de admin) é mandado pro próprio painel - e
 * o layout já faria isso de qualquer jeito; este guard só evita qualquer flash.
 */
export function destinoDaListaDeTerapeutas(
  temAdmin: boolean,
  sessao: TerapeutaSessionMin,
): string | null {
  if (temAdmin) return null
  if (sessao && sessao.tipo === 'terapeuta' && sessao.terapeuta_id) {
    return `/terapeutas/${sessao.terapeuta_id}`
  }
  return null
}
