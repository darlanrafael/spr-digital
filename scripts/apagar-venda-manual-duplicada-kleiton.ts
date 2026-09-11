// Apaga a venda manual DUPLICADA do Kleiton e as 4 sessoes dela.
//
// O CASO (levantado pelo usuario em 11/09/2026): o Kleiton tem tres vendas.
//
//   12/06  KIWIFY  Mentoria Particular - Pedro Roncada  pago 2860  liq 2714,80  0 sessoes
//   30/07  MANUAL  Mentoria Particular - DENISE         pago 2860  liq 0        4 sessoes  <- ERRADA
//   30/07  MANUAL  Mentoria Particular - Pedro Roncada  pago 2860  liq 0        4 sessoes  <- certa
//
// As duas manuais foram criadas no mesmo dia, com 5 minutos e 21 segundos de
// diferenca (16:09:03 e 16:14:24), pelo Guilherme Vargas. A primeira saiu com o
// produto da DENISE e o valor do PEDRO - R$ 2.860 e a tabela dele (1300/1550/
// 2860/5280); a dela e 550/790/1400/2640. Ele refez certo e nao apagou a errada.
//
// A CAUSA e o defeito corrigido em 09/09 no commit b4fd658: *"O campo de
// terapeuta vinha de `terapeutas[0]`, e a lista chega do banco com
// `.order('nome')` - ou seja, sempre a Denise."* O campo abria na Denise por
// ordem alfabetica. A causa raiz ja esta corrigida; isto limpa o dado que ela
// deixou.
//
// EFEITO: as 4 sessoes poluiam a contagem da tela de pagamento da Denise (32
// em vez de 28). Nao houve dano em dinheiro: comissao R$ 0,00 em todas, e
// `comissao_paga = false` - conferido nos dois fechamentos dela.
//
// EVENTOS DO GOOGLE: duas das quatro sessoes tem link do Meet, mas as duas
// datas JA PASSARAM (10/07 e 13/07). Os eventos NAO sao cancelados de
// proposito: cancelar evento passado dispara e-mail de cancelamento para o
// paciente sobre um compromisso de dois meses atras, e nao limpa nada que
// importe. Se for para apagar, e decisao separada.
//
// Roda em ensaio por padrao. So grava com --gravar.
import { config } from 'dotenv'
config({ path: '.env.local' })
// Nenhum efeito externo: sem WhatsApp, sem n8n, sem Calendar.
delete process.env.N8N_ENCAIXE_WEBHOOK_URL
delete process.env.N8N_ALERTA_WEBHOOK_URL
delete process.env.N8N_BASE_URL
import { createClient } from '@supabase/supabase-js'

const GRAVAR = process.argv.includes('--gravar')
const VENDA_ERRADA = 'manual_1785438543275_9eavlc'
const VENDA_CERTA = 'manual_1785438864459_gn7e25'

const brt = (s?: string | null) => s ? new Date(new Date(s).getTime() - 3 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16) : '-'

