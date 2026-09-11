// Registra na tela da Denise o pagamento que foi feito por FORA dela.
//
// O QUE ACONTECEU (11/09/2026, explicado pelo usuario):
// o fechamento de agosto (`close_1786730418948`, FECHAMENTO TERAPEUTA - DENISE,
// 07/07 a 14/08) foi feito na tela da EMPRESA. Ela apura periodo e faturamento,
// calcula a retirada dos socios e deduz a parte da terapeuta - R$ 1.724,34 -, e
// o usuario repassou esse valor a ela.
//
// O que faltou: fazer TAMBEM o fechamento na tela dela. E a unica tela que
// marca `comissao_paga = true`. Nas palavras dele: *"eu ja paguei muitas dela
// no fechamento de agosto"* e *"esqueci de fazer o fechamento no sistema dela"*.
//
// Resultado: as sessoes ficaram como nao pagas e voltaram para a fila. A tela
// dela mostra 32 sessoes pendentes (R$ 2.704,92) quando 18 delas ja foram pagas.
//
// EM JULHO O FLUXO FOI CERTO, e serve de controle: houve o fechamento da
// empresa (`close_1783569268675`, repasse R$ 3.319,38) E o da tela dela
// (`fechamentos_terapeutas`, R$ 3.370,24, 37 sessoes). Em agosto faltou o
// segundo.
//
// QUAIS SESSOES: as das 7 vendas que estao em `compradores` do fechamento de
// agosto. Escolha do usuario entre duas leituras possiveis, e e a que casa com
// o dinheiro: 18 sessoes somando R$ 1.739,81 contra R$ 1.724,34 deduzidos -
// diferenca de R$ 15,47, que vem do jeito diferente de calcular (a tela da
// empresa aplica o percentual sobre o liquido do PRODUTO no periodo; a sessao
// carrega a comissao calculada por VENDA).
//
// A alternativa descartada era "todas as entregues ate 14/08": 21 sessoes,
// R$ 1.653,04, diferenca de R$ 71,30. Fica registrada para nao ser refeita.
//
// Roda em ensaio por padrao. So grava com --gravar.
import { config } from 'dotenv'
config({ path: '.env.local' })
// Nenhum efeito externo: sem WhatsApp, sem n8n, sem Calendar.
delete process.env.N8N_ENCAIXE_WEBHOOK_URL
delete process.env.N8N_ALERTA_WEBHOOK_URL
delete process.env.N8N_BASE_URL
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

const GRAVAR = process.argv.includes('--gravar')
const CLOSING_ID = 'close_1786730418948'
const REPASSE_NO_FECHAMENTO = 1724.3394405000001

