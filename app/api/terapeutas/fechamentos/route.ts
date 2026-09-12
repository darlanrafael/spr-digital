import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarSenhaUsuario, registrarAtividade } from '@/lib/terapeutas-auth'
import { entreguesDesdeOFechamento } from '@/lib/entregues-desde-o-fechamento'

type SessaoPendente = {
  id: string
  sale_id: string
  numero_sessao: number
  total_sessoes: number
  comissao_valor: number
  data_entrega: string | null
  data_agendada: string | null
  paciente_nome: string
  /** Vem de `sales`, nao de `sessoes`. A tela agrupa por ele. */
  produto?: string | null
  /** So vem preenchido na busca de ENTREGUES, que inclui as ja pagas. */
  comissao_paga?: boolean | null
}

// O produto nao esta em `sessoes` - ele vive em `sales`. A tela agrupa as
// sessoes por produto (pedido do usuario em 11/09/2026), e sem este campo tudo
// cairia num grupo so. Ver lib/sessoes-por-produto.ts.
//
// Em lotes de 100 de proposito: o `in()` do PostgREST tem teto de 1000 linhas,
// ja confirmado ativo neste projeto, e a Denise sozinha tem 139 sessoes.
// Pagina por cursor em vez de confiar no default do PostgREST, que corta em
// 1000 linhas EM SILENCIO - teto confirmado ativo neste projeto. Hoje o Pedro
// tem 474 sessoes e a Denise 139, entao nada e cortado; o problema aparece sem
// aviso quando passar, e esta e a tela que decide quanto a terapeuta recebe.
async function todasAsSessoes(
  terapeutaId: string,
  aplicar: (q: ReturnType<ReturnType<typeof getSupabaseAdmin>['from']>['select']) => unknown,
): Promise<SessaoPendente[]> {
  const supabase = getSupabaseAdmin()
  const COLUNAS = 'id,sale_id,numero_sessao,total_sessoes,comissao_valor,comissao_paga,data_entrega,data_agendada,paciente_nome'
  const acc: SessaoPendente[] = []
  let cursor = ''
  for (;;) {
    let q = supabase.from('sessoes').select(COLUNAS).eq('terapeuta_id', terapeutaId).order('id').limit(999)
    q = aplicar(q as never) as typeof q
    if (cursor) q = q.gt('id', cursor)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    if (!data?.length) break
    acc.push(...(data as SessaoPendente[]))
    cursor = (data[data.length - 1] as { id: string }).id
    if (data.length < 999) break
  }
  return acc
}

async function comProduto(sessoes: SessaoPendente[]): Promise<SessaoPendente[]> {
  const ids = [...new Set(sessoes.map(s => s.sale_id).filter(Boolean))]
  if (ids.length === 0) return sessoes
  const supabase = getSupabaseAdmin()
  const produto = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await supabase.from('sales').select('id,produto').in('id', ids.slice(i, i + 100))
    for (const v of data ?? []) produto.set(v.id as string, String(v.produto ?? ''))
  }
  return sessoes.map(s => ({ ...s, produto: produto.get(s.sale_id) ?? null }))
}

async function buscarPendentes(terapeutaId: string): Promise<{ sessoes: SessaoPendente[]; total: number }> {
  const cruas = await todasAsSessoes(terapeutaId, q =>
    (q as never as { eq: (c: string, v: unknown) => unknown }).eq('status', 'entregue'))
  const sessoes = await comProduto(
    cruas.filter(s => !s.comissao_paga)
      .sort((a, b) => String(a.data_entrega ?? '').localeCompare(String(b.data_entrega ?? ''))))
  const total = sessoes.reduce((a, s) => a + (s.comissao_valor || 0), 0)
  return { sessoes, total }
}

// Sessões vendidas mas ainda não entregues — só entram no fechamento se o
// admin escolher explicitamente antecipar o pagamento (nem sempre quer).
async function buscarFuturas(terapeutaId: string): Promise<{ sessoes: SessaoPendente[]; total: number }> {
  const cruas = await todasAsSessoes(terapeutaId, q =>
    (q as never as { in: (c: string, v: unknown[]) => unknown }).in('status', ['agendada', 'pendente']))
  const sessoes = await comProduto(
    cruas.filter(s => !s.comissao_paga)
      .sort((a, b) => String(a.data_agendada ?? '').localeCompare(String(b.data_agendada ?? ''))))
  const total = sessoes.reduce((a, s) => a + (s.comissao_valor || 0), 0)
  return { sessoes, total }
}

// TODAS as entregues, pagas ou nao. E a base do bloco "entregues desde o ultimo
// fechamento": a tela de pagamento mostra so o pendente, entao sessao ja paga
// por antecipacao sumia - e foi isso que fez o usuario contar 13 atendimentos
// onde a tela mostrava 10, em 11/09/2026.
async function buscarEntregues(terapeutaId: string): Promise<SessaoPendente[]> {
  const cruas = await todasAsSessoes(terapeutaId, q =>
    (q as never as { eq: (c: string, v: unknown) => unknown }).eq('status', 'entregue'))
  return comProduto(cruas.sort((a, b) =>
    String(a.data_entrega ?? '').localeCompare(String(b.data_entrega ?? ''))))
}

