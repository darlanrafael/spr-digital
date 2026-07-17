import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarSenhaUsuario, registrarAtividade } from '@/lib/terapeutas-auth'

// ─── Types ────────────────────────────────────────────────────────────────────
type SaleRow = {
  id: string
  nome: string
  email: string
  telefone: string | null
  produto: string
  plataforma: string | null
  valor_pago_cliente: number
  valor_liquido: number
  preco_base: number
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
  status_consulta: string | null
  data_agendada: string | null
  data_entrega: string | null
  link_meet: string | null
  comissao_valor: number
  comissao_paga: boolean
  paciente_nome: string
  paciente_email: string
  agendado_por: string | null
  vendedor_nome: string | null
  vendedor_email: string | null
  entregue_confirmado_por: string | null
  iniciado_em: string | null
  concluido_em: string | null
  terapeutas: { nome: string } | null
}

type OcorrenciaRow = {
  id: string
  sale_id: string
  tipo: string
  titulo: string
  descricao: string
  dados_extras: Record<string, unknown> | null
  criado_por_nome: string
  criado_por_tipo: string
  criado_por_email: string
  created_at: string
}

type RemarcacaoRow = {
  id: string
  sessao_id: string
  sale_id: string
  paciente_nome: string
  remarcado_por_nome: string
  remarcado_por_tipo: string
  solicitado_por: string
  motivo: string
  data_anterior: string
  data_nova: string
  created_at: string
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
function brasiliaToday(): Date {
  const now = new Date()
  const br = new Date(now.getTime() - 3 * 60 * 60 * 1000)
  return new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate()))
}
function brasiliaStartUTC(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 3, 0, 0)).toISOString()
}
// "all" (Todo período) retorna from/to nulos — sem filtro de data nenhum.
// Importante pra Agendamentos Pendentes/Pacientes Ativos: são listas de
// backlog, não relatório de um período, e vendas antigas não podem sumir só
// porque o preset selecionado é recente (mesmo bug já corrigido antes nos
// Pacientes Ativos/Concluídos da tela do terapeuta).
function getDateRange(preset: string, dateStart?: string, dateEnd?: string): { from: string | null; to: string | null } {
  const now = new Date()
  const today = brasiliaToday()
  const sevenDaysAgo = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 6))
  switch (preset) {
    case 'today': return { from: brasiliaStartUTC(today), to: now.toISOString() }
    case 'last_7d': return { from: brasiliaStartUTC(sevenDaysAgo), to: now.toISOString() }
    case 'custom': return { from: dateStart ?? null, to: dateEnd ?? null }
    case 'all': return { from: null, to: null }
    default: return { from: null, to: null }
  }
}

