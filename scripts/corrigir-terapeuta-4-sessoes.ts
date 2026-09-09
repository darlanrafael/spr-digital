// Move para o Pedro as 4 sessoes que foram parar na Denise por causa do modal
// que abria no primeiro terapeuta da lista (ordem alfabetica).
//
// Confirmado pelo usuario em 09/09/2026: "DENISE NAO ATENDEU". As duas vendas
// sao do produto "Mentoria Particular - Pedro Roncada", entao as sessoes sao
// dele. O Pedro e socio a 0%, entao a comissao vai a zero.
//
// Nenhuma comissao foi paga (as 4 estao com comissao_paga = false), entao nao
// ha acerto de contas a fazer - so o cadastro.
//
// Ensaio por padrao. So grava com --gravar.
import { config } from 'dotenv'
config({ path: '.env.local' })
delete process.env.N8N_ENCAIXE_WEBHOOK_URL
delete process.env.N8N_ALERTA_WEBHOOK_URL
delete process.env.N8N_BASE_URL
import { createClient } from '@supabase/supabase-js'

const GRAVAR = process.argv.includes('--gravar')
const brt = (i: string) => new Date(new Date(i).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ')

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: teraps } = await db.from('terapeutas').select('id,nome,percentual_comissao')
  const T = new Map((teraps ?? []).map((x: any) => [x.id, x]))
  const pedro: any = (teraps ?? []).find((x: any) => String(x.nome).toLowerCase().includes('pedro'))

  // Acha de novo pelo mesmo criterio da auditoria, em vez de usar ids fixos:
  // se o dado mudou desde a varredura, e melhor nao achar do que corrigir
  // errado.
  const sess: any[] = []; let cur = ''
  while (true) {
    let q = db.from('sessoes').select('id,sale_id,paciente_nome,terapeuta_id,data_agendada,comissao_valor,comissao_paga').order('id').limit(999)
    if (cur) q = q.gt('id', cur)
    const { data } = await q
    if (!data || !data.length) break
    sess.push(...data); cur = data[data.length - 1].id
    if (data.length < 999) break
  }
  const ids = [...new Set(sess.map(s => s.sale_id))]
  const vendas: any[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from('sales').select('id,produto').in('id', ids.slice(i, i + 200))
    vendas.push(...(data ?? []))
  }
  const V = new Map(vendas.map(v => [v.id, v.produto]))

  const alvo = sess.filter(s => {
    const prod = String(V.get(s.sale_id) ?? '').toLowerCase()
    const ter = String(T.get(s.terapeuta_id)?.nome ?? '').toLowerCase().split(' ')[0]
    if (!ter || prod.includes('|') || prod.includes('diagn') || prod.includes('grupo')) return false
    return !prod.includes(ter)
  })

  console.log(GRAVAR ? '>>> GRAVANDO <<<' : '>>> ENSAIO <<<')
  console.log(`sessoes divergentes encontradas: ${alvo.length}\n`)
  if (alvo.length !== 4) {
    console.log('ATENCAO: esperava 4. O dado mudou desde a auditoria - conferir antes de gravar.')
    if (GRAVAR) return
  }

  let total = 0
  for (const s of alvo.sort((a, b) => String(a.data_agendada).localeCompare(String(b.data_agendada)))) {
    total += s.comissao_valor ?? 0
    console.log(`  ${brt(s.data_agendada)} | ${String(s.paciente_nome).slice(0, 24).padEnd(24)} | ${T.get(s.terapeuta_id)?.nome} -> ${pedro.nome}`)
    console.log(`      comissao R$ ${s.comissao_valor} -> R$ 0 | paga=${s.comissao_paga}`)
    if (s.comissao_paga) { console.log('      COMISSAO JA PAGA - nao mexer, precisa de acerto de contas'); continue }
    if (!GRAVAR) continue
    const { error } = await db.from('sessoes')
      .update({ terapeuta_id: pedro.id, comissao_valor: 0 }).eq('id', s.id)
    if (error) { console.log(`      FALHOU: ${error.message}`); continue }
    await db.from('atividades_log').insert({
      usuario_nome: 'Rafael (correcao de terapeuta)', usuario_tipo: 'admin',
      tipo_acao: 'remarcacao', sessao_id: s.id, sale_id: s.sale_id,
      descricao: `Terapeuta corrigido de ${T.get(s.terapeuta_id)?.nome} para ${pedro.nome}: a venda e do produto "${V.get(s.sale_id)}" e a Denise nao atendeu (confirmado em 09/09/2026). Comissao de R$ ${s.comissao_valor} zerada; nao havia sido paga.`,
    })
  }
  console.log(`\n  comissao total corrigida: R$ ${total.toFixed(2)}`)
  if (!GRAVAR) console.log('\nPara gravar: npx tsx scripts/corrigir-terapeuta-4-sessoes.ts --gravar')
}
main()
