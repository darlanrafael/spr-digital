export type ProdutoDoEvento = { plataforma: 'hubla' | 'kiwify'; produto_id: string; nome: string }

/** O produto-base da venda Hubla. `event.product.id` é o catálogo (NÃO o offers[].id). */
export function produtoDoEventoHubla(event: Record<string, unknown>): ProdutoDoEvento | null {
  const product = event?.product as Record<string, unknown> | undefined
  const id = product?.id as string | undefined
  if (!id) return null
  return { plataforma: 'hubla', produto_id: id, nome: (product?.name as string) ?? '' }
}

/** O produto-base da venda Kiwify (`order.Product.product_id`). */
export function produtoDoEventoKiwify(order: Record<string, unknown>): ProdutoDoEvento | null {
  const product = order?.Product as Record<string, unknown> | undefined
  const id = product?.product_id as string | undefined
  if (!id) return null
  return { plataforma: 'kiwify', produto_id: id, nome: (product?.product_name as string) ?? '' }
}
