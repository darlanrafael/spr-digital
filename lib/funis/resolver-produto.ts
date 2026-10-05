export type ProdutoCatalogo = { plataforma: string; produto_id: string; nomes: string[] }
export type VendaParaResolver = { plataforma: string; produto_id: string | null; produto: string }

export function normalizarNome(s: string): string {
  return (s ?? '').trim().toLowerCase()
}

export function resolverProdutoId(
  venda: VendaParaResolver,
  catalogo: ProdutoCatalogo[],
): { plataforma: string; produto_id: string } | null {
  if (venda.produto_id) return { plataforma: venda.plataforma, produto_id: venda.produto_id }
  const alvo = normalizarNome(venda.produto)
  if (!alvo) return null
  const achado = catalogo.find(c =>
    c.plataforma === venda.plataforma && c.nomes.some(n => normalizarNome(n) === alvo),
  )
  return achado ? { plataforma: achado.plataforma, produto_id: achado.produto_id } : null
}
