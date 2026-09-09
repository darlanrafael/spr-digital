// Sincroniza o nome/e-mail do paciente das SESSOES com o da VENDA.
//
// Existe porque a rota de editar paciente gravava so em `sales` ate 09/09/2026
// (corrigido em d238ef5). As sessoes criadas antes disso ficaram com a copia
// velha, e e ela que o Overview, a agenda e o lembrete de WhatsApp leem.
//
// TRAVA DE SEGURANCA: so sincroniza quando o E-MAIL da sessao e o da venda sao
// o mesmo. Nome diferente com e-mail diferente nao e correcao de nome, e outra
// pessoa - sincronizar apagaria o nome de quem de fato fez a sessao.
//
// Ensaio por padrao. So grava com --gravar.
import { config } from 'dotenv'
config({ path: '.env.local' })
delete process.env.N8N_ENCAIXE_WEBHOOK_URL
delete process.env.N8N_ALERTA_WEBHOOK_URL
delete process.env.N8N_BASE_URL
import { createClient } from '@supabase/supabase-js'

const GRAVAR = process.argv.includes('--gravar')
const igual = (a: unknown, b: unknown) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const sess: any[] = []; let cur = ''
  while (true) {
    let q = db.from('sessoes').select('id,sale_id,paciente_nome,paciente_email').order('id').limit(999)
    if (cur) q = q.gt('id', cur)
    const { data } = await q
    if (!data || !data.length) break
    sess.push(...data); cur = data[data.length - 1].id
    if (data.length < 999) break
  }
  const ids = [...new Set(sess.map(x => x.sale_id).filter((i: string) => !String(i).startsWith('manual_')))]
  const vendas: any[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from('sales').select('id,nome,email').in('id', ids.slice(i, i + 200))
    vendas.push(...(data ?? []))
  }
  const porId = new Map(vendas.map(v => [v.id, v]))

  const sincronizar: any[] = [], recusadas: any[] = []
  for (const s of sess) {
    const v = porId.get(s.sale_id)
    if (!v) continue
    if (igual(v.nome, s.paciente_nome) && igual(v.email, s.paciente_email)) continue
    if (igual(v.email, s.paciente_email)) sincronizar.push({ s, v })
    else recusadas.push({ s, v })
  }

  console.log(GRAVAR ? '>>> GRAVANDO <<<' : '>>> ENSAIO <<<')
  console.log(`a sincronizar: ${sincronizar.length} sessoes | recusadas por e-mail diferente: ${recusadas.length}\n`)
  const vistos = new Set<string>()
  for (const { s, v } of sincronizar) {
    if (!vistos.has(s.sale_id)) {
      vistos.add(s.sale_id)
      console.log(`  "${s.paciente_nome}" -> "${v.nome}"  (${sincronizar.filter(x => x.s.sale_id === s.sale_id).length} sessoes)`)
    }
    if (GRAVAR) {
      const { error } = await db.from('sessoes')
        .update({ paciente_nome: String(v.nome).trim(), paciente_email: String(v.email).trim() })
        .eq('id', s.id)
      if (error) console.log(`    FALHOU sessao ${s.id}: ${error.message}`)
    }
  }
  if (recusadas.length) {
    console.log('\n  RECUSADAS (e-mail diferente, precisa de decisao humana):')
    const vr = new Set<string>()
    for (const { s, v } of recusadas) {
      if (vr.has(s.sale_id)) continue
      vr.add(s.sale_id)
      console.log(`    sessao: "${s.paciente_nome}" / ${s.paciente_email}`)
      console.log(`    venda:  "${v.nome}" / ${v.email}`)
    }
  }
  if (!GRAVAR) console.log('\nPara gravar: npx tsx scripts/sincronizar-nome-nas-sessoes.ts --gravar')
}
main()
