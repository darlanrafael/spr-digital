import { getSupabaseClient } from './supabase'
import type {
  Sale, SaleStatus, Product, Project, FixedCost, VariableCost,
  MetaAdsEntry, CostsData, Closing, CashflowEntry,
} from '@/types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normTs(ts: string | null | undefined, isKiwify = false): string {
  if (!ts) return ''
  // Timestamps do Supabase (timestamptz) chegam com +00:00 ou Z. A Hubla grava
  // data_hora em UTC real, então convertemos pra Brasília (UTC-3) subtraindo
  // 3 horas. A Kiwify grava data_hora já em horário de Brasília, só com o
  // sufixo +00:00 (não é UTC de verdade) — se aplicarmos a mesma subtração
  // de 3h nela, o horário desloca 3h a mais do que deveria, e uma venda feita
  // entre 00:00 e 02:59 (BRT) passa a aparecer com data do dia anterior em
  // todo filtro de período (Vendas, Fechamentos, DRE, Análises).
  if (!isKiwify && (ts.includes('+') || ts.endsWith('Z'))) {
    const date = new Date(ts)
    if (!isNaN(date.getTime())) {
      return new Date(date.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 19)
    }
  }
  return ts.slice(0, 19)
}

// Converte uma data Brasília (YYYY-MM-DD) nos limites UTC corretos para filtro
// no Supabase. Brasília = UTC-3: o dia D vai de D T03:00:00Z até (D+1) T02:59:59Z.
// Usado para HUBLA, que grava data_hora em UTC real.
function brtDayRangeToUTC(dateStr: string): { startUTC: string; endUTC: string } {
  const startUTC = `${dateStr}T03:00:00`
  // +1 dia via Date UTC para cobrir virada de mês e de ano corretamente
  const next = new Date(`${dateStr}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  const endUTC = `${next.toISOString().slice(0, 10)}T02:59:59`
  return { startUTC, endUTC }
}

// Limites para KIWIFY, que grava data_hora em BRT-como-UTC:
// hora de Brasília com sufixo +00:00 sem conversão para UTC real.
// Dia D em BRT = D T00:00:00 até D T23:59:59 no campo data_hora.
function kiwifyBrtRange(dateStr: string): { start: string; end: string } {
  return { start: `${dateStr}T00:00:00`, end: `${dateStr}T23:59:59` }
}

// ─── Projects ────────────────────────────────────────────────────────────────

export async function getProjects(): Promise<Project[]> {
  const client = getSupabaseClient()
  if (!client) return []
  const { data, error } = await client
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
  const client = getSupabaseClient()
  if (!client) return []
  const { data, error } = await client
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
  statusFilter: string[] = ['aprovada'],
): Promise<Sale[]> {
  const client = getSupabaseClient()
  if (!client) return []

  const PAGE_SIZE = 1000
  const all: Record<string, unknown>[] = []
  // Paginação por cursor (keyset), não por offset (.range()). A tabela recebe
  // inserts o tempo todo via webhook; com .range(from, from+999) uma venda
  // nova entrando entre duas páginas empurra tudo e faz uma linha já
  // existente sumir da busca (ela "cai" entre as duas janelas de offset).
  // Ancorar cada página em created_at < cursor da página anterior evita isso:
  // linhas que já existiam antes da busca começar nunca deixam de aparecer,
  // no máximo uma linha inserida no meio da busca fica só pro próximo reload.
  let cursor: string | null = null

  while (true) {
    let q = client
      .from('sales')
      .select('*')
      .eq('project_id', projectId)

    // Wide early filter: cobre ambas as plataformas com um único range de banco.
    // Hubla (UTC real): dia D começa em D T03:00:00 UTC.
    // Kiwify (BRT-como-UTC): dia D começa em D T00:00:00 "UTC".
    // → lower wide: dateStart T00:00:00 (mínimo entre os dois inícios)
    // → upper wide: brtDayRangeToUTC(dateEnd).endUTC = (dateEnd+1) T02:59:59 (máximo entre os dois fins)
    // O corte exato por plataforma é feito em memória abaixo.
    if (dateStart) q = q.gte('data_hora', `${dateStart}T00:00:00`)
    if (dateEnd)   q = q.lte('data_hora', brtDayRangeToUTC(dateEnd).endUTC)
    if (statusFilter.length === 1) {
      q = q.eq('status', statusFilter[0])
    } else if (statusFilter.length > 1) {
      q = q.in('status', statusFilter)
    }
    if (cursor) q = q.lt('created_at', cursor)

    const { data, error } = await q
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)

    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break
    cursor = String(data[data.length - 1].created_at)
  }

  // Filtro de precisão em memória por convenção de armazenamento:
  // Hubla grava UTC real → janela BRT→UTC (T03:00 a T02:59 do dia seguinte).
  // Kiwify grava BRT-como-UTC → comparar direto contra os limites BRT (T00:00 a T23:59).
  const filtered = dateStart || dateEnd
    ? all.filter(r => {
        const dh = String(r.data_hora ?? '').slice(0, 19)
        const isKiwify = String(r.plataforma ?? '').toLowerCase() === 'kiwify'
        if (isKiwify) {
          const lo = dateStart ? kiwifyBrtRange(dateStart).start : ''
          const hi = dateEnd   ? kiwifyBrtRange(dateEnd).end     : ''
          if (lo && dh < lo) return false
          if (hi && dh > hi) return false
        } else {
          const lo = dateStart ? brtDayRangeToUTC(dateStart).startUTC : ''
          const hi = dateEnd   ? brtDayRangeToUTC(dateEnd).endUTC     : ''
          if (lo && dh < lo) return false
          if (hi && dh > hi) return false
        }
        return true
      })
    : all

  return filtered.map(mapSaleRow)
}

function mapSaleRow(r: Record<string, unknown>): Sale {
  return {
    id: String(r.id),
    nome: String(r.nome ?? ''),
    email: String(r.email ?? ''),
    telefone: String(r.telefone ?? ''),
    cpf: r.cpf ? String(r.cpf) : undefined,
    produto: String(r.produto ?? ''),
    plataforma: String(r.plataforma ?? '').toLowerCase() as 'kiwify' | 'hubla',
    plataforma_sale_id: r.plataforma_sale_id ? String(r.plataforma_sale_id) : undefined,
    preco_base: Number(r.preco_base),
    valor_pago_cliente: Number(r.valor_pago_cliente),
    valor_liquido: Number(r.valor_liquido),
    data_hora: normTs(String(r.data_hora ?? ''), String(r.plataforma ?? '').toLowerCase() === 'kiwify'),
    utm_source: String(r.utm_source ?? ''),
    utm_medium: String(r.utm_medium ?? ''),
    utm_campaign: String(r.utm_campaign ?? ''),
    utm_content: String(r.utm_content ?? ''),
    utm_term: String(r.utm_term ?? ''),
    status: String(r.status) as SaleStatus,
    projetoId: String(r.project_id ?? ''),
    data_reembolso: r.data_reembolso ? String(r.data_reembolso) : undefined,
  }
}

export async function findSaleByPlatformId(
  platformSaleId: string,
  plataforma: string,
): Promise<Sale | null> {
  const client = getSupabaseClient()
  if (!client) return null
  const { data, error } = await client
    .from('sales')
    .select('*')
    .eq('plataforma_sale_id', platformSaleId)
    .eq('plataforma', plataforma)
    .limit(1)
  if (error || !data || data.length === 0) return null
  return mapSaleRow(data[0] as Record<string, unknown>)
}

export async function findSaleByEmailAndProduct(
  email: string,
  produtoNome: string,
  plataforma: string,
): Promise<Sale | null> {
  const client = getSupabaseClient()
  if (!client) return null
  const { data, error } = await client
    .from('sales')
    .select('*')
    .ilike('email', email)
    .ilike('produto', produtoNome)
    .eq('plataforma', plataforma)
    .order('data_hora', { ascending: false })
    .limit(1)
  if (error || !data || data.length === 0) {
    // Fallback: busca só por email + plataforma
    const { data: d2 } = await client
      .from('sales')
      .select('*')
      .ilike('email', email)
      .eq('plataforma', plataforma)
      .order('data_hora', { ascending: false })
      .limit(1)
    if (!d2 || d2.length === 0) return null
    return mapSaleRow(d2[0] as Record<string, unknown>)
  }
  return mapSaleRow(data[0] as Record<string, unknown>)
}

export async function addSale(sale: Sale): Promise<void> {
  const client = getSupabaseClient()
  if (!client) return
  const { error } = await client.from('sales').upsert({
    id: sale.id,
    project_id: sale.projetoId,
    nome: sale.nome,
    email: sale.email,
    telefone: sale.telefone,
    cpf: sale.cpf ?? null,
    produto: sale.produto,
    plataforma: sale.plataforma,
    plataforma_sale_id: sale.plataforma_sale_id ?? null,
    preco_base: sale.preco_base,
    valor_pago_cliente: sale.valor_pago_cliente,
    valor_liquido: sale.valor_liquido,
    data_hora: sale.data_hora,
    utm_source: sale.utm_source || null,
    utm_medium: sale.utm_medium || null,
    utm_campaign: sale.utm_campaign || null,
    utm_content: sale.utm_content || null,
    utm_term: sale.utm_term || null,
    status: sale.status,
    data_reembolso: sale.data_reembolso ?? null,
  })
  if (error) throw error
}

export async function updateSaleStatus(
  id: string,
  status: SaleStatus,
  dataReembolso?: string,
): Promise<void> {
  const client = getSupabaseClient()
  if (!client) return
  const { error } = await client
    .from('sales')
    .update({ status, data_reembolso: dataReembolso ?? null })
    .eq('id', id)
  if (error) throw error
}

// ─── Fixed Costs ─────────────────────────────────────────────────────────────

export async function getFixedCosts(): Promise<FixedCost[]> {
  const client = getSupabaseClient()
  if (!client) return []
  const { data, error } = await client
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
  const client = getSupabaseClient()
  if (!client) return
  const { error } = await client.from('fixed_costs').upsert({
    id: cost.id,
    descricao: cost.descricao,
    valor: cost.valor,
    ativo: cost.ativo,
  })
  if (error) throw error
}

export async function updateFixedCost(
  id: string,
  patch: Partial<Pick<FixedCost, 'descricao' | 'valor' | 'ativo'>>,
): Promise<void> {
  const client = getSupabaseClient()
  if (!client) return
  const { error } = await client.from('fixed_costs').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteFixedCost(id: string): Promise<void> {
  const client = getSupabaseClient()
  if (!client) return
  const { error } = await client.from('fixed_costs').delete().eq('id', id)
  if (error) throw error
}

// ─── Variable Costs ──────────────────────────────────────────────────────────

export async function getVariableCosts(
  projectId: string,
  dateStart?: string,
  dateEnd?: string,
): Promise<VariableCost[]> {
  const client = getSupabaseClient()
  if (!client) return []
  let q = client
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
  const client = getSupabaseClient()
  if (!client) return
  const { error } = await client.from('variable_costs').upsert({
    id: cost.id,
    project_id: cost.projetoId ?? null,
    descricao: cost.descricao,
    valor: cost.valor,
    data: cost.data,
  })
  if (error) throw error
}

export async function updateCost(
  id: string,
  patch: Partial<Pick<VariableCost, 'descricao' | 'valor' | 'data'>>,
): Promise<void> {
  const client = getSupabaseClient()
  if (!client) return
  const { error } = await client.from('variable_costs').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteCost(id: string): Promise<void> {
  const client = getSupabaseClient()
  if (!client) return
  const { error } = await client.from('variable_costs').delete().eq('id', id)
  if (error) throw error
}

// ─── Meta Ads ────────────────────────────────────────────────────────────────

export async function getMetaAds(
  projectId: string,
  dateStart?: string,
  dateEnd?: string,
): Promise<MetaAdsEntry[]> {
  const client = getSupabaseClient()
  if (!client) return []
  let q = client.from('meta_ads').select('*').eq('project_id', projectId)
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
  const client = getSupabaseClient()
  if (!client) return
  const { error } = await client
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
  const client = getSupabaseClient()
  if (!client) return []
  const { data, error } = await client
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
  const client = getSupabaseClient()
  if (!client) return
  const { error } = await client.from('closings').upsert({
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
  const client = getSupabaseClient()
  if (!client) return []
  const { data, error } = await client
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
  const client = getSupabaseClient()
  if (!client) return
  const { error } = await client.from('cashflow').upsert({
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
