// Quando duas compras do mesmo paciente são o MESMO pacote.
//
// Regra combinada com o usuário em 03/09/2026, depois de medir os 56 pares de
// compras consecutivas do mesmo paciente e produto no banco:
//
//   "Vai ter situações que o paciente vai comprar quatro sessões mesmo. E aí
//    depois ele compra mais quatro. Então é importante a gente definir um
//    prazo. [...] Porque se espaça muito a gente entende que ele comprou um
//    pacote de quatro sessões, consumiu e depois comprou outra de quatro."
//
// O sistema NUNCA junta sozinho: ele propõe e o comercial confirma. Sempre
// existirá caso na fronteira (a Ana Assis ficou de fora por 30 minutos), e quem
// sabe o que aconteceu é quem vendeu.

/**
 * Janela para considerar duas compras como o mesmo pacote.
 *
 * 24h porque o dado tem um vale ali: os pares colados estão em 0h, 0h, 0,1h,
 * 0,1h, 9,8h e 15,3h, e o próximo está em 24,5h. Não é linha arbitrária.
 */
export const JANELA_MESMO_PACOTE_HORAS = 24

export type VendaCandidata = {
  id: string
  email: string | null
  produto: string
  data_hora: string
  ofertaNome?: string | null
  precoBase?: number | null
  /** Sessões já ENTREGUES nesta venda. */
  entregues: number
  /** Já faz parte de outro pacote. */
  pacotePaiId?: string | null
}

/**
 * Procura, entre as outras compras do paciente, uma que possa ser o mesmo
 * pacote desta. Devolve `null` quando não há candidata.
 */
export function candidataAoMesmoPacote(params: {
  venda: VendaCandidata
  outras: VendaCandidata[]
}): VendaCandidata | null {
  const { venda, outras } = params
  const email = (venda.email ?? '').trim().toLowerCase()
  if (!email) return null
  const quando = new Date(venda.data_hora).getTime()
  if (Number.isNaN(quando)) return null
  const janelaMs = JANELA_MESMO_PACOTE_HORAS * 60 * 60 * 1000

  const possiveis = outras.filter(o => {
    if (o.id === venda.id) return false
    if ((o.email ?? '').trim().toLowerCase() !== email) return false
    if (o.produto !== venda.produto) return false
    // Já pertence a um pacote: não é candidata a formar outro.
    if (o.pacotePaiId) return false
    // O critério mais forte, e mais forte que o relógio: se o outro pacote já
    // foi consumido, é cliente comprando de novo, não pagamento dividido. Caso
    // real: a Jessica Garcia comprou de novo 9,8h depois COM as 4 sessões da
    // primeira já entregues.
    if (o.entregues > 0) return false
    const t = new Date(o.data_hora).getTime()
    if (Number.isNaN(t)) return false
    return Math.abs(t - quando) <= janelaMs
  })

  if (possiveis.length === 0) return null
  // A mais próxima no tempo. Com mais de uma candidata, a vizinha imediata é a
  // que o comercial tem em mente.
  return possiveis.sort((a, b) =>
    Math.abs(new Date(a.data_hora).getTime() - quando) - Math.abs(new Date(b.data_hora).getTime() - quando))[0]
}

/** Vendas que compõem um pacote: a que carrega as sessões e as ligadas a ela. */
export function vendasDoPacote<T extends { id: string; pacotePaiId?: string | null }>(
  principal: T,
  todas: T[],
): T[] {
  return [principal, ...todas.filter(v => v.pacotePaiId === principal.id)]
}