// ─── GET ──────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const datePreset = searchParams.get('datePreset') ?? 'all'
    const dateStart = searchParams.get('dateStart') ?? undefined
    const dateEnd = searchParams.get('dateEnd') ?? undefined
    const { from, to } = getDateRange(datePreset, dateStart, dateEnd)
    const supabase = getSupabaseAdmin()

    // Terapeutas ativos
    const { data: terapeutasData } = await supabase
      .from('terapeutas').select('id,nome,vendas_a_partir_de').eq('ativo', true).order('nome')
    const terapeutasRaw = (terapeutasData ?? []) as { id: string; nome: string; vendas_a_partir_de: string | null }[]
    const terapeutas = terapeutasRaw.map(t => ({ id: t.id, nome: t.nome }))

    // Antes o filtro era fixo em '%Pedro | Denise%' (o produto conjunto
    // antigo) — deixava de fora qualquer produto individual de um terapeuta
    // (ex: "Mentoria Particular - Pedro Roncada"). Filtra dinamicamente pelo
    // nome de cada terapeuta ativo.
    const nomesTerapeutas = terapeutasRaw.map(t => t.nome.trim().split(' ')[0].toLowerCase()).filter(Boolean)
    // vendas_a_partir_de: corte de data por terapeuta — vendas anteriores ao
    // corte não aparecem mais em Pendentes/Ativos (paciente é lançado
    // manualmente em vez de reconciliar contra a venda antiga importada).
    const cortePorNome = new Map(terapeutasRaw.map(t => [t.nome.trim().split(' ')[0].toLowerCase(), t.vendas_a_partir_de]))
    function saleAposCorte(v: { produto: string; data_hora: string }): boolean {
      const nomesQueBatem = nomesTerapeutas.filter(n => v.produto.toLowerCase().includes(n))
      if (nomesQueBatem.length === 0) return true
      return nomesQueBatem.some(n => {
        const corte = cortePorNome.get(n)
        return !corte || v.data_hora >= corte
      })
    }

    // Vendas paginadas
    const vendasAllTotal: SaleRow[] = []
    const PAGE = 1000
    let offset = 0
    while (true) {
      let query = supabase
        .from('sales')
        .select('id,nome,email,telefone,produto,plataforma,valor_pago_cliente,valor_liquido,preco_base,data_hora,status')
      if (nomesTerapeutas.length > 0) {
        query = query.or(nomesTerapeutas.map(n => `produto.ilike.%${n}%`).join(','))
      }
      if (from) query = query.gte('data_hora', from)
      if (to) query = query.lte('data_hora', to)
      const { data, error } = await query
        .order('data_hora', { ascending: false })
        .range(offset, offset + PAGE - 1)
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) break
      vendasAllTotal.push(...(data as SaleRow[]))
      if (data.length < PAGE) break
      offset += PAGE
    }
    // O corte só vale pra vendas SEM sessão nenhuma ainda (backlog sem
    // reconciliar) — aplicado abaixo, direto no filtro de vendasPendentes.
    // Uma venda que já tem sessão real (ex: paciente lançado manualmente)
    // sempre aparece em Ativos/Concluídos, não importa a data da compra.
    const vendasAll = vendasAllTotal

    const allSaleIds = vendasAll.map(v => v.id)

    // Sessões em lotes de 200
    const sessoesPorVenda: Record<string, SessaoRow[]> = {}
    if (allSaleIds.length > 0) {
      const BATCH = 200
      for (let i = 0; i < allSaleIds.length; i += BATCH) {
        const batch = allSaleIds.slice(i, i + BATCH)
        const { data } = await supabase
          .from('sessoes')
          .select('id,sale_id,terapeuta_id,numero_sessao,total_sessoes,status,status_consulta,data_agendada,data_entrega,link_meet,comissao_valor,comissao_paga,paciente_nome,paciente_email,agendado_por,vendedor_nome,vendedor_email,entregue_confirmado_por,iniciado_em,concluido_em,terapeutas(nome)')
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

    // Ocorrências por sale_id
    const ocorrenciasPorVenda: Record<string, OcorrenciaRow[]> = {}
    if (allSaleIds.length > 0) {
      const BATCH = 200
      for (let i = 0; i < allSaleIds.length; i += BATCH) {
        const batch = allSaleIds.slice(i, i + BATCH)
        try {
          const { data } = await supabase
            .from('ocorrencias_prontuario')
            .select('*')
            .in('sale_id', batch)
            .order('created_at', { ascending: false })
          if (data) {
            for (const o of (data as OcorrenciaRow[])) {
              if (!ocorrenciasPorVenda[o.sale_id]) ocorrenciasPorVenda[o.sale_id] = []
              ocorrenciasPorVenda[o.sale_id].push(o)
            }
          }
        } catch { /* table may not exist yet */ }
      }
    }

    // Remarcações por sessao_id
    const allSessaoIds = Object.values(sessoesPorVenda).flat().map(s => s.id)
    const remarcacoesPorSessao: Record<string, RemarcacaoRow[]> = {}
    if (allSessaoIds.length > 0) {
      const BATCH = 200
      for (let i = 0; i < allSessaoIds.length; i += BATCH) {
        const batch = allSessaoIds.slice(i, i + BATCH)
        try {
          const { data } = await supabase
            .from('remarcacoes_historico')
            .select('*')
            .in('sessao_id', batch)
            .order('created_at', { ascending: true })
          if (data) {
            for (const r of (data as RemarcacaoRow[])) {
              if (!remarcacoesPorSessao[r.sessao_id]) remarcacoesPorSessao[r.sessao_id] = []
              remarcacoesPorSessao[r.sessao_id].push(r)
            }
          }
        } catch { /* table may not exist yet */ }
      }
    }

    // Classificar vendas
    const vendasAprovadas = vendasAll.filter(v => !v.status || v.status === 'aprovada')
    const vendasReembolsos = vendasAll.filter(v =>
      ['reembolsada', 'chargeback', 'cancelada', 'em_protesto'].includes(v.status ?? '')
    )
    const vendasPendentes = vendasAprovadas.filter(v =>
      (!sessoesPorVenda[v.id] || sessoesPorVenda[v.id].length === 0) && saleAposCorte(v)
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
      ocorrencias_por_venda: ocorrenciasPorVenda,
      remarcacoes_por_sessao: remarcacoesPorSessao,
      terapeutas,
      formatos,
    })
  } catch (err) {
    console.error('[terapeutas/vendas GET]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// ─── POST — criar ocorrência (nota / remarcacao / solicitacao_reembolso) ──────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      sale_id: string
      tipo: string
      titulo: string
      descricao: string
      dados_extras?: Record<string, unknown>
      senha: string
      usuario_nome: string
      usuario_tipo: string
      usuario_email: string
    }
    const { sale_id, tipo, titulo, descricao, dados_extras, senha, usuario_nome, usuario_tipo, usuario_email } = body

    const { valido } = await verificarSenhaUsuario(usuario_email, senha)
    if (!valido) return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 })

    const supabase = getSupabaseAdmin()

    if (tipo === 'remarcacao' && dados_extras) {
      const sessao_id = dados_extras.sessao_id as string
      const nova_data = dados_extras.nova_data as string
      const data_anterior = dados_extras.data_anterior as string
      const solicitado_por = dados_extras.solicitado_por as string
      const motivo = dados_extras.motivo as string

      const { data: sessaoData } = await supabase
        .from('sessoes').select('paciente_nome').eq('id', sessao_id).single()

      await supabase.from('sessoes').update({
        data_agendada: nova_data,
        status: 'agendada',
      }).eq('id', sessao_id)

      await supabase.from('remarcacoes_historico').insert({
        sessao_id,
        sale_id,
        paciente_nome: (sessaoData as { paciente_nome: string } | null)?.paciente_nome ?? '',
        remarcado_por_nome: usuario_nome,
        remarcado_por_tipo: usuario_tipo,
        solicitado_por,
        motivo,
        data_anterior,
        data_nova: nova_data,
      })
    }

    if (tipo === 'solicitacao_reembolso' && dados_extras) {
      const de = dados_extras as {
        sessoes_ids: string[]
        sessoes_numeros: number[]
        valor_reembolso: number
        motivo: string
        paciente_nome: string
        paciente_email: string
      }
      await supabase.from('solicitacoes_reembolso').insert({
        sale_id,
        paciente_nome: de.paciente_nome,
        paciente_email: de.paciente_email,
        sessoes_ids: de.sessoes_ids,
        sessoes_numeros: de.sessoes_numeros,
        valor_reembolso: de.valor_reembolso,
        motivo: de.motivo,
        solicitado_por_nome: usuario_nome,
        solicitado_por_tipo: usuario_tipo,
        solicitado_por_email: usuario_email,
        status: 'pendente',
      })
    }

    const { data: ocorrencia, error: ocErr } = await supabase
      .from('ocorrencias_prontuario')
      .insert({
        sale_id,
        tipo,
        titulo,
        descricao,
        dados_extras: dados_extras ?? null,
        criado_por_nome: usuario_nome,
        criado_por_tipo: usuario_tipo,
        criado_por_email: usuario_email,
      })
      .select()
      .single()

    if (ocErr) throw new Error(ocErr.message)

    await registrarAtividade({
      usuario_nome,
      usuario_tipo,
      tipo_acao: tipo,
      sale_id,
      descricao,
    })

    return NextResponse.json({ success: true, ocorrencia })
  } catch (err) {
    console.error('[terapeutas/vendas POST]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