const brt = (s?: string | null) => s ? new Date(new Date(s).getTime() - 3 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16) : '-'
const brl = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function main() {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: ter } = await c.from('terapeutas').select('id,nome').ilike('nome', '%denise%')
  const denise = (ter ?? [])[0]
  if (!denise) throw new Error('terapeuta Denise nao encontrada')

  const { data: cl } = await c.from('closings')
    .select('id,etiqueta,periodo_inicio,periodo_fim,repasse_terapeutas_total,compradores,data_confirmacao')
    .eq('id', CLOSING_ID).single()
  if (!cl) throw new Error('fechamento de agosto nao encontrado')
  if (Math.abs(Number(cl.repasse_terapeutas_total) - REPASSE_NO_FECHAMENTO) > 0.01) {
    throw new Error(`repasse do fechamento mudou: ${cl.repasse_terapeutas_total}`)
  }

  const vendaIds = [...new Set(((cl.compradores as { id: string }[]) ?? []).map(b => b.id).filter(Boolean))]
  console.log(`fechamento ${cl.id} | ${cl.etiqueta} | ${cl.periodo_inicio} a ${cl.periodo_fim}`)
  console.log(`confirmado em ${brt(cl.data_confirmacao)} | repasse a terapeuta ${brl(Number(cl.repasse_terapeutas_total))}`)
  console.log(`${vendaIds.length} vendas nos compradores\n`)

  // Exatamente as colunas que a tela dela grava no snapshot, para o historico
  // ficar igual ao de um fechamento feito pela tela.
  const { data: ss } = await c.from('sessoes')
    .select('id,sale_id,numero_sessao,total_sessoes,comissao_valor,data_entrega,data_agendada,paciente_nome,status,comissao_paga')
    .eq('terapeuta_id', denise.id)
    .in('sale_id', vendaIds)
    .eq('status', 'entregue')
    .eq('comissao_paga', false)
    .order('data_entrega')

  const alvo = ss ?? []
  if (alvo.length === 0) { console.log('Nada a marcar - ja esta regularizado.'); return }

  const { data: vs } = await c.from('sales').select('id,nome').in('id', vendaIds)
  const nomeV = new Map((vs ?? []).map(v => [v.id, String(v.nome)]))

  let total = 0
  console.log('sessoes que serao marcadas como PAGAS:')
  for (const s of alvo) {
    total += Number(s.comissao_valor ?? 0)
    console.log(`  ${brt(s.data_entrega)} | ${String(s.paciente_nome ?? nomeV.get(s.sale_id)).slice(0, 34).padEnd(34)} | ${s.numero_sessao}/${s.total_sessoes} | ${brl(Number(s.comissao_valor))}`)
  }
  console.log(`\n  ${alvo.length} sessoes  ${brl(total)}`)
  console.log(`  o fechamento deduziu ${brl(Number(cl.repasse_terapeutas_total))} - diferenca ${brl(total - Number(cl.repasse_terapeutas_total))}`)

  // O que sobra pendente depois disto.
  const { data: resto } = await c.from('sessoes').select('comissao_valor')
    .eq('terapeuta_id', denise.id).eq('status', 'entregue').eq('comissao_paga', false)
  const sobra = (resto ?? []).filter(r => !alvo.some(a => a.comissao_valor === r.comissao_valor))
  console.log(`\n  pendentes hoje: ${resto?.length} sessoes`)
  console.log(`  pendentes depois: ${(resto?.length ?? 0) - alvo.length} sessoes`)

  if (!GRAVAR) { console.log('\n== ENSAIO. nada gravado. rode com --gravar =='); return }

  // Snapshot no MESMO formato da tela, sem os campos de controle.
  const snapshot = alvo.map(({ status, comissao_paga, ...s }) => s)
  const fechamentoId = randomUUID()
  const { error: e1 } = await c.from('fechamentos_terapeutas').insert({
    id: fechamentoId,
    terapeuta_id: denise.id,
    terapeuta_nome: denise.nome,
    valor_total: total,
    quantidade_sessoes: alvo.length,
    sessoes: snapshot,
    criado_por_nome: 'Rafael (regularizacao)',
    criado_por_email: 'darlan.rafael@yahoo.com.br',
    // A data do fechamento da EMPRESA, nao a de hoje: o pagamento ocorreu em
    // agosto e o historico dela tem que refletir quando o dinheiro saiu.
    data_confirmacao: cl.data_confirmacao,
  })
  if (e1) throw e1

  const { error: e2 } = await c.from('sessoes')
    .update({ comissao_paga: true })
    .in('id', alvo.map(s => s.id))
  if (e2) throw e2

  await c.from('atividades_log').insert({
    usuario_nome: 'Rafael',
    usuario_tipo: 'admin',
    acao: 'fechamento_terapeuta_regularizado',
    detalhe: `Regularizacao: ${alvo.length} sessoes da Denise marcadas como pagas, `
      + `${brl(total)}, referentes ao fechamento da empresa ${CLOSING_ID} `
      + `(${cl.etiqueta}, ${cl.periodo_inicio} a ${cl.periodo_fim}), que deduziu `
      + `${brl(Number(cl.repasse_terapeutas_total))} de repasse e foi pago por fora da tela dela. `
      + `Fechamento criado: ${fechamentoId}.`,
  })

  const { data: conf } = await c.from('sessoes').select('id')
    .eq('terapeuta_id', denise.id).eq('status', 'entregue').eq('comissao_paga', false)
  console.log('\n== GRAVADO ==')
  console.log(` fechamento ${fechamentoId} | ${alvo.length} sessoes | ${brl(total)}`)
  console.log(` pendentes agora: ${conf?.length}`)
}
main().then(() => process.exit(0)).catch(e => { console.error('ABORTADO:', e.message ?? e); process.exit(1) })
