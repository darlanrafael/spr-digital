import { supabase } from './supabase'
import type {
  Sale, Product, Project, FixedCost, VariableCost,
  MetaAdsEntry, CostsData, Closing, CashflowEntry,
} from '@/types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normTs(ts: string | null | undefined): string {
  if (!ts) return ''
  return ts.replace('+00:00', '').replace('Z', '').slice(0, 19)
}

// ─── Projects ────────────────────────────────────────────────────────────────

export async function getProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('ativo', true)
  if (error) throw error
  return (data ?? []).map(r => ({
    id: r.id,
    nome: r.nome,
    descricao: r.descricao ?? '',
    ativo: r.ativo,
    gestorId: r.gestor_id ?? '',
    cor: r.cor ?? '#6366f1',
  }))
}

// ─── Products ────────────────────────────────────────────────────────────────

export async function getProducts(projectId: string): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('project_id', projectId)
  if (error) throw error
  return (data ?? []).map(r => ({
    id: r.id,
    nome: r.nome,
    plataforma: r.plataforma.toLowerCase() as 'kiwify' | 'hubla',
    projetoId: r.project_id,
    preco: Number(r.preco),
  }))
}

// ─── Sales ───────────────────────────────────────────────────────────────────

export async function getSales(
  projectId: string,
  dateStart?: string,
  dateEnd?: string,
): Promise<Sale[]> {
  let q = supabase.from('sales').select('*').eq('project_id', projectId)
  if (dateStart) q = q.gte('data_hora', dateStart)
  if (dateEnd) q = q.lte('data_hora', `${dateEnd}T23:59:59`)
  const { data, error } = await q.order('data_hora', { ascending: false })
  if (error) throw error
  return (data ?? []).map(r => ({
    id: r.id,
    nome: r.nome,
    email: r.email ?? '',
    telefone: r.telefone ?? '',
    produto: r.produto,
    plataforma: r.plataforma.toLowerCase() as 'kiwify' | 'hubla',
    preco_base: Number(r.preco_base),
    valor_pago_cliente: Number(r.valor_pago_cliente),
    valor_liquido: Number(r.valor_liquido),
    data_hora: normTs(r.data_hora),
    utm_source: r.utm_source ?? '',
    utm_medium: r.utm_medium ?? '',
    utm_campaign: r.utm_campaign ?? '',
    utm_content: r.utm_content ?? '',
    utm_term: r.utm_term ?? '',
    status: r.status as 'aprovado' | 'reembolso',
    projetoId: r.project_id,
    data_reembolso: r.data_reembolso ?? undefined,
  }))
}

export async function addSale(sale: Sale): Promise<void> {
  const { error } = await supabase.from('sales').upsert({
    id: sale.id,
    project_id: sale.projetoId,
    nome: sale.nome,
    email: sale.email,
    telefone: sale.telefone,
    produto: sale.produto,
    plataforma: sale.plataforma,
    preco_base: sale.preco_base,
    valor_pago_cliente: sale.valor_pago_cliente,
    valor_liquido: sale.valor_liquido,
    data_hora: sale.data_hora,
    utm_source: sale.utm_source,
    utm_medium: sale.utm_medium,
    utm_campaign: sale.utm_campaign,
    utm_content: sale.utm_content,
    utm_term: sale.utm_term,
    status: sale.status,
    data_reembolso: sale.data_reembolso ?? null,
  })
  if (error) throw error
}

export async function updateSaleStatus(
  id: string,
  status: 'aprovado' | 'reembolso',
  dataReembolso?: string,
): Promise<void> {
  const { error } = await supabase
    .from('sales')
    .update({ status, data_reembolso: dataReembolso ?? null })
    .eq('id', id)
  if (error) throw error
}

// ─── Fixed Costs ─────────────────────────────────────────────────────────────

export async function getFixedCosts(): Promise<FixedCost[]> {
  const { data, error } = await supabase
    .from('fixed_costs')
    .select('*')
    .eq('ativo', true)
  if (error) throw error
  return (data ?? []).map(r => ({
    id: r.id,
    descricao: r.descricao,
    valor: Number(r.valor),
    ativo: r.ativo,
  }))
}

export async function addFixedCost(cost: FixedCost): Promise<void> {
  const { error } = await supabase.from('fixed_costs').upsert({
    id: cost.id,
    descricao: cost.descricao,
    valor: cost.valor,
    ativo: cost.ativo,
  })
  if (error) throw error
}

