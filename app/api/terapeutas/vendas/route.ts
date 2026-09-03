import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarAcesso, erroAcesso, registrarAtividade } from '@/lib/terapeutas-auth'
import { classificarVendas, COLUNAS_DA_TELA_DE_VENDAS, termosDeProduto } from '@/lib/vendas-por-situacao'

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
  // Sem order_id a tela não consegue chamar formatoDaVenda(), então o
  // Diagnóstico Guiado não ganha etiqueta nem quantidade de sessões correta.
  // Os demais produtos ignoram o campo, então trazê-lo não muda nada pra eles.
  order_id: string | null
  // As duas colunas novas do pacote. Declarar aqui nao e formalidade: sem elas
  // no tipo, apagar a coluna do `select` nao da erro nenhum de compilacao - o
  // campo chega `undefined` e a regra que depende dele apenas para de valer,
  // em silencio. Foi assim que a regra de venda filha ja passou verde 12 vezes
  // numa medicao por mutacao.
  pacote_pai_id: string | null
  oferta_nome: string | null
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
    // O Diagnóstico Guiado não tem nome de terapeuta nenhum no produto
    // ("Diagnóstico Guiado: Programa de acompanhamento Individual"), então o
    // filtro por primeiro nome acima nunca o encontrava e ele jamais entrava
    // em vendas_pendentes. Consequência: o botão "Agendar" da tela do Pedro
    // (que manda pra cá com ?agendar=<sale_id>) abria a página e nada
    // acontecia, porque a venda não estava na lista. Termo fixo pelo nome do
    // produto: aqui é só pré-filtro de varredura, quem decide o formato de
    // verdade é formatoDaVenda(), pela oferta.
    const termosProduto = termosDeProduto(nomesTerapeutas)
    // vendas_a_partir_de: corte de data por terapeuta — vendas anteriores ao
    // corte não aparecem mais em Pendentes/Ativos (paciente é lançado
    // manualmente em vez de reconciliar contra a venda antiga importada).
    const cortePorNome = new Map(terapeutasRaw.map(t => [t.nome.trim().split(' ')[0].toLowerCase(), t.vendas_a_partir_de]))
    function saleAposCorte(v: { produto: string; data_hora: string }): boolean {
      const nomesQueBatem = nomesTerapeutas.filter(n => v.produto.toLowerCase().includes(n))
      if (nomesQueBatem.length === 0) return true
      return nomesQueBatem.some(n => {
        const corte = cortePorNome.get(n)
        // Date, não string — vendas_a_partir_de é timestamptz (hora exata)
        // e o offset devolvido pelo Postgres não é comparável por string
        // com o formato de data_hora.
        return !corte || new Date(v.data_hora).getTime() >= new Date(corte).getTime()
      })
    }

    // Vendas paginadas por CURSOR (id crescente), não por offset.
    //
    // O `.range(offset, ...)` daqui era o mesmo bug crítico já corrigido no
    // getSales() em 04/07: `sales` recebe insert de webhook o tempo todo, e
    // com a lista ordenada por data_hora desc uma venda nova entra no topo e
    // empurra tudo pra baixo entre uma página e outra — a página seguinte
    // relê linhas já vistas e pula outras, fazendo vendas existentes sumirem
    // da tela de forma aleatória. Cursor por chave estável não desliza.
    //
    // Não estava disparando ainda (200 vendas casam com nome de terapeuta,
    // página de 1000), mas dispararia sozinho quando passasse de 1000 — sem
    // aviso nenhum, que é o pior tipo de falha.
    const vendasAllTotal: SaleRow[] = []
    const PAGE = 1000
    let cursor = ''
    while (true) {
      let query = supabase
        .from('sales')
        .select(COLUNAS_DA_TELA_DE_VENDAS)
      // Mantém o comportamento antigo de "sem terapeuta ativo, sem filtro":
      // nesse caso a varredura já traz tudo, Diagnóstico incluído.
      if (nomesTerapeutas.length > 0) {
        query = query.or(termosProduto.join(','))
      }
      if (from) query = query.gte('data_hora', from)
      if (to) query = query.lte('data_hora', to)
      if (cursor) query = query.gt('id', cursor)
      const { data, error } = await query.order('id', { ascending: true }).limit(PAGE)
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) break
      vendasAllTotal.push(...(data as SaleRow[]))
      if (data.length < PAGE) break
      cursor = String(data[data.length - 1].id)
    }
    // Ordem de exibição continua a mesma de antes (mais recente primeiro) —
    // a paginação por id é só o mecanismo de varredura.
    vendasAllTotal.sort((a, b) => String(b.data_hora ?? '').localeCompare(String(a.data_hora ?? '')))
    // Terapeuta em modo "começar do zero" (vendas_a_partir_de configurado):
    // vendas anteriores ao corte somem de Pendentes/Ativos/Concluídos aqui
    // também — mesma regra da página do terapeuta, pra essa lista geral não
    // voltar a mostrar paciente antigo que já devia estar zerado.
    const vendasAll = vendasAllTotal.filter(saleAposCorte)

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

    // Classificar vendas. A regra vive em lib/vendas-por-situacao.ts porque as
    // MESMAS perguntas são feitas no dashboard e na tela do terapeuta, e
    // discordar entre os três é invisível.
    const {
      aprovadas: vendasAprovadas, pendentes: vendasPendentes,
      ativos: vendasAtivos, filhas: vendasFilhas, reembolsos: vendasReembolsos,
    } = classificarVendas({
      vendas: vendasAll,
      aprovada: v => !v.status || v.status === 'aprovada',
      temSessao: v => (sessoesPorVenda[v.id]?.length ?? 0) > 0,
      aposCorte: saleAposCorte,
    })

    // As vendas filhas são buscadas FORA do filtro de data e do corte por
    // terapeuta. Elas saem da varredura normal por acidente de calendário: as
    // duas compras de um mesmo pacote costumam cair em dias diferentes (a
    // janela da regra é de 24h, então o par quase sempre atravessa a
    // meia-noite). Com o preset "Hoje" selecionado, a irmã sumia da lista, a
    // soma do pacote voltava a valer metade e o comercial agendava 4 sessões
    // num pacote de 8 - sem nada na tela dizendo que uma venda foi filtrada.
    // Caso real: Amanda, compras em 24/08 21:28 e 25/08 12:43.
    let filhasCompletas = vendasFilhas
    const idsQueSaoPai = [...vendasPendentes, ...vendasAtivos].map(v => v.id)
    if (idsQueSaoPai.length > 0) {
      const achadas: SaleRow[] = []
      for (let i = 0; i < idsQueSaoPai.length; i += 200) {
        const { data } = await supabase
          .from('sales').select(COLUNAS_DA_TELA_DE_VENDAS)
          .in('pacote_pai_id', idsQueSaoPai.slice(i, i + 200))
        achadas.push(...((data ?? []) as SaleRow[]))
      }
      const porId = new Map(filhasCompletas.map(v => [v.id, v]))
      for (const v of achadas) porId.set(v.id, v)
      filhasCompletas = [...porId.values()]
    }
    const formatos = [...new Set(vendasAll.map(v => v.produto))].sort()

    return NextResponse.json({
      counts: {
        aprovadas: vendasAprovadas.length,
        pendentes: vendasPendentes.length,
        ativos: vendasAtivos.length,
        reembolsos: vendasReembolsos.length,
      },
      vendas_pendentes: vendasPendentes,
      vendas_filhas: filhasCompletas,
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
      sessao_id?: string
      dados_extras?: Record<string, unknown>
      senha?: string
      token?: string
      usuario_nome: string
      usuario_tipo: string
      usuario_email: string
    }
    const { sale_id, tipo, titulo, descricao, sessao_id, dados_extras, senha, token, usuario_nome, usuario_tipo, usuario_email } = body

    // Inclui `tipo === 'reembolso_parcial'`, que aqui é só a SOLICITAÇÃO —
    // quem aprova é /api/terapeutas/aprovacoes, que continua exigindo senha.
    const acesso = await verificarAcesso({ usuario_email, senha, token })
    if (!acesso.valido) {
      const { error, status } = erroAcesso(acesso)
      return NextResponse.json({ error }, { status })
    }

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

    if (tipo === 'orientacao_sessao') {
      if (!sessao_id) {
        return NextResponse.json({ error: 'Selecione a sessão' }, { status: 400 })
      }

      const { data: sessaoRow, error: sessaoErr } = await supabase
        .from('sessoes').select('id,data_agendada').eq('id', sessao_id).single()
      if (sessaoErr || !sessaoRow) {
        return NextResponse.json({ error: 'Sessão não encontrada' }, { status: 404 })
      }

      if (sessaoRow.data_agendada) {
        const faltamMs = new Date(sessaoRow.data_agendada).getTime() - Date.now()
        if (faltamMs < 40 * 60 * 1000) {
          return NextResponse.json(
            { error: 'Faltam menos de 40 minutos para a sessão — não dá mais tempo de entrar no lembrete automático.' },
            { status: 400 }
          )
        }
      }

      const { data: existente } = await supabase
        .from('ocorrencias_prontuario')
        .select('id')
        .eq('sessao_id', sessao_id)
        .eq('tipo', 'orientacao_sessao')
        .maybeSingle()
      if (existente) {
        return NextResponse.json(
          { error: 'Já existe uma orientação registrada para essa sessão — edite a existente em vez de criar outra.' },
          { status: 409 }
        )
      }
    }

    const { data: ocorrencia, error: ocErr } = await supabase
      .from('ocorrencias_prontuario')
      .insert({
        sale_id,
        // Cai pro sessao_id de dentro de dados_extras quando o chamador só
        // preenche lá (ex: fluxo antigo de remarcação) — mantém a coluna nova
        // sempre preenchida sem precisar mudar todo caller hoje.
        sessao_id: sessao_id ?? (dados_extras?.sessao_id as string | undefined) ?? null,
        tipo,
        titulo: tipo === 'orientacao_sessao' ? 'ORIENTAÇÃO DA SESSÃO:' : titulo,
        descricao,
        dados_extras: dados_extras ?? null,
        criado_por_nome: usuario_nome,
        criado_por_tipo: usuario_tipo,
        criado_por_email: usuario_email,
      })
      .select()
      .single()

    if (ocErr) {
      // Fast-path check above can miss under a race (two near-simultaneous
      // requests both pass the SELECT before either INSERT completes); the
      // partial unique index on ocorrencias_prontuario(sessao_id) WHERE
      // tipo = 'orientacao_sessao' is the real guard, and Postgres reports a
      // violation of it as unique_violation (23505) via PostgREST.
      if (ocErr.code === '23505') {
        return NextResponse.json(
          { error: 'Já existe uma orientação registrada para essa sessão — edite a existente em vez de criar outra.' },
          { status: 409 }
        )
      }
      throw new Error(ocErr.message)
    }

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

// ─── PUT — editar ocorrência do tipo orientacao_sessao ────────────────────────
// Único tipo editável — os demais (nota, remarcação, reembolso) continuam
// sendo histórico imutável, só inserção.
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as {
      id: string
      descricao: string
      senha?: string
      token?: string
      usuario_nome: string
      usuario_tipo: string
      usuario_email: string
    }
    const { id, descricao, senha, token, usuario_nome, usuario_tipo, usuario_email } = body

    const acesso = await verificarAcesso({ usuario_email, senha, token })
    if (!acesso.valido) {
      const { error, status } = erroAcesso(acesso)
      return NextResponse.json({ error }, { status })
    }

    const supabase = getSupabaseAdmin()

    const { data: existente, error: fetchErr } = await supabase
      .from('ocorrencias_prontuario').select('id,tipo,sessao_id').eq('id', id).single()
    if (fetchErr || !existente) {
      return NextResponse.json({ error: 'Ocorrência não encontrada' }, { status: 404 })
    }
    if (existente.tipo !== 'orientacao_sessao') {
      return NextResponse.json({ error: 'Esse tipo de ocorrência não pode ser editado' }, { status: 400 })
    }

    if (existente.sessao_id) {
      const { data: sessaoRow } = await supabase
        .from('sessoes').select('data_agendada').eq('id', existente.sessao_id).single()
      if (sessaoRow?.data_agendada) {
        const faltamMs = new Date(sessaoRow.data_agendada).getTime() - Date.now()
        if (faltamMs < 40 * 60 * 1000) {
          return NextResponse.json(
            { error: 'Faltam menos de 40 minutos para a sessão — não é mais possível editar a orientação.' },
            { status: 400 }
          )
        }
      }
    }

    const { data: ocorrencia, error: updErr } = await supabase
      .from('ocorrencias_prontuario')
      .update({ titulo: 'ORIENTAÇÃO DA SESSÃO:', descricao })
      .eq('id', id)
      .select()
      .single()
    if (updErr) throw new Error(updErr.message)

    await registrarAtividade({
      usuario_nome,
      usuario_tipo,
      tipo_acao: 'orientacao_sessao_editada',
      sessao_id: existente.sessao_id ?? undefined,
      descricao,
    })

    return NextResponse.json({ success: true, ocorrencia })
  } catch (err) {
    console.error('[terapeutas/vendas PUT]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
