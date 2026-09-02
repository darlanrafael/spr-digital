// Vendas cujo PRODUTO foi corrigido à mão depois de entrar no sistema.
//
// Por que isto existe: na apuração do fechamento o usuário cruza os números do
// sistema com o painel da plataforma. Quando uma venda muda de produto aqui e
// não lá, os dois nunca batem - filtrar "Mentoria Particular - Pedro Roncada"
// na Hubla mostra a venda da Paula, e no sistema ela não aparece mais, porque
// virou Diagnóstico. Sem um aviso, isso vira meia hora procurando um erro que
// não existe.
//
// A lista é curta e escrita à mão de propósito: readequação é evento raro,
// manual e auditado. Cada entrada precisa dizer o que a plataforma ainda
// mostra, para a conferência fechar sem investigação.

export type ReadequacaoProduto = {
  saleId: string
  cliente: string
  /** O que a PLATAFORMA ainda mostra. É por aqui que a conferência não bate. */
  produtoNaPlataforma: string
  /** O que o sistema passou a contar. */
  produtoNoSistema: string
  /** Data da venda, em BRT, para casar com a janela do fechamento. */
  data: string
  valor: number
  plataforma: string
  motivo: string
}

export const READEQUACOES_PRODUTO: ReadequacaoProduto[] = [
  {
    saleId: '27a669a3-dad9-4c8f-ae93-bca82bb13e90',
    cliente: 'Paula Caroline',
    produtoNaPlataforma: 'Mentoria Particular - Pedro Roncada',
    produtoNoSistema: 'Diagnóstico Guiado: Programa de acompanhamento Individual',
    data: '2026-08-28',
    valor: 4997,
    plataforma: 'Hubla',
    motivo: 'O comercial fechou um Diagnóstico Guiado por uma oferta criada dentro do produto de Mentoria. Corrigido em 02/09/2026, com o formato confirmado pelo usuário.',
  },
]

/**
 * Readequações cuja venda cai na janela do fechamento. É nesse recorte que a
 * conferência contra a plataforma acontece, então avisar fora dele só
 * poluiria a tela.
 */
export function readequacoesDoPeriodo({
  inicio,
  fim,
  readequacoes = READEQUACOES_PRODUTO,
}: {
  inicio: string
  fim: string
  readequacoes?: ReadequacaoProduto[]
}): ReadequacaoProduto[] {
  if (!inicio || !fim) return []
  return readequacoes
    .filter(r => r.data >= inicio && r.data <= fim)
    .sort((a, b) => a.data.localeCompare(b.data))
}