export async function updateFixedCost(id: string, patch: Partial<Pick<FixedCost, 'descricao' | 'valor' | 'ativo'>>): Promise<void> {
  const { error } = await supabase.from('fixed_costs').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteFixedCost(id: string): Promise<void> {
  const { error } = await supabase.from('fixed_costs').delete().eq('id', id)
  if (error) throw error
}

// ─── Variable Costs ──────────────────────────────────────────────────────────

export async function getVariableCosts(
  projectId: string,
  dateStart?: string,
  dateEnd?: string,
): Promise<VariableCost[]> {
  let q = supabase
    .from('variable_costs')
    .select('*')
    .or(`project_id.eq.${projectId},project_id.is.null`)
  if (dateStart) q = q.gte('data', dateStart)
  if (dateEnd) q = q.lte('data', dateEnd)
  const { data, error } = await q.order('data', { ascending: false })
  if (error) throw error
  return (data ?? []).map(r => ({
    id: r.id,
    descricao: r.descricao,
    valor: Number(r.valor),
    data: r.data,
    projetoId: r.project_id ?? null,
  }))
}

export async function addCost(cost: VariableCost): Promise<void> {
  const { error } = await supabase.from('variable_costs').upsert({
    id: cost.id,
    project_id: cost.projetoId ?? null,
    descricao: cost.descricao,
    valor: cost.valor,
    data: cost.data,
  })
  if (error) throw error
}

export async function updateCost(id: string, patch: Partial<Pick<VariableCost, 'descricao' | 'valor' | 'data'>>): Promise<void> {
  const { error } = await supabase.from('variable_costs').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteCost(id: string): Promise<void> {
  const { error } = await supabase.from('variable_costs').delete().eq('id', id)
  if (error) throw error
}

// ─── Meta Ads ────────────────────────────────────────────────────────────────

export async function getMetaAds(
  projectId: string,
  dateStart?: string,
  dateEnd?: string,
): Promise<MetaAdsEntry[]> {
  let q = supabase.from('meta_ads').select('*').eq('project_id', projectId)
  if (dateStart) q = q.gte('mes', dateStart.slice(0, 7))
  if (dateEnd) q = q.lte('mes', dateEnd.slice(0, 7))
  const { data, error } = await q.order('mes', { ascending: false })
  if (error) throw error
  return (data ?? []).map(r => ({
    mes: r.mes,
    valor: Number(r.valor),
    projetoId: r.project_id,
  }))
}

export async function upsertMetaAds(projectId: string, mes: string, valor: number): Promise<void> {
  const { error } = await supabase
    .from('meta_ads')
    .upsert({ project_id: projectId, mes, valor }, { onConflict: 'project_id,mes' })
  if (error) throw error
}

// ─── All costs (helper for AppContext) ───────────────────────────────────────

export async function getAllCosts(projectId: string): Promise<CostsData> {
  const [fixos, variaveis, metaAds] = await Promise.all([
    getFixedCosts(),
    getVariableCosts(projectId),
    getMetaAds(projectId),
  ])
  return { fixos, variaveis, metaAds }
}

// ─── Closings ────────────────────────────────────────────────────────────────

export async function getClosings(projectId: string): Promise<Closing[]> {
  const { data, error } = await supabase
    .from('closings')
    .select('*')
    .eq('project_id', projectId)
    .order('data_confirmacao', { ascending: false })
  if (error) throw error
  return (data ?? []).map(r => ({
    id: r.id,
    data: r.data,
    data_confirmacao: r.data_confirmacao ? normTs(r.data_confirmacao) : undefined,
    periodo: { inicio: r.periodo_inicio, fim: r.periodo_fim },
    produtos_incluidos: r.produtos_incluidos ?? [],
    faturamentoBruto: Number(r.faturamento_bruto),
    impostos: Number(r.impostos),
    taxasPlataforma: Number(r.taxas_plataforma),
    faturamentoLiquido: Number(r.faturamento_liquido),
    custosTotais: Number(r.custos_totais),
    custos_fixos_total: Number(r.custos_fixos_total),
    custos_variaveis_total: Number(r.custos_variaveis_total),
    lucroBruto: Number(r.lucro_bruto),
    reservaCaixa: Number(r.reserva_caixa),
    lucroReal: Number(r.lucro_real),
    socios: r.socios ?? [],
    compradores: r.compradores ?? [],
    alertas: r.alertas ?? [],
    byProduct: r.by_product ?? [],
  }))
}

export async function addClosing(closing: Closing, projectId: string): Promise<void> {
  const { error } = await supabase.from('closings').upsert({
    id: closing.id,
    project_id: projectId,
    data: closing.data,
    data_confirmacao: closing.data_confirmacao ?? null,
    periodo_inicio: closing.periodo.inicio,
    periodo_fim: closing.periodo.fim,
    produtos_incluidos: closing.produtos_incluidos ?? [],
    faturamento_bruto: closing.faturamentoBruto,
    impostos: closing.impostos,
    taxas_plataforma: closing.taxasPlataforma,
    faturamento_liquido: closing.faturamentoLiquido,
    custos_totais: closing.custosTotais,
    custos_fixos_total: closing.custos_fixos_total ?? 0,
    custos_variaveis_total: closing.custos_variaveis_total ?? 0,
    lucro_bruto: closing.lucroBruto,
    reserva_caixa: closing.reservaCaixa,
    lucro_real: closing.lucroReal,
    socios: closing.socios,
    compradores: closing.compradores,
    alertas: closing.alertas,
    by_product: closing.byProduct ?? [],
  })
  if (error) throw error
}

// ─── Cashflow ────────────────────────────────────────────────────────────────

export async function getCashflow(projectId: string): Promise<CashflowEntry[]> {
  const { data, error } = await supabase
    .from('cashflow')
    .select('*')
    .eq('project_id', projectId)
    .order('data', { ascending: true })
  if (error) throw error
  return (data ?? []).map(r => ({
    id: r.id,
    data: r.data,
    descricao: r.descricao,
    origem: r.origem ?? '',
    tipo: r.tipo as CashflowEntry['tipo'],
    valor: Number(r.valor),
    saldoAcumulado: Number(r.saldo_acumulado),
  }))
}

export async function addCashflowEntry(entry: CashflowEntry, projectId: string): Promise<void> {
  const { error } = await supabase.from('cashflow').upsert({
    id: entry.id,
    project_id: projectId,
    data: entry.data,
    descricao: entry.descricao,
    origem: entry.origem,
    tipo: entry.tipo,
    valor: entry.valor,
    saldo_acumulado: entry.saldoAcumulado,
  })
  if (error) throw error
}
