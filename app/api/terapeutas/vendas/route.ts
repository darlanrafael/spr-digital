import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

type SaleRow = {
  id: string
  nome: string
  email: string
  telefone: string | null
  produto: string
  plataforma: string | null
  valor_pago_cliente: number
  valor_liquido: number
  data_hora: string
  status: string | null
}

type SessaoRow = {
  id: string
  sale_id: string
  terapeuta_id: string
  numero_sessao: number
  total_sessoes: number
  status: string
  data_agendada: string | null
  data_entrega: string | null
  link_meet: string | null
  comissao_valor: number
  comissao_paga: boolean
  paciente_nome: string
  paciente_email: string
  agendado_por: string | null
  entregue_confirmado_por: string | null
  observacoes: string | null
  terapeutas: { nome: string } | null
}

function brasiliaToday(): Date {
  const now = new Date()
  const br = new Date(now.getTime() - 3 * 60 * 60 * 1000)
  return new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate()))
}
function brasiliaStartUTC(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 3, 0, 0)).toISOString()
}
function brasiliaEndUTC(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 2, 59, 59)).toISOString()
}

function getDateRange(preset: string, dateStart?: string, dateEnd?: string) {
  const now = new Date()
  const today = brasiliaToday()
  const yesterday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1))
  const sevenDaysAgo = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 6))
  const firstOfMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
  switch (preset) {
    case 'today': return { from: brasiliaStartUTC(today), to: now.toISOString() }
    case 'yesterday': return { from: brasiliaStartUTC(yesterday), to: brasiliaEndUTC(yesterday) }
    case 'last_7d': return { from: brasiliaStartUTC(sevenDaysAgo), to: now.toISOString() }
    case 'this_month': return { from: brasiliaStartUTC(firstOfMonth), to: now.toISOString() }
    case 'custom': return { from: dateStart ?? brasiliaStartUTC(firstOfMonth), to: dateEnd ?? now.toISOString() }
    default: return { from: brasiliaStartUTC(firstOfMonth), to: now.toISOString() }
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const datePreset = searchParams.get('datePreset') ?? 'this_month'
    const dateStart = searchParams.get('dateStart') ?? undefined
    const dateEnd = searchParams.get('dateEnd') ?? undefined

    const { from, to } = getDateRange(datePreset, dateStart, dateEnd)
    const supabase = getSupabaseAdmin()

    // Terapeutas ativos
    const { data: terapeutasData } = await supabase
      .from('terapeutas').select('id,nome').eq('ativo', true).order('nome')
    const terapeutas = (terapeutasData ?? []) as { id: string; nome: string }[]

    // Fetch vendas paginadas
    const vendasAll: SaleRow[] = []
    const PAGE = 1000
    let offset = 0
    while (true) {
      const { data, error } = await supabase
        .from('sales')
        .select('id,nome,email,telefone,produto,plataforma,valor_pago_cliente,valor_liquido,data_hora,status')
        .ilike('produto', '%Pedro | Denise%')
        .gte('data_hora', from)
        .lte('data_hora', to)
        .order('data_hora', { ascending: false })
        .range(offset, offset + PAGE - 1)
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) break
      vendasAll.push(...(data as SaleRow[]))
      if (data.length < PAGE) break
      offset += PAGE
    }

    const allSaleIds = vendasAll.map(v => v.id)

    // Fetch sessoes em lotes de 200
    const sessoesPorVenda: Record<string, SessaoRow[]> = {}
    if (allSaleIds.length > 0) {
      const BATCH = 200
      for (let i = 0; i < allSaleIds.length; i += BATCH) {
        const batch = allSaleIds.slice(i, i + BATCH)
        const { data } = await supabase
          .from('sessoes')
          .select('id,sale_id,terapeuta_id,numero_sessao,total_sessoes,status,data_agendada,data_entrega,link_meet,comissao_valor,comissao_paga,paciente_nome,paciente_email,agendado_por,entregue_confirmado_por,observacoes,terapeutas(nome)')
          .in('sale_id', batch)
          .order('numero_sessao', { ascending: true })
        if (data) {
          for (const s of (data as unknown as SessaoRow[])) {
            if (!sessoesPorVenda[s.sale_id]) sessoesPorVenda[s.sale_id] = []
            sessoesPorVenda[s.sale_id].push(s)
          }
        }
      }
    }

    // Classificar vendas
    const vendasAprovadas = vendasAll.filter(v => !v.status || v.status === 'aprovada')
    const vendasReembolsos = vendasAll.filter(v =>
      ['reembolsada', 'chargeback', 'cancelada', 'em_protesto'].includes(v.status ?? '')
    )
    const vendasPendentes = vendasAprovadas.filter(v =>
      !sessoesPorVenda[v.id] || sessoesPorVenda[v.id].length === 0
    )
    const vendasAtivos = vendasAprovadas.filter(v =>
      sessoesPorVenda[v.id] && sessoesPorVenda[v.id].length > 0
    )

    const formatos = [...new Set(vendasAll.map(v => v.produto))].sort()

    return NextResponse.json({
      counts: {
        aprovadas: vendasAprovadas.length,
        pendentes: vendasPendentes.length,
        ativos: vendasAtivos.length,
        reembolsos: vendasReembolsos.length,
      },
      vendas_pendentes: vendasPendentes,
      vendas_ativos: vendasAtivos,
      vendas_reembolsos: vendasReembolsos,
      sessoes_por_venda: sessoesPorVenda,
      terapeutas,
      formatos,
    })
  } catch (err) {
    console.error('[terapeutas/vendas GET]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// PATCH: salvar observações sem requerer senha (notas clínicas, sem impacto financeiro)
export async function PATCH(req: NextRequest) {
  try {
    const { sessao_id, observacoes } = await req.json() as { sessao_id: string; observacoes: string }
    if (!sessao_id) return NextResponse.json({ error: 'sessao_id obrigatório' }, { status: 400 })
    const supabase = getSupabaseAdmin()
    const { error } = await supabase.from('sessoes').update({ observacoes }).eq('id', sessao_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
