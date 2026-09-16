// lib/identidade-da-chamada.ts
//
// QUEM esta chamando, e o que essa pessoa pode.
//
// A identidade vem dos cabecalhos que o `middleware.ts` escreve - e que ele
// APAGA antes de escrever, justamente para ninguem forjar mandando o cabecalho
// direto.
//
// As regras vivem aqui, puras e com teste proprio, e nao espalhadas nas rotas:
// espalhadas, cada rota vira uma chance de escrever a regra um pouco diferente.

import { CABECALHOS_DA_IDENTIDADE } from './cabecalhos-da-identidade'

export type Identidade = {
  /** `sistema` = modulo de terapeutas; `dashboard` = DRE financeiro. */
  area: 'sistema' | 'dashboard'
  /** `sistema`: admin | comercial | terapeuta. `dashboard`: admin | socio | gestor | financeiro. */
  papel: string
  id: string
  email: string
  /** So terapeuta tem. E o `terapeuta_id` dela. */
  terapeutaId: string | null
}

export function lerIdentidade(req: Request): Identidade | null {
  // Os nomes vem da constante, nunca escritos a mao aqui: o middleware escreve
  // e esta funcao le, e se os dois textos divergirem a identidade some sem
  // erro nenhum - toda rota passaria a recusar, ou pior, a nao restringir.
  const tipo = req.headers.get(CABECALHOS_DA_IDENTIDADE.tipo)
  const id = req.headers.get(CABECALHOS_DA_IDENTIDADE.id)
  if (!tipo || !id) return null
  const [area, papel] = tipo.split(':')
  if (area !== 'sistema' && area !== 'dashboard') return null
  if (!papel) return null
  return {
    area,
    papel,
    id,
    email: req.headers.get(CABECALHOS_DA_IDENTIDADE.email) ?? '',
    terapeutaId: req.headers.get(CABECALHOS_DA_IDENTIDADE.terapeutaId),
  }
}

/**
 * Sentinela para terapeuta do sistema SEM `terapeuta_id` vinculado (cadastro
 * incompleto, erro de dado - o campo e `string | null` no banco).
 *
 * Nunca pode ser `'all'` nem coincidir com um `terapeuta_id` real: toda linha
 * de `terapeuta_id` no banco e um UUID nao vazio, entao string vazia nunca
 * bate com nenhuma. Quem filtra por este valor (`.eq('terapeuta_id', valor)`,
 * o padrao usado nas rotas) volta lista vazia - fail-CLOSED. A alternativa
 * (cair no `pedido ?? 'all'`) e o furo que motivou o projeto inteiro,
 * reaberto na direcao pior: sem id proprio, a pessoa veria TUDO.
 */
const SEM_TERAPEUTA_VINCULADO = ''

/**
 * O `terapeuta_id` que vale para esta chamada.
 *
 * Para TERAPEUTA, o parametro do cliente e SEMPRE ignorado - mesmo quando
 * falta o `terapeuta_id` proprio. E o furo que motivou o trabalho: hoje a
 * rota obedece o parametro, e a Denise pedindo `all` recebe o faturamento do
 * Pedro. Chavear em "tem terapeutaId" em vez de em "e terapeuta" reabriria o
 * mesmo furo pela porta de tras: uma terapeuta com `terapeuta_id` nulo
 * pediria `all` e receberia o faturamento de todo mundo. Por isso o guarda
 * abaixo e so `area === 'sistema' && papel === 'terapeuta'` - sem o `&&
 * id.terapeutaId` que havia aqui antes - e quem nao tem vinculo cai no
 * sentinela, nao no pedido.
 *
 * Para todos os outros o parametro vale. O comercial agenda para as duas
 * terapeutas, e o socio do DRE fica com a visualizacao de hoje por decisao do
 * usuario.
 */
export function terapeutaIdQueValeu(id: Identidade, pedido: string | null): string {
  if (id.area === 'sistema' && id.papel === 'terapeuta') return id.terapeutaId || SEM_TERAPEUTA_VINCULADO
  return pedido ?? 'all'
}

/** Criar usuario, trocar senha, mudar percentual de comissao. So admin. */
export function podeAdministrar(id: Identidade): boolean {
  return id.papel === 'admin'
}

/** A divisao entre socios some para o socio - a regra ja existia na tela. */
export function deveEsconderDivisaoDeSocios(id: Identidade): boolean {
  return id.area === 'dashboard' && id.papel === 'socio'
}
