import { getSupabaseAdmin } from '@/lib/supabase'
import { eventoDoWebhook } from '@/lib/evento-do-webhook'
import { montarCatalogo } from '@/lib/funis/catalogo-dos-eventos'

async function main() {
  const sb = getSupabaseAdmin()
  const eventos: { plataforma: string; payload: Record<string, unknown> }[] = []
  const BATCH = 1000
  for (let from = 0; ; from += BATCH) {
    const { data, error } = await sb.from('webhook_events')
      .select('plataforma,payload').order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, from + BATCH - 1)
    if (error) throw error
    if (!data?.length) break
    for (const e of data) if (e.payload) eventos.push({ plataforma: e.plataforma, payload: eventoDoWebhook(e.plataforma, e.payload) })
    if (data.length < BATCH) break
  }
  const linhas = montarCatalogo(eventos)
  console.log('produtos no catálogo:', linhas.length)
  let ok = 0
  let falhas = 0
  for (const l of linhas) {
    const rotulo = `${l.plataforma}/${l.produto_id}`
    const falhou = (etapa: string, msg: string) => { falhas++; console.error(`FALHA ${etapa} em ${rotulo}: ${msg}`) }
    const { data: existente, error: errSel } = await sb.from('produtos_catalogo')
      .select('id,nome_exibicao,nomes').eq('plataforma', l.plataforma).eq('produto_id', l.produto_id).maybeSingle()
    if (errSel) { falhou('select', errSel.message); continue }
    if (existente) {
      const nomes = [...new Set([...(existente.nomes ?? []), ...l.nomes])]
      const { error } = await sb.from('produtos_catalogo').update({
        nomes, nome_exibicao: existente.nome_exibicao || l.nome_exibicao, updated_at: new Date().toISOString(),
      }).eq('id', existente.id)
      if (error) { falhou('update', error.message); continue }
    } else {
      const { error } = await sb.from('produtos_catalogo').insert({
        plataforma: l.plataforma, produto_id: l.produto_id, nome_exibicao: l.nome_exibicao, nomes: l.nomes,
      })
      if (error) { falhou('insert', error.message); continue }
    }
    ok++
  }
  console.log(`seeding terminou: ${ok} ok, ${falhas} falharam`)
  if (falhas > 0) process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })
