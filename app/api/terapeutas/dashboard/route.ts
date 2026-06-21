import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

type SaleRow = {
  id: string
  valor_pago_cliente: number
  valor_liquido: number
  produto: string
  data_hora: string
}

type SessaoRow = {
  id: string
  sale_id: string
  terapeuta_id: string
  status: string
  comissao_valor: number
  comissao_paga: boolean
  data_agendada: string | null
  paciente_nome: string
  link_meet: string | null
}

type SessaoHojeRow = {
  id: string
  data_agendada: string | null
  paciente_nome: string
  link_meet: string | null
  status: string
  status_consulta: string | null
  terapeuta_id: string
  terapeutas: { nome: string } | null
}

// Brasília = UTC-3
function brasiliaStartUTC(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 3, 0, 0)).toISOString()
}
function brasiliaEndUTC(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 2, 59, 59)).toISOString()
}

function brasiliaToday(): Date {
  const now = new Date()
  const br = new Date(now.getTime() - 3 * 60 * 60 * 1000)
  return new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate()))
}

function getDateRange(preset: string, dateStart?: string, dateEnd?: string) {
  const now = new Date()
  const today = brasiliaToday()
  const yesterday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1))
  const sevenDaysAgo = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 6))
  const firstOfMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))

  switch (preset) {
    case 'today':
      return { from: brasiliaStartUTC(today), to: now.toISOString() }
    case 'yesterday':
      return { from: brasiliaStartUTC(yesterday), to: brasiliaEndUTC(yesterday) }
    case 'last_7d':
      return { from: brasiliaStartUTC(sevenDaysAgo), to: now.toISOString() }
    case 'this_month':
      return { from: brasiliaStartUTC(firstOfMonth), to: now.toISOString() }
    case 'custom':
      return {
        from: dateStart ?? brasiliaStartUTC(firstOfMonth),
        to: dateEnd ?? now.toISOString(),
      }
    default:
      return { from: brasiliaStartUTC(firstOfMonth), to: now.toISOString() }
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const preset = searchParams.get('datePreset') ?? 'this_month'
    const dateStart = searchParams.get('dateStart') ?? undefined
    const dateEnd = searchParams.get('dateEnd') ?? undefined
    const terapeutaId = searchParams.get('terapeutaId') ?? 'all'

    const { from, to } = getDateRange(preset, dateStart, dateEnd)
    const supabase = getSupabaseAdmin()

    // 1. Terapeutas ativos
    const { data: terapeutasData } = await supabase
      .from('terapeutas')
      .select('id,nome,percentual_comissao')
      .eq('ativo', true)
      .order('nome')
    const terapeutas = (terapeutasData ?? []) as { id: string; nome: string; percentual_comissao: number }[]

    // 2. Se filtro de terapeuta: buscar sale_ids desse terapeuta
    let saleIdsFiltrados: string[] | null = null
    if (terapeutaId !== 'all') {
      const { data: stData } = await supabase
        .from('sessoes')
        .select('sale_id')
        .eq('terapeuta_id', terapeutaId)
      saleIdsFiltrados = [...new Set(((stData ?? []) as { sale_id: string }[]).map(s => s.sale_id))]
    }

    // 3. Buscar vendas paginadas
    const vendasRaw: SaleRow[] = []
    const PAGE = 1000
    let offset = 0
    while (true) {
      let q = supabase
        .from('sales')
        .select('id,valor_pago_cliente,valor_liquido,produto,data_hora')
        .ilike('produto', '%Pedro | Denise%')
        .gte('data_hora', from)
        .lte('data_hora', to)
        .order('data_hora', { ascending: false })
        .range(offset, offset + PAGE - 1)
      if (saleIdsFiltrados !== null) {
        q = q.in('id', saleIdsFiltrados.length > 0 ? saleIdsFiltrados : ['__none__'])
      }
      const { data, error } = await q
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) break
      vendasRaw.push(...(data as SaleRow[]))
      if (data.length < PAGE) break
      offset += PAGE
    }

    const saleIds = vendasRaw.map(v => v.id)

    // 4. Buscar sessões em lotes de 200
    const sessoes: SessaoRow[] = []
    if (saleIds.length > 0) {
      const BATCH = 200
      for (let i = 0; i < saleIds.length; i += BATCH) {
        const batch = saleIds.slice(i, i + BATCH)
        const { data } = await supabase
          .from('sessoes')
          .select('id,sale_id,terapeuta_id,status,comissao_valor,comissao_paga,data_agendada,paciente_nome,link_meet')
          .in('sale_id', batch)
        if (data) sessoes.push(...(data as SessaoRow[]))
      }
    }

    // Aplicar filtro de terapeuta nas sessões
    const sessoesFiltradas = terapeutaId !== 'all'
      ? sessoes.filter(s => s.terapeuta_id === terapeutaId)
      : sessoes

    // 5. Métricas globais
    const sessoes_entregues = sessoesFiltradas.filter(s => s.status === 'entregue').length
    const sessoes_futuras = sessoesFiltradas.filter(s => s.status === 'pendente' || s.status === 'agendada').length
    const sessoes_vendidas = sessoesFiltradas.length

    const faturamento_bruto = vendasRaw.reduce((a, v) => a + (v.valor_pago_cliente || 0), 0)
    const total_impostos = vendasRaw.reduce((a, v) => a + (v.valor_pago_cliente || 0) * 0.1285, 0)
    const faturamento_liquido_total = vendasRaw.reduce((a, v) => {
      return a + (v.valor_liquido || 0) - (v.valor_pago_cliente || 0) * 0.1285
    }, 0)
    const faturamento_liquido_spr = faturamento_liquido_total * 0.70
    const faturamento_liquido_terapeutas = faturamento_liquido_total * 0.30
    const ticket_medio = vendasRaw.length > 0 ? faturamento_bruto / vendasRaw.length : 0
    const comissao_gerada = sessoesFiltradas.filter(s => s.status === 'entregue').reduce((a, s) => a + (s.comissao_valor || 0), 0)
    const comissao_futura = sessoesFiltradas.filter(s => s.status === 'pendente' || s.status === 'agendada').reduce((a, s) => a + (s.comissao_valor || 0), 0)

    // 6. Stats por terapeuta
    const now = new Date()
    const por_terapeuta = terapeutas.map(t => {
      const ts = sessoesFiltradas.filter(s => s.terapeuta_id === t.id)
      const saleIdsTerapeuta = [...new Set(ts.map(s => s.sale_id))]
      const fat_bruto_t = vendasRaw
        .filter(v => saleIdsTerapeuta.includes(v.id))
        .reduce((a, v) => a + (v.valor_pago_cliente || 0), 0)
      const proximas = ts
        .filter(s => s.status === 'agendada' && s.data_agendada && new Date(s.data_agendada) > now)
        .sort((a, b) => (a.data_agendada ?? '') < (b.data_agendada ?? '') ? -1 : 1)
      return {
        id: t.id,
        nome: t.nome,
        sessoes_vendidas: ts.length,
        sessoes_entregues: ts.filter(s => s.status === 'entregue').length,
        sessoes_futuras: ts.filter(s => s.status === 'pendente' || s.status === 'agendada').length,
        faturamento_bruto: fat_bruto_t,
        comissao_gerada: ts.filter(s => s.status === 'entregue').reduce((a, s) => a + (s.comissao_valor || 0), 0),
        comissao_futura: ts.filter(s => s.status === 'pendente' || s.status === 'agendada').reduce((a, s) => a + (s.comissao_valor || 0), 0),
        proxima_consulta: proximas[0]?.data_agendada ?? null,
      }
    })

    // 7. Consultas hoje em Brasília
    const today = brasiliaToday()
    const hojeStart = brasiliaStartUTC(today)
    const hojeEnd = brasiliaEndUTC(today)

    let hojeQ = supabase
      .from('sessoes')
      .select('id,data_agendada,paciente_nome,link_meet,status,status_consulta,terapeuta_id,terapeutas(nome)')
      .gte('data_agendada', hojeStart)
      .lte('data_agendada', hojeEnd)
      .in('status', ['agendada', 'pendente', 'entregue'])
      .order('data_agendada', { ascending: true })

    if (terapeutaId !== 'all') {
      hojeQ = hojeQ.eq('terapeuta_id', terapeutaId)
    }

    const { data: hojeData } = await hojeQ
    const consultas_hoje = ((hojeData ?? []) as unknown as SessaoHojeRow[]).map(s => ({
      id: s.id,
      horario: s.data_agendada
        ? new Date(s.data_agendada).toLocaleTimeString('pt-BR', {
            hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
          })
        : '—',
      paciente_nome: s.paciente_nome,
      terapeuta_nome: (s.terapeutas as { nome: string } | null)?.nome ?? '—',
      link_meet: s.link_meet,
      status: s.status,
      status_consulta: s.status_consulta ?? 'aguardando',
    }))

    return NextResponse.json({
      metricas: {
        sessoes_vendidas,
        sessoes_entregues,
        sessoes_futuras,
        faturamento_bruto,
        faturamento_liquido_spr,
        total_impostos,
        ticket_medio,
        comissao_gerada,
        comissao_futura,
        faturamento_liquido_terapeutas,
      },
      por_terapeuta,
      consultas_hoje,
    })
  } catch (err) {
    console.error('[terapeutas/dashboard]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
