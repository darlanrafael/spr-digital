import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarSenhaUsuario, registrarAtividade } from '@/lib/terapeutas-auth'
import { lerIdentidade, podeAdministrar, podeMexerEmVenda } from '@/lib/identidade-da-chamada'
import { decisaoDaFalta } from '@/lib/falta-comissao'

// Aprovacao de comissao de FALTA (nao compareceu) da Denise/Leomir.
//
// Quando elas marcam "nao compareceu", a sessao ja vira entregue com comissao
// ZERADA e cai aqui como pendente, guardando o valor original. O dono decide:
//   - Pagar    -> falta 'aprovado', a comissao VOLTA pra sessao (passa a contar).
//   - Nao pagar -> falta 'negado', a comissao da sessao continua 0.
// Mesmo padrao da aprovacao de reembolso. Ver item 125 do spr-digital.md.

type Falta = {
  id: string
  sessao_id: string
  sale_id: string | null
  terapeuta_id: string | null
  terapeuta_nome: string | null
  paciente_nome: string | null
  paciente_email: string | null
  numero_sessao: number | null
  total_sessoes: number | null
  data_sessao: string | null
  comissao_valor: number
  status: string
  solicitado_por_nome: string | null
  created_at: string
  decidido_por_nome: string | null
  decidido_em: string | null
}

function fmtBRL(n: number) {
  return 'R$ ' + new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

export async function GET(req: NextRequest) {
  try {
    const quem = lerIdentidade(req)
    if (!quem) return NextResponse.json({ error: 'Você precisa entrar no sistema.' }, { status: 401 })
    if (!podeMexerEmVenda(quem)) return NextResponse.json({ error: 'Sem permissão para ver as aprovações.' }, { status: 403 })

    const supabase = getSupabaseAdmin()

    if (req.nextUrl.searchParams.get('count') === 'true') {
      const { count } = await supabase
        .from('solicitacoes_falta_comissao')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pendente')
      return NextResponse.json({ pendentes_count: count ?? 0 })
    }

    const [pendentesRes, historicoRes] = await Promise.all([
      supabase.from('solicitacoes_falta_comissao')
        .select('*').eq('status', 'pendente').order('created_at', { ascending: false }),
      supabase.from('solicitacoes_falta_comissao')
        .select('*').neq('status', 'pendente').order('decidido_em', { ascending: false }).limit(50),
    ])

    return NextResponse.json({
      pendentes: (pendentesRes.data ?? []) as Falta[],
      historico: (historicoRes.data ?? []) as Falta[],
    })
  } catch (err) {
    console.error('[aprovacoes/falta-comissao GET]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as {
      id: string
      acao: 'pagar' | 'nao_pagar'
      senha: string
      usuario_nome: string
      usuario_email: string
    }
    const { id, acao, senha, usuario_nome, usuario_email } = body

    if (!id || (acao !== 'pagar' && acao !== 'nao_pagar')) {
      return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
    }

    const { valido } = await verificarSenhaUsuario(usuario_email, senha)
    if (!valido) return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 })

    // Decidir comissao e do CEO. Mesma guarda da aprovacao de reembolso: a
    // senha correta de qualquer usuario nao basta, tem que ser admin.
    const quem = lerIdentidade(req)
    if (!quem) return NextResponse.json({ error: 'Você precisa entrar no sistema.' }, { status: 401 })
    if (!podeAdministrar(quem)) {
      return NextResponse.json({ error: 'Só um administrador pode fazer isso.' }, { status: 403 })
    }

    const supabase = getSupabaseAdmin()

    const { data: falta } = await supabase
      .from('solicitacoes_falta_comissao').select('*').eq('id', id).single()
    if (!falta) return NextResponse.json({ error: 'Falta não encontrada' }, { status: 404 })
    const f = falta as Falta
    if (f.status !== 'pendente') {
      return NextResponse.json({ error: 'Esta falta já foi decidida.' }, { status: 409 })
    }

    const { novoStatusFalta, comissaoDaSessao } = decisaoDaFalta(acao, f.comissao_valor)

    // Marca a decisao na falta ANTES de mexer na sessao: se o update da sessao
    // falhar, a falta fica decidida e o rastro aponta pra conferencia - em vez
    // de sumir da fila sem nada ter acontecido.
    const { error: faltaErr } = await supabase.from('solicitacoes_falta_comissao').update({
      status: novoStatusFalta,
      decidido_por_nome: usuario_nome,
      decidido_por_email: usuario_email,
      decidido_em: new Date().toISOString(),
    }).eq('id', id)
    if (faltaErr) return NextResponse.json({ error: faltaErr.message }, { status: 500 })

    // Pagar: devolve a comissao pra sessao (passa a contar no "a pagar"). Nao
    // pagar: a sessao ja esta com 0, nao precisa mexer.
    if (acao === 'pagar') {
      const { error: sessErr } = await supabase.from('sessoes')
        .update({ comissao_valor: comissaoDaSessao }).eq('id', f.sessao_id)
      if (sessErr) return NextResponse.json({ error: sessErr.message }, { status: 500 })
    }

    const aprovou = acao === 'pagar'
    const { error: notaErr } = await supabase.from('ocorrencias_prontuario').insert({
      sale_id: f.sale_id,
      sessao_id: f.sessao_id,
      tipo: aprovou ? 'falta_comissao_aprovada' : 'falta_comissao_negada',
      titulo: aprovou ? 'Comissão da falta aprovada pelo CEO' : 'Comissão da falta negada pelo CEO',
      descricao: aprovou
        ? `Falta da sessão ${f.numero_sessao} (${f.terapeuta_nome ?? ''}): comissão de ${fmtBRL(f.comissao_valor)} aprovada por ${usuario_nome}.`
        : `Falta da sessão ${f.numero_sessao} (${f.terapeuta_nome ?? ''}): comissão de ${fmtBRL(f.comissao_valor)} NÃO paga, por decisão de ${usuario_nome}.`,
      dados_extras: { falta_id: id, sessao_id: f.sessao_id, comissao_valor: f.comissao_valor, decisao: acao },
      criado_por_nome: usuario_nome,
      criado_por_tipo: 'admin',
      criado_por_email: usuario_email,
    })
    if (notaErr) console.error('[ocorrencias_prontuario] nota da falta nao gravada:', notaErr)

    await registrarAtividade({
      usuario_nome,
      usuario_tipo: 'admin',
      tipo_acao: aprovou ? 'falta_comissao_aprovada' : 'falta_comissao_negada',
      sessao_id: f.sessao_id,
      sale_id: f.sale_id ?? undefined,
      descricao: aprovou
        ? `Comissão de falta aprovada (${fmtBRL(f.comissao_valor)}) — ${f.terapeuta_nome ?? ''} — paciente: ${f.paciente_nome ?? ''}`
        : `Comissão de falta negada — ${f.terapeuta_nome ?? ''} — paciente: ${f.paciente_nome ?? ''}`,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[aprovacoes/falta-comissao PATCH]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
