import { getSupabaseAdmin } from '@/lib/supabase'
import { produtoDoEventoHubla, produtoDoEventoKiwify } from '@/lib/produto-do-evento'

function orderIdDoPayload(plataforma: string, p: Record<string, unknown>): string | null {
  if (plataforma === 'kiwify') return (p?.order_id as string) ?? null
  // Hubla: o order_id da venda é derivado (canonicalParentId-productId) no parser;
  // casar por invoice.id base não é confiável aqui. Em vez disso, casar por
  // (email + produto) via o próprio nome e deixar o match por produto_id nulo
  // para o caminho de nome. Para Hubla, preferir atualizar por order_id só quando
  // o payload trouxer invoice.id sem sufixo -offer; senão, pular (o nome resolve).
  const invoice = p?.invoice as Record<string, unknown> | undefined
  const invId = (invoice?.id as string) ?? null
  return invId ? invId.replace(/-offer-\d+$/, '') : null
}

async function main() {
  const sb = getSupabaseAdmin()
  let preenchidas = 0
  const BATCH = 1000
  for (let from = 0; ; from += BATCH) {
    const { data, error } = await sb.from('webhook_events').select('plataforma,payload').range(from, from + BATCH - 1)
    if (error) throw error
    if (!data?.length) break
    for (const e of data) {
      const p = e.payload as Record<string, unknown>
      if (!p) continue
      const prod = e.plataforma === 'hubla' ? produtoDoEventoHubla(p) : produtoDoEventoKiwify(p)
      if (!prod) continue
      const base = orderIdDoPayload(e.plataforma, p)
      if (!base) continue
      // Casa por order_id "começa com" o base (Hubla deriva "-produtoId"); só nulos.
      const { data: alvo } = await sb.from('sales').select('id,order_id,produto_id')
        .eq('plataforma', e.plataforma).is('produto_id', null).like('order_id', `${base}%`)
      for (const v of alvo ?? []) {
        await sb.from('sales').update({ produto_id: prod.produto_id }).eq('id', v.id)
        preenchidas++
      }
    }
    if (data.length < BATCH) break
  }
  console.log('vendas preenchidas com produto_id:', preenchidas)
}
main().catch(e => { console.error(e); process.exit(1) })
