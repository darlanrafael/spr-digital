import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

type SaleRow = {
  id: string
  email: string
  valor_pago_cliente: number
  valor_liquido: number
  preco_base: number
  produto: string
  data_hora: string
  status: string | null
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

// "all" (Todo período) retorna from/to nulos — sem filtro de data. Backlog
// (pendentes/ativos) não deveria sumir só porque o preset selecionado é
// recente; só relatórios pontuais (Hoje/7 dias/Personalizado) filtram data.
function getDateRange(preset: string, dateStart?: string, dateEnd?: string): { from: string | null; to: string | null } {
  const now = new Date()
  const today = brasiliaToday()
  const sevenDaysAgo = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 6))

  switch (preset) {
    case 'today':
      return { from: brasiliaStartUTC(today), to: now.toISOString() }
    case 'last_7d':
      return { from: brasiliaStartUTC(sevenDaysAgo), to: now.toISOString() }
    case 'custom':
      return { from: dateStart ?? null, to: dateEnd ?? null }
    case 'all':
      return { from: null, to: null }
    default:
      return { from: null, to: null }
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const preset = searchParams.get('datePreset') ?? 'all'
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

    // 2. Se filtro de terapeuta: restringir pelo nome dela no produto (não só
    // pelas vendas que já têm sessão — senão as pendentes de agendamento
    // somem do cálculo de "sessões vendidas"/faturamento, já que ainda não
    // têm nenhuma linha em `sessoes`).
    const terapeutaFiltro = terapeutaId !== 'all' ? terapeutas.find(t => t.id === terapeutaId) : undefined
    const primeiroNomeFiltro = terapeutaFiltro?.nome.trim().split(' ')[0].toLowerCase()

    // 3. Buscar vendas paginadas
    const vendasRaw: SaleRow[] = []
    const PAGE = 1000
    let offset = 0
    while (true) {
      let q = supabase
        .from('sales')
        .select('id,email,valor_pago_cliente,valor_liquido,preco_base,produto,data_hora,status')
        .ilike('produto', '%Pedro | Denise%')
      if (primeiroNomeFiltro) q = q.ilike('produto', `%${primeiroNomeFiltro}%`)
      if (from) q = q.gte('data_hora', from)
      if (to) q = q.lte('data_hora', to)
      q = q
        .order('data_hora', { ascending: false })
        .range(offset, offset + PAGE - 1)
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

    // Vendas aprovadas que ainda não têm NENHUMA sessão criada continuam
    // "vendidas" — o comercial decidiu deixá-las sem sessão até agendar
    // manualmente (não criamos mais sessões placeholder), então elas não
    // podem sumir das métricas de Overview só por não ter registro em
    // `sessoes` ainda. Contam como vendidas/futuras usando o número de
    // sessões do plano (via preco_base) e a comissão que será devida.
    const TABELA_SESSOES: { pedro: Record<number, number>; denise: Record<number, number> } = {
      pedro: { 1300: 1, 1550: 2, 2860: 4, 5280: 8 },
      denise: { 550: 1, 790: 2, 1400: 4, 2640: 8 },
    }
    function inferirSessoesPorValor(sale: SaleRow, todasVendas: SaleRow[]): number {
      const tabela = sale.produto.toLowerCase().includes('denise') ? TABELA_SESSOES.denise : TABELA_SESSOES.pedro
      if (tabela[sale.preco_base]) return tabela[sale.preco_base]
      const irmas = todasVendas.filter(v => v.email === sale.email && v.produto === sale.produto)
      const soma = irmas.reduce((a, v) => a + (v.preco_base ?? 0), 0)
      if (irmas.length > 0 && tabela[soma]) return Math.round(tabela[soma] / irmas.length)
      return 1
    }
    const saleIdsComSessao = new Set(sessoes.map(s => s.sale_id))
    const pendentesPorTerapeuta = new Map<string, { sessoes: number; comissao: number; bruto: number; saleIds: string[] }>()
    for (const t of terapeutas) {
      const primeiroNome = t.nome.trim().split(' ')[0].toLowerCase()
      const pendentes = vendasRaw.filter(v =>
        v.status === 'aprovada' && !saleIdsComSessao.has(v.id) && v.produto.toLowerCase().includes(primeiroNome)
      )
      let sessoesExtra = 0, comissaoExtra = 0, brutoExtra = 0
      for (const v of pendentes) {
        sessoesExtra += inferirSessoesPorValor(v, vendasRaw)
        const imposto = (v.valor_liquido || 0) * 0.1285
        comissaoExtra += ((v.valor_liquido || 0) - imposto) * (t.percentual_comissao / 100)
        brutoExtra += v.valor_pago_cliente || 0
      }
      pendentesPorTerapeuta.set(t.id, { sessoes: sessoesExtra, comissao: comissaoExtra, bruto: brutoExtra, saleIds: pendentes.map(v => v.id) })
    }
    const pendentesFiltrado = terapeutaId !== 'all'
      ? (pendentesPorTerapeuta.get(terapeutaId) ?? { sessoes: 0, comissao: 0, bruto: 0, saleIds: [] })
      : [...pendentesPorTerapeuta.values()].reduce((acc, p) => ({
          sessoes: acc.sessoes + p.sessoes, comissao: acc.comissao + p.comissao, bruto: acc.bruto + p.bruto, saleIds: [...acc.saleIds, ...p.saleIds],
        }), { sessoes: 0, comissao: 0, bruto: 0, saleIds: [] as string[] })

    // 5. Métricas globais
    const sessoes_entregues = sessoesFiltradas.filter(s => s.status === 'entregue').length
    const sessoes_futuras = sessoesFiltradas.filter(s => s.status === 'pendente' || s.status === 'agendada').length + pendentesFiltrado.sessoes
    const sessoes_vendidas = sessoesFiltradas.length + pendentesFiltrado.sessoes

    const faturamento_bruto = vendasRaw.reduce((a, v) => a + (v.valor_pago_cliente || 0), 0)
    const total_impostos = vendasRaw.reduce((a, v) => a + (v.valor_pago_cliente || 0) * 0.1285, 0)
    const faturamento_liquido_total = vendasRaw.reduce((a, v) => {
      return a + (v.valor_liquido || 0) - (v.valor_pago_cliente || 0) * 0.1285
    }, 0)
    const faturamento_liquido_spr = faturamento_liquido_total * 0.70
    const faturamento_liquido_terapeutas = faturamento_liquido_total * 0.30
    const ticket_medio = vendasRaw.length > 0 ? faturamento_bruto / vendasRaw.length : 0
    const comissao_gerada = sessoesFiltradas.filter(s => s.status === 'entregue' && !s.comissao_paga).reduce((a, s) => a + (s.comissao_valor || 0), 0)
    const comissao_futura = sessoesFiltradas.filter(s => s.status === 'pendente' || s.status === 'agendada').reduce((a, s) => a + (s.comissao_valor || 0), 0) + pendentesFiltrado.comissao
    // Comissão total sobre todas as sessões vendidas no período (entregues + futuras + ainda sem sessão criada), independente de já ter sido paga —
    // usado no card "Faturamento Líquido" da visão do próprio terapeuta.
    const comissao_total_vendida = sessoesFiltradas.reduce((a, s) => a + (s.comissao_valor || 0), 0) + pendentesFiltrado.comissao

    // 6. Stats por terapeuta
    const now = new Date()
    const por_terapeuta = terapeutas.map(t => {
      const ts = sessoesFiltradas.filter(s => s.terapeuta_id === t.id)
      const pendentesT = pendentesPorTerapeuta.get(t.id) ?? { sessoes: 0, comissao: 0, bruto: 0, saleIds: [] }
      const saleIdsTerapeuta = [...new Set(ts.map(s => s.sale_id))]
      const fat_bruto_t = vendasRaw
        .filter(v => saleIdsTerapeuta.includes(v.id))
        .reduce((a, v) => a + (v.valor_pago_cliente || 0), 0) + pendentesT.bruto
      const proximas = ts
        .filter(s => s.status === 'agendada' && s.data_agendada && new Date(s.data_agendada) > now)
        .sort((a, b) => (a.data_agendada ?? '') < (b.data_agendada ?? '') ? -1 : 1)
      return {
        id: t.id,
        nome: t.nome,
        sessoes_vendidas: ts.length + pendentesT.sessoes,
        sessoes_entregues: ts.filter(s => s.status === 'entregue').length,
        sessoes_futuras: ts.filter(s => s.status === 'pendente' || s.status === 'agendada').length + pendentesT.sessoes,
        faturamento_bruto: fat_bruto_t,
        comissao_gerada: ts.filter(s => s.status === 'entregue').reduce((a, s) => a + (s.comissao_valor || 0), 0),
        comissao_futura: ts.filter(s => s.status === 'pendente' || s.status === 'agendada').reduce((a, s) => a + (s.comissao_valor || 0), 0) + pendentesT.comissao,
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
      // Já entregue não precisa mais de ação hoje — só polui a lista com
      // linhas sem nada a fazer além de "Anular". Fica só o que ainda está
      // aguardando ou em atendimento.
      .in('status', ['agendada', 'pendente'])
      .order('data_agendada', { ascending: true })

    if (terapeutaId !== 'all') {
      hojeQ = hojeQ.eq('terapeuta_id', terapeutaId)
    }

    // Próximas consultas — depois de hoje, ainda não entregues. Um segundo
    // quadrante pra olhar o que vem pela frente, não só o dia de hoje.
    let proximasQ = supabase
      .from('sessoes')
      .select('id,data_agendada,paciente_nome,link_meet,status,status_consulta,terapeuta_id,terapeutas(nome)')
      .gt('data_agendada', hojeEnd)
      .in('status', ['agendada', 'pendente'])
      .order('data_agendada', { ascending: true })
      .limit(20)

    if (terapeutaId !== 'all') {
      proximasQ = proximasQ.eq('terapeuta_id', terapeutaId)
    }

    const [{ data: hojeData }, { data: proximasData }] = await Promise.all([hojeQ, proximasQ])

    function mapSessaoHoje(s: SessaoHojeRow) {
      return {
        id: s.id,
        horario: s.data_agendada
          ? new Date(s.data_agendada).toLocaleTimeString('pt-BR', {
              hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
            })
          : '—',
        data: s.data_agendada
          ? new Date(s.data_agendada).toLocaleDateString('pt-BR', {
              day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo',
            })
          : '—',
        paciente_nome: s.paciente_nome,
        terapeuta_nome: (s.terapeutas as { nome: string } | null)?.nome ?? '—',
        link_meet: s.link_meet,
        status: s.status,
        status_consulta: s.status_consulta ?? 'aguardando',
      }
    }

    const consultas_hoje = ((hojeData ?? []) as unknown as SessaoHojeRow[]).map(mapSessaoHoje)
    const proximas_consultas = ((proximasData ?? []) as unknown as SessaoHojeRow[]).map(mapSessaoHoje)

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
        comissao_total_vendida,
      },
      por_terapeuta,
      consultas_hoje,
      proximas_consultas,
    })
  } catch (err) {
    console.error('[terapeutas/dashboard]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
