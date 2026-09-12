// Agrupa as sessoes da tela de pagamento da terapeuta por PRODUTO.
//
// Pedido do usuario em 11/09/2026: *"E importante termos uma organizacao no
// painel da Denise. Separar sessoes de acordo com os produtos"*.
//
// POR QUE IMPORTA, e nao e so arrumacao: os produtos pagam de formas
// diferentes, e misturados a coluna de comissao parece aleatoria.
//
//   Mentoria Particular   percentual sobre o liquido da venda  -> R$ 88,22,
//                                                                 R$ 99,47,
//                                                                 R$ 141,86...
//   Diagnostico Guiado    FIXO por sessao                      -> R$ 95,00
//
// E na lista de futuras o ganho e maior: sao 74 sessoes em 7 paginas. Agrupadas,
// aparece de cara que o compromisso futuro com a Denise e R$ 6.080,00 de
// Diagnostico contra R$ 882,16 de Mentoria - numero que hoje esta escondido na
// paginacao.

export type SessaoParaAgrupar = {
  id: string
  sale_id: string
  produto?: string | null
  comissao_valor: number
  data_entrega?: string | null
  data_agendada?: string | null
}

export type GrupoDeProduto<T extends SessaoParaAgrupar> = {
  produto: string
  sessoes: T[]
  total: number
  /**
   * O valor por sessao, quando TODAS as sessoes do grupo valem o mesmo.
   * Null quando variam.
   *
   * E o que distingue os dois regimes na tela sem precisar explicar: o
   * Diagnostico mostra "R$ 95,00 por sessao", a Mentoria nao mostra nada
   * porque cada venda tem o seu percentual.
   */
  valorPorSessao: number | null
}

const SEM_PRODUTO = 'Sem produto identificado'

/**
 * Os grupos, do maior valor para o menor.
 *
 * Ordena por VALOR e nao por quantidade: quem abre a tela quer saber onde esta
 * o dinheiro. Na lista de futuras da Denise isso poe o Diagnostico em cima
 * (R$ 6.080,00 em 64 sessoes) na frente da Mentoria (R$ 882,16 em 10).
 */
export function agruparPorProduto<T extends SessaoParaAgrupar>(sessoes: T[]): GrupoDeProduto<T>[] {
  const mapa = new Map<string, T[]>()
  for (const s of sessoes) {
    // Produto vazio ganha rotulo proprio em vez de virar string vazia na tela:
    // sessao sem venda correspondente e sinal de problema, nao de nada.
    const k = (s.produto ?? '').trim() || SEM_PRODUTO
    if (!mapa.has(k)) mapa.set(k, [])
    mapa.get(k)!.push(s)
  }

  const grupos: GrupoDeProduto<T>[] = []
  for (const [produto, lista] of mapa) {
    const total = Math.round(lista.reduce((a, s) => a + Number(s.comissao_valor ?? 0), 0) * 100) / 100
    const distintos = new Set(lista.map(s => Number(s.comissao_valor ?? 0)))
    grupos.push({
      produto,
      sessoes: lista,
      total,
      valorPorSessao: distintos.size === 1 ? [...distintos][0] : null,
    })
  }

  // Empate de valor resolvido pelo nome, para a ordem nao mudar entre
  // renderizacoes com os mesmos dados.
  return grupos.sort((a, b) => b.total - a.total || a.produto.localeCompare(b.produto))
}

/** O total de todos os grupos. Serve para conferir com o total da tela. */
export function totalDosGrupos<T extends SessaoParaAgrupar>(grupos: GrupoDeProduto<T>[]): number {
  return Math.round(grupos.reduce((a, g) => a + g.total, 0) * 100) / 100
}
