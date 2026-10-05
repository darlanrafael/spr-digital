import { getSupabaseAdmin } from '@/lib/supabase'
import { montarCatalogo } from '@/lib/funis/catalogo-dos-eventos'

async function main() {
  const sb = getSupabaseAdmin()
  const eventos: { plataforma: string; payload: Record<string, unknown> }[] = []
  const BATCH = 1000
  for (let from = 0; ; from += BATCH) {
    const { data, error } = await sb.from('webhook_events')
      .select('plataforma,payload').range(from, from + BATCH - 1)
    if (error) throw error
    if (!data?.length) break
    for (const e of data) if (e.payload) eventos.push({ plataforma: e.plataforma, payload: e.payload })
    if (data.length < BATCH) break
  }
  const linhas = montarCatalogo(eventos)
  console.log('produtos no catálogo:', linhas.length)
  for (const l of linhas) {
    const { data: existente } = await sb.from('produtos_catalogo')
      .select('id,nome_exibicao,nomes').eq('plataforma', l.plataforma).eq('produto_id', l.produto_id).maybeSingle()
    if (existente) {
      const nomes = [...new Set([...(existente.nomes ?? []), ...l.nomes])]
      await sb.from('produtos_catalogo').update({
        nomes, nome_exibicao: existente.nome_exibicao || l.nome_exibicao, updated_at: new Date().toISOString(),
      }).eq('id', existente.id)
    } else {
      await sb.from('produtos_catalogo').insert({
        plataforma: l.plataforma, produto_id: l.produto_id, nome_exibicao: l.nome_exibicao, nomes: l.nomes,
      })
    }
  }
  console.log('seeding concluído')
}
main().catch(e => { console.error(e); process.exit(1) })
