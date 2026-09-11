// Converte para reais a venda da Hubla que entrou em moeda estrangeira.
//
// Caso: Rosana Martins Afonso, 05/09/2026, fatura 1f0890b1-26e4-4b2b-b255-
// 0a8b1d38f24d. Primeira venda internacional da Hubla no sistema (1 em 1.992
// eventos). O webhook nao le o campo de moeda, entao gravou euro e dolar como
// se fossem reais - e o alerta de conferencia do fechamento pegou pelo sintoma:
// liquido (dolar) maior que o pago (euro).
//
// A cadeia real, confirmada no painel da Hubla e no payload:
//
//   cliente pagou        EUR 319,55   (= 259,80 da oferta + 23% de IVA)
//   Hubla liquidou em    USD 360,12   (= 292,78 + 67,34 de IVA)
//   - IVA de Portugal    USD  67,34   retido na fonte, nunca foi dinheiro nosso
//   - taxa Hubla 4,8%    USD  14,05
//   = repasse ao vendedor USD 278,73
//
// A Hubla paga em DOLAR e nao converte - nao existe valor em reais no painel
// dela. Cambio definido pelo usuario em 11/09/2026: "vamos considerar 5,00".
// A cotacao oficial nao serve de referencia direta aqui porque 05/09/2026 foi
// SABADO e o Banco Central nao publica PTAX em fim de semana (as uteis vizinhas
// foram 5,1253 em 04/09 e 5,0856 em 08/09).
//
// O mapeamento segue a semantica que a Hubla ja tem no sistema, campo por
// campo, para a linha do fechamento fechar sozinha:
//
//   preco_base         = subtotal  -> a venda sem o IVA
//   valor_pago_cliente = subtotal  -> vira o faturamento BRUTO (getSaleBruto)
//   valor_com_juros    = total     -> vira a base do imposto (getImpostoBase)
//   valor_liquido      = repasse   -> o que a Hubla deposita
//
// Com isso: taxas = bruto - liquido = 70,25, que e exatamente a taxa da Hubla
// convertida. O IVA de Portugal fica fora do bruto de proposito: foi cobrado a
// mais do cliente e remetido ao fisco portugues.
//
// PENDENTE DE DECISAO CONTABIL, registrado e nao decidido por mim: a base do
// imposto brasileiro (12,85%) fica em R$ 1.800,60, que INCLUI o IVA portugues.
// Se o contador disser que a base deve excluir o IVA, e trocar valor_com_juros
// para 1463.90 - o imposto cai de R$ 231,38 para R$ 188,11. O LIQUIDO nao muda
// em nenhuma das duas leituras.
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
const SALE_ID = 'f18a93aa-385e-49ac-ba83-eae91ca204eb'
const CAMBIO = 5.0

const USD = { subtotal: 292.78, total: 360.12, repasse: 278.73, taxaHubla: 14.05, iva: 67.34 }
const emReais = (usd: number) => Math.round(usd * CAMBIO * 100) / 100

const NOVO = {
  preco_base:         emReais(USD.subtotal),
  valor_pago_cliente: emReais(USD.subtotal),
  valor_com_juros:    emReais(USD.total),
  valor_liquido:      emReais(USD.repasse),
}

const brl = (n: number) => 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function main() {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: antes, error } = await c.from('sales')
    .select('id,nome,email,produto,plataforma,status,order_id,preco_base,valor_pago_cliente,valor_com_juros,valor_liquido')
    .eq('id', SALE_ID).single()
  if (error) throw error

  // Guardas: se qualquer uma falhar, e porque o alvo nao e o que eu penso.
  if (!antes.order_id?.startsWith('1f0890b1-26e4-4b2b-b255-0a8b1d38f24d')) throw new Error('fatura diferente da esperada')
  if (antes.plataforma !== 'hubla') throw new Error('plataforma inesperada: ' + antes.plataforma)
  if (Math.abs(Number(antes.valor_liquido) - USD.repasse) > 0.01) throw new Error('valor_liquido nao e mais 278,73 - alguem ja mexeu')
  if (Number(antes.valor_liquido) <= Number(antes.valor_pago_cliente)) throw new Error('a venda ja esta consistente - nada a corrigir')

  console.log(`${antes.nome} | ${antes.email}`)
  console.log(`${antes.produto} | ${antes.plataforma} | ${antes.status}`)
  console.log(`cambio: ${CAMBIO.toFixed(2)}\n`)
  console.log('campo                 antes (moeda estrangeira)   depois (reais)')
  for (const k of ['preco_base', 'valor_pago_cliente', 'valor_com_juros', 'valor_liquido'] as const) {
    console.log(`  ${k.padEnd(20)} ${String(antes[k]).padEnd(26)} ${NOVO[k]}`)
  }

  const bruto = NOVO.valor_pago_cliente
  const taxas = Math.round((bruto - NOVO.valor_liquido) * 100) / 100
  const imposto = Math.round(NOVO.valor_com_juros * 0.1285 * 100) / 100
  console.log('\ncomo a linha fica no fechamento:')
  console.log(`  faturamento bruto    ${brl(bruto)}`)
  console.log(`  taxas da plataforma  ${brl(taxas)}   (= taxa Hubla de $${USD.taxaHubla} x ${CAMBIO})`)
  console.log(`  imposto 12,85%       ${brl(imposto)}`)
  console.log(`  faturamento liquido  ${brl(NOVO.valor_liquido)}`)
  console.log(`  liquido pos-imposto  ${brl(Math.round((NOVO.valor_liquido - imposto) * 100) / 100)}`)
  console.log(`\n  antes o liquido contava ${brl(Number(antes.valor_liquido))} -> entram ${brl(NOVO.valor_liquido - Number(antes.valor_liquido))} a mais`)
  console.log(`  o alerta de conferencia sai: liquido ${brl(NOVO.valor_liquido)} < pago ${brl(bruto)}`)

  if (!GRAVAR) { console.log('\n== ENSAIO. nada gravado. rode com --gravar ==') ; return }

  const { error: e2 } = await c.from('sales').update(NOVO).eq('id', SALE_ID)
  if (e2) throw e2
  const { data: depois } = await c.from('sales')
    .select('preco_base,valor_pago_cliente,valor_com_juros,valor_liquido').eq('id', SALE_ID).single()
  console.log('\n== GRAVADO ==')
  console.log(depois)
}
main().then(() => process.exit(0)).catch(e => { console.error('ABORTADO:', e.message ?? e); process.exit(1) })
