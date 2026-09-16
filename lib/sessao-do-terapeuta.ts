// lib/sessao-do-terapeuta.ts
import type { Identidade } from './identidade-da-chamada'

/**
 * Esta pessoa pode agir NESTA sessao?
 *
 * So restringe TERAPEUTA. Comercial e admin agendam e remarcam para as duas -
 * e o trabalho deles - e o socio do DRE fica com o acesso de hoje, por decisao
 * do usuario.
 *
 * Sessao sem `terapeuta_id` definido NAO libera terapeuta: dado incompleto nao
 * pode virar porta.
 */
export function podeAgirNaSessao(quem: Identidade, terapeutaIdDaSessao: string | null): boolean {
  if (quem.area !== 'sistema' || quem.papel !== 'terapeuta') return true
  if (!quem.terapeutaId || !terapeutaIdDaSessao) return false
  return quem.terapeutaId === terapeutaIdDaSessao
}
