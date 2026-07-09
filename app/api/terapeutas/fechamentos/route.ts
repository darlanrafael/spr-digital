import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarSenhaUsuario, registrarAtividade } from '@/lib/terapeutas-auth'

type SessaoPendente = {
  id: string
  sale_id: string
  numero_sessao: number
  total_sessoes: number
  comissao_valor: number
  data_entrega: string | null
  data_agendada: string | null
  paciente_nome: string
}

async function buscarPendentes(terapeutaId: string): Promise<{ sessoes: SessaoPendente[]; total: number }> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('sessoes')
    .select('id,sale_id,numero_sessao,total_sessoes,comissao_valor,data_entrega,data_agendada,paciente_nome')
    .eq('terapeuta_id', terapeutaId)
    .eq('status', 'entregue')
    .eq('comissao_paga', false)
    .order('data_entrega', { ascending: true })
  const sessoes = (data ?? []) as SessaoPendente[]
  const total = sessoes.reduce((a, s) => a + (s.comissao_valor || 0), 0)
  return { sessoes, total }
}

// Sessões vendidas mas ainda não entregues — só entram no fechamento se o
// admin escolher explicitamente antecipar o pagamento (nem sempre quer).
async function buscarFuturas(terapeutaId: string): Promise<{ sessoes: SessaoPendente[]; total: number }> {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('sessoes')
    .select('id,sale_id,numero_sessao,total_sessoes,comissao_valor,data_entrega,data_agendada,paciente_nome')
    .eq('terapeuta_id', terapeutaId)
    .in('status', ['agendada', 'pendente'])
    .eq('comissao_paga', false)
    .order('data_agendada', { ascending: true, nullsFirst: false })
  const sessoes = (data ?? []) as SessaoPendente[]
  const total = sessoes.reduce((a, s) => a + (s.comissao_valor || 0), 0)
  return { sessoes, total }
}

// ─── GET — preview (sessões pendentes de pagamento) + histórico ───────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const terapeutaId = searchParams.get('terapeutaId')
    if (!terapeutaId) return NextResponse.json({ error: 'terapeutaId é obrigatório' }, { status: 400 })

    const supabase = getSupabaseAdmin()
    const [{ sessoes, total }, futurasResp, historicoResp] = await Promise.all([
      buscarPendentes(terapeutaId),
      buscarFuturas(terapeutaId),
      supabase
        .from('fechamentos_terapeutas')
        .select('*')
        .eq('terapeuta_id', terapeutaId)
        .order('data_confirmacao', { ascending: false }),
    ])

    return NextResponse.json({
      preview: { sessoes, total },
      futuras: futurasResp,
      historico: historicoResp.data ?? [],
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
    if (usuario_tipo === 'terapeuta') {
      return NextResponse.json({ error: 'Apenas administradores podem confirmar fechamentos de comissão' }, { status: 403 })
    }

    const { valido } = await verificarSenhaUsuario(usuario_email, senha)
    if (!valido) return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 })

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
      criado_por_nome: usuario_nome,
      criado_por_email: usuario_email,
    })
    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

    const { error: updateErr } = await supabase
      .from('sessoes')
      .update({ comissao_paga: true })
      .in('id', sessoes.map(s => s.id))
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

    await registrarAtividade({
      usuario_nome,
      usuario_tipo,
      tipo_acao: 'fechamento_comissao',
      descricao: `Fechamento de comissão — ${(terapeuta as { nome: string }).nome} — ${sessoes.length} sessão(ões) — R$ ${total.toFixed(2)}`,
    })

    return NextResponse.json({ success: true, fechamento_id: fechamentoId, valor_total: total, quantidade_sessoes: sessoes.length })
  } catch (err) {
    console.error('[terapeutas/fechamentos POST]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