async function main() {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: v } = await c.from('sales').select('*').eq('id', VENDA_ERRADA).maybeSingle()
  if (!v) { console.log('A venda ja nao existe. Nada a fazer.'); return }

  // Guardas: se qualquer uma falhar, o alvo nao e o que eu penso.
  if (!String(v.produto).toLowerCase().includes('denise')) throw new Error(`produto inesperado: ${v.produto}`)
  if (Number(v.valor_liquido) !== 0) throw new Error(`liquido nao e zero: ${v.valor_liquido}`)
  if (!String(v.nome).toLowerCase().includes('kleiton')) throw new Error(`nome inesperado: ${v.nome}`)

  // A venda CERTA tem que existir antes de apagar a errada.
  const { data: ok } = await c.from('sales').select('id,produto').eq('id', VENDA_CERTA).maybeSingle()
  if (!ok) throw new Error('a venda manual CERTA nao existe - abortando para nao deixar o paciente sem sessao')
  const { data: ssOk } = await c.from('sessoes').select('id').eq('sale_id', VENDA_CERTA)
  if ((ssOk ?? []).length !== 4) throw new Error(`a venda certa tem ${ssOk?.length} sessoes, esperava 4`)

  const { data: ss } = await c.from('sessoes').select('*').eq('sale_id', VENDA_ERRADA).order('numero_sessao')
  console.log(`venda: ${v.id}`)
  console.log(`  ${v.nome} | ${v.produto} | pago ${v.valor_pago_cliente} | liquido ${v.valor_liquido}`)
  console.log(`  criada em ${brt(v.created_at)}`)
  console.log(`\nsessoes que serao apagadas: ${ss?.length}`)
  for (const s of ss ?? []) {
    if (s.comissao_paga) throw new Error(`sessao ${s.id} esta marcada como PAGA - abortando`)
    if (Number(s.comissao_valor) !== 0) throw new Error(`sessao ${s.id} tem comissao ${s.comissao_valor} - abortando`)
    console.log(`  ${s.numero_sessao}/4 ${brt(s.data_agendada)} | ${s.status} | comissao R$ ${s.comissao_valor} | paga=${s.comissao_paga} | meet=${s.link_meet ? 'SIM (evento passado, nao sera cancelado)' : 'nao'}`)
  }

  // Tudo que aponta para essas linhas, para nada ficar orfao.
  const idsSessao = (ss ?? []).map(s => s.id)
  const { data: oc } = await c.from('ocorrencias_prontuario').select('id,tipo,descricao,created_at').eq('sale_id', VENDA_ERRADA)
  const { data: ocS } = idsSessao.length
    ? await c.from('ocorrencias_prontuario').select('id,tipo,created_at').in('sessao_id', idsSessao)
    : { data: [] as unknown[] }
  console.log(`\nocorrencias no prontuario ligadas a venda: ${oc?.length ?? 0}`)
  for (const o of oc ?? []) console.log(`  ${brt(o.created_at)} ${o.tipo}: ${String(o.descricao ?? '').slice(0, 120)}`)
  console.log(`ocorrencias ligadas as sessoes: ${(ocS as unknown[])?.length ?? 0}`)

  const { data: sol } = await c.from('solicitacoes_reembolso').select('id').eq('sale_id', VENDA_ERRADA)
  console.log(`solicitacoes de reembolso: ${sol?.length ?? 0}`)
  if ((sol ?? []).length > 0) throw new Error('existe solicitacao de reembolso apontando para esta venda - abortando')

  console.log('\ndepois de apagar, o Kleiton fica com:')
  console.log(`  a venda REAL da Kiwify (o dinheiro, liquido R$ 2.714,80)`)
  console.log(`  a venda manual CERTA: ${VENDA_CERTA} | ${ok.produto} | 4 sessoes do Pedro`)

  if (!GRAVAR) { console.log('\n== ENSAIO. nada apagado. rode com --gravar ==') ; return }

  // Ordem: ocorrencias -> sessoes -> venda. O contrario deixaria orfao se
  // falhasse no meio.
  if ((oc ?? []).length > 0) {
    const { error } = await c.from('ocorrencias_prontuario').delete().eq('sale_id', VENDA_ERRADA)
    if (error) throw error
  }
  if ((ocS as { id: string }[])?.length > 0) {
    const { error } = await c.from('ocorrencias_prontuario').delete().in('sessao_id', idsSessao)
    if (error) throw error
  }
  const { error: e1 } = await c.from('sessoes').delete().eq('sale_id', VENDA_ERRADA)
  if (e1) throw e1
  const { error: e2 } = await c.from('sales').delete().eq('id', VENDA_ERRADA)
  if (e2) throw e2

  await c.from('atividades_log').insert({
    usuario_nome: 'Rafael',
    usuario_tipo: 'admin',
    acao: 'venda_manual_duplicada_apagada',
    detalhe: `Apagada a venda manual ${VENDA_ERRADA} (Kleiton gabriel ribeiro yamacake, `
      + `"Mentoria Particular - Denise Nascimento", R$ 2.860, liquido 0) e suas 4 sessoes. `
      + `Era duplicata criada as 16:09:03 de 30/07/2026, 5min21s antes da correta `
      + `(${VENDA_CERTA}, produto do Pedro, 16:14:24). O produto era da Denise e o valor da `
      + `tabela do Pedro. Causa: campo de terapeuta abria na Denise por ordem alfabetica, `
      + `corrigido em 09/09 no commit b4fd658. Nenhuma comissao envolvida (R$ 0,00, nao paga). `
      + `Eventos passados do Google nao foram cancelados de proposito.`,
  })

  const { data: rest } = await c.from('sales').select('id,produto').ilike('nome', '%kleiton%')
  const { data: sobra } = await c.from('sessoes').select('id').eq('sale_id', VENDA_ERRADA)
  console.log('\n== APAGADO ==')
  console.log(` sessoes restantes da venda apagada: ${sobra?.length ?? 0}`)
  console.log(` vendas do Kleiton no sistema: ${rest?.length}`)
  for (const r of rest ?? []) console.log(`   ${r.id} | ${r.produto}`)
}
main().then(() => process.exit(0)).catch(e => { console.error('ABORTADO:', e.message ?? e); process.exit(1) })
