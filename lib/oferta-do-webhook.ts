// De onde sai o nome da oferta em cada plataforma, e o que a correção
// "offer é autoritativo" da Hubla precisa reescrever.
//
// O nome da oferta é a fonte da QUANTIDADE de sessões do pacote. Ele já chegava
// nos dois webhooks e era jogado fora até 02/09/2026. Um webhook que pare de
// gravá-lo não quebra nada visível: a venda entra, a tela abre, e só o
// agendamento passa a dizer "não foi possível determinar a quantidade".
export function ofertaDoEventoHubla(event: Record<string, unknown> | null | undefined): string | null {
  const produtos = (event?.products as Record<string, unknown>[]) ?? []
  const ofertas = (produtos[0]?.offers as Record<string, unknown>[]) ?? []
  return ((ofertas[0]?.name as string) ?? '').trim() || null
}

export function ofertaDoProdutoKiwify(product: Record<string, unknown> | null | undefined): string | null {
  return ((product?.product_offer_name as string) ?? '').trim() || null
}

export type ValoresDaVenda = {
  preco_base: number
  valor_pago_cliente: number
  valor_liquido: number
  oferta_nome: string | null
}

/**
 * O que a Hubla reescreve quando o webhook no formato `-offer-N` chega DEPOIS
 * do formato simples, que gravou o valor somado do bundle inteiro.
 *
 * O offer é autoritativo também no nome da oferta: deixá-lo de fora fazia a
 * correção de valor apagar a informação que manda no agendamento.
 */
export function correcaoAutoritativaDoOffer(sale: ValoresDaVenda): ValoresDaVenda {
  return {
    preco_base: sale.preco_base,
    valor_pago_cliente: sale.valor_pago_cliente,
    valor_liquido: sale.valor_liquido,
    oferta_nome: sale.oferta_nome,
  }
}
