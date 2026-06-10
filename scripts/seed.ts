/**
 * Seed: insere os dados mockados dos arquivos JSON no Supabase.
 * Execução: npx tsx scripts/seed.ts
 *
 * Requer: NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY no .env.local
 */

import { config } from 'dotenv'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

// Carrega .env.local antes de qualquer importação
config({ path: resolve(process.cwd(), '.env.local') })

// Dados mockados
import projectsRaw from '../data/projects.json'
import productsRaw from '../data/products.json'
import salesRaw from '../data/sales.json'
import costsRaw from '../data/costs.json'
import cashflowRaw from '../data/cashflow.json'
import closingsRaw from '../data/closings.json'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variáveis NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY não encontradas no .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function seed() {
  console.log('🌱 Iniciando seed no Supabase...\n')

  // 1. Projects
  console.log('📁 Inserindo projetos...')
  const projects = projectsRaw.map(p => ({
    id: p.id,
    nome: p.nome,
    descricao: p.descricao ?? '',
    ativo: p.ativo,
    gestor_id: p.gestorId ?? '',
    cor: p.cor ?? '#6366f1',
  }))
  const { error: projErr } = await supabase.from('projects').upsert(projects)
  if (projErr) { console.error('❌ projects:', projErr.message); process.exit(1) }
  console.log(`   ✅ ${projects.length} projeto(s)`)

  // 2. Products
  console.log('📦 Inserindo produtos...')
  const products = productsRaw.map(p => ({
    id: p.id,
    project_id: p.projetoId,
    nome: p.nome,
    plataforma: p.plataforma.toLowerCase(),
    preco: p.preco,
    aliquota: p.aliquota ?? 0,
  }))
  const { error: prodErr } = await supabase.from('products').upsert(products)
  if (prodErr) { console.error('❌ products:', prodErr.message); process.exit(1) }
  console.log(`   ✅ ${products.length} produto(s)`)

  // 3. Sales
  console.log('💰 Inserindo vendas...')
  const sales = (salesRaw as typeof salesRaw & { data_reembolso?: string }[]).map(s => ({
    id: s.id,
    project_id: s.projetoId,
    nome: s.nome,
    email: s.email,
    telefone: s.telefone,
    produto: s.produto,
    plataforma: s.plataforma.toLowerCase(),
    preco_base: s.preco_base,
    valor_pago_cliente: s.valor_pago_cliente,
    valor_liquido: s.valor_liquido,
    data_hora: s.data_hora,
    utm_source: s.utm_source,
    utm_medium: s.utm_medium,
    utm_campaign: s.utm_campaign,
    utm_content: s.utm_content,
    utm_term: s.utm_term,
    status: s.status,
    data_reembolso: (s as { data_reembolso?: string }).data_reembolso ?? null,
  }))
  const { error: salesErr } = await supabase.from('sales').upsert(sales)
  if (salesErr) { console.error('❌ sales:', salesErr.message); process.exit(1) }
  console.log(`   ✅ ${sales.length} venda(s)`)

  // 4. Fixed costs
  console.log('🔧 Inserindo custos fixos...')
  const fixedCosts = costsRaw.fixos.map(c => ({
    id: c.id,
    descricao: c.descricao,
    valor: c.valor,
    ativo: c.ativo,
  }))
  const { error: fixErr } = await supabase.from('fixed_costs').upsert(fixedCosts)
  if (fixErr) { console.error('❌ fixed_costs:', fixErr.message); process.exit(1) }
  console.log(`   ✅ ${fixedCosts.length} custo(s) fixo(s)`)

  // 5. Variable costs
  console.log('📊 Inserindo custos variáveis...')
  const varCosts = costsRaw.variaveis.map(c => ({
    id: c.id,
    project_id: c.projetoId ?? null,
    descricao: c.descricao,
    valor: c.valor,
    data: c.data,
  }))
  const { error: varErr } = await supabase.from('variable_costs').upsert(varCosts)
  if (varErr) { console.error('❌ variable_costs:', varErr.message); process.exit(1) }
  console.log(`   ✅ ${varCosts.length} custo(s) variável(is)`)

  // 6. Meta Ads
  console.log('📣 Inserindo Meta Ads...')
  const metaAds = costsRaw.metaAds.map(m => ({
    project_id: m.projetoId,
    mes: m.mes,
    valor: m.valor,
  }))
  const { error: metaErr } = await supabase
    .from('meta_ads')
    .upsert(metaAds, { onConflict: 'project_id,mes' })
  if (metaErr) { console.error('❌ meta_ads:', metaErr.message); process.exit(1) }
  console.log(`   ✅ ${metaAds.length} entrada(s) Meta Ads`)

  // 7. Cashflow
  console.log('💳 Inserindo caixa...')
  const cashflow = cashflowRaw.map(e => ({
    id: e.id,
    project_id: 'proj_1',
    data: e.data,
    descricao: e.descricao,
    origem: e.origem,
    tipo: e.tipo,
    valor: e.valor,
    saldo_acumulado: e.saldoAcumulado,
  }))
  const { error: cfErr } = await supabase.from('cashflow').upsert(cashflow)
  if (cfErr) { console.error('❌ cashflow:', cfErr.message); process.exit(1) }
  console.log(`   ✅ ${cashflow.length} movimentação(ões)`)

  // 8. Closings
  console.log('📋 Inserindo fechamentos...')
  const closings = (closingsRaw as typeof closingsRaw).map(c => ({
    id: c.id,
    project_id: 'proj_1',
    data: c.data,
    data_confirmacao: null,
    periodo_inicio: c.periodo.inicio,
    periodo_fim: c.periodo.fim,
    produtos_incluidos: [] as string[],
    faturamento_bruto: c.faturamentoBruto,
    impostos: c.impostos,
    taxas_plataforma: c.taxasPlataforma,
    faturamento_liquido: c.faturamentoLiquido,
    custos_totais: c.custosTotais,
    custos_fixos_total: 0,
    custos_variaveis_total: 0,
    lucro_bruto: c.lucroBruto,
    reserva_caixa: c.reservaCaixa,
    lucro_real: c.lucroReal,
    socios: c.socios,
    compradores: c.compradores,
    alertas: c.alertas,
    by_product: [] as unknown[],
  }))
  const { error: closErr } = await supabase.from('closings').upsert(closings)
  if (closErr) { console.error('❌ closings:', closErr.message); process.exit(1) }
  console.log(`   ✅ ${closings.length} fechamento(s)`)

  console.log('\n✅ Seed concluído com sucesso!')
  console.log('   Projeto: Pedro Roncada - Terapeuta Cristão (proj_1)')
}

seed().catch(err => {
  console.error('❌ Erro inesperado:', err)
  process.exit(1)
})