// ─── GET — preview (sessões pendentes de pagamento) + histórico ───────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const terapeutaId = searchParams.get('terapeutaId')
    if (!terapeutaId) return NextResponse.json({ error: 'terapeutaId é obrigatório' }, { status: 400 })

    const supabase = getSupabaseAdmin()
    const [{ sessoes, total }, futurasResp, historicoResp, entregues] = await Promise.all([
      buscarPendentes(terapeutaId),
      buscarFuturas(terapeutaId),
      supabase
        .from('fechamentos_terapeutas')
        .select('*')
        .eq('terapeuta_id', terapeutaId)
        .order('data_confirmacao', { ascending: false }),
      buscarEntregues(terapeutaId),
    ])

    const historico = historicoResp.data ?? []

    return NextResponse.json({
      preview: { sessoes, total },
      futuras: futurasResp,
      historico,
      // Entregues desde o ultimo fechamento, INCLUINDO as ja pagas - com a
      // etiqueta dizendo qual fechamento pagou cada uma.
      desdeUltimo: entreguesDesdeOFechamento({
        sessoes: entregues,
        fechamentos: historico as { id: string; data_confirmacao: string; sessoes?: { id?: string }[] }[],
      }),
    })
  } catch (err) {
    console.error('[terapeutas/fechamentos GET]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// ─── POST — confirmar fechamento (marca sessões como pagas) ───────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      terapeuta_id: string
      senha: string
      usuario_nome: string
      usuario_tipo: string
      usuario_email: string
      sessoes_futuras_ids?: string[]
    }
    const { terapeuta_id, senha, usuario_nome, usuario_tipo, usuario_email, sessoes_futuras_ids } = body

    if (!terapeuta_id || !senha || !usuario_email) {
      return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 })
    }

    // O papel vem do BANCO, nunca do corpo da requisição.
    //
    // Antes o gate era `if (usuario_tipo === 'terapeuta')` lendo `usuario_tipo`
    // do body — um campo que quem chama escolhe. `verificarSenhaUsuario`
    // devolvia o registro real em `usuario`, mas o código só usava `{ valido }`
    // e jogava fora o tipo verdadeiro. Na prática: a própria terapeuta, com o
    // login legítimo dela, mandava `usuario_tipo: "admin"` e liberava o
    // pagamento da própria comissão — e o atividades_log registrava "admin",
    // então nem a auditoria pegava. Confirmado em teste em 10/08/2026.
    //
    // Só admin confirma fechamento: quem paga é o CEO, ninguém mais.
    const { valido, usuario } = await verificarSenhaUsuario(usuario_email, senha)
    if (!valido) return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 })

    const tipoReal = (usuario as Record<string, unknown> | undefined)?.tipo as string ?? ''
    const nomeReal = (usuario as Record<string, unknown> | undefined)?.nome as string ?? usuario_email
    if (tipoReal !== 'admin') {
      return NextResponse.json(
        { error: 'Apenas administradores podem confirmar fechamentos de comissão' },
        { status: 403 },
      )
    }

    const supabase = getSupabaseAdmin()

    const { data: terapeuta } = await supabase
      .from('terapeutas').select('id,nome').eq('id', terapeuta_id).single()
    if (!terapeuta) return NextResponse.json({ error: 'Terapeuta não encontrado' }, { status: 404 })

    const { sessoes: sessoesEntregues } = await buscarPendentes(terapeuta_id)

    // Sessões futuras selecionadas pra antecipar — sempre opcional, o admin
    // escolhe caso a caso. Revalida contra o banco (não confia em IDs soltos
    // do front) pra garantir que são realmente dessa terapeuta, ainda não
    // entregues e ainda não pagas.
    let sessoesAntecipadas: SessaoPendente[] = []
    if (sessoes_futuras_ids && sessoes_futuras_ids.length > 0) {
      const { sessoes: futurasDisponiveis } = await buscarFuturas(terapeuta_id)
      const idsValidos = new Set(sessoes_futuras_ids)
      sessoesAntecipadas = futurasDisponiveis.filter(s => idsValidos.has(s.id))
    }

    const sessoes = [...sessoesEntregues, ...sessoesAntecipadas]
    const total = sessoes.reduce((a, s) => a + (s.comissao_valor || 0), 0)

    if (sessoes.length === 0) {
      return NextResponse.json({ error: 'Nenhuma sessão pendente de pagamento para este terapeuta' }, { status: 400 })
    }

    const fechamentoId = randomUUID()
    const { error: insertErr } = await supabase.from('fechamentos_terapeutas').insert({
      id: fechamentoId,
      terapeuta_id,
      terapeuta_nome: (terapeuta as { nome: string }).nome,
      valor_total: total,
      quantidade_sessoes: sessoes.length,
      sessoes,
      // Nome também do banco: quem confirmou o pagamento é registro
      // financeiro, não pode depender do que o cliente mandou no corpo.
      criado_por_nome: nomeReal,
      criado_por_email: usuario_email,
    })
    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

    const { error: updateErr } = await supabase
      .from('sessoes')
      .update({ comissao_paga: true })
      .in('id', sessoes.map(s => s.id))
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

    await registrarAtividade({
      usuario_nome: nomeReal,
      usuario_tipo: tipoReal,
      tipo_acao: 'fechamento_comissao',
      descricao: `Fechamento de comissão — ${(terapeuta as { nome: string }).nome} — ${sessoes.length} sessão(ões) — R$ ${total.toFixed(2)}`,
    })

    return NextResponse.json({ success: true, fechamento_id: fechamentoId, valor_total: total, quantidade_sessoes: sessoes.length })
  } catch (err) {
    console.error('[terapeutas/fechamentos POST]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
