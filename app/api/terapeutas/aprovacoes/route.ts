import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarSenhaUsuario, registrarAtividade } from '@/lib/terapeutas-auth'

type Solicitacao = {
  id: string
  sale_id: string
  paciente_nome: string
  paciente_email: string
  sessoes_ids: string[]
  sessoes_numeros: number[]
  valor_reembolso: number
  motivo: string
  solicitado_por_nome: string
  solicitado_por_tipo: string
  solicitado_por_email: string
  status: string
  aprovado_por_nome: string | null
  aprovado_por_email: string | null
  justificativa_rejeicao: string | null
  created_at: string
  updated_at: string
}

function fmtBRL(n: number) {
  return 'R$ ' + new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl
    const supabase = getSupabaseAdmin()

    if (searchParams.get('count') === 'true') {
      const { count } = await supabase
        .from('solicitacoes_reembolso')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pendente')
      return NextResponse.json({ pendentes_count: count ?? 0 })
    }

    const [pendentesRes, historicoRes] = await Promise.all([
      supabase.from('solicitacoes_reembolso')
        .select('*')
        .eq('status', 'pendente')
        .order('created_at', { ascending: false }),
      supabase.from('solicitacoes_reembolso')
        .select('*')
        .neq('status', 'pendente')
        .order('updated_at', { ascending: false })
        .limit(50),
    ])

    return NextResponse.json({
      pendentes: (pendentesRes.data ?? []) as Solicitacao[],
      historico: (historicoRes.data ?? []) as Solicitacao[],
    })
  } catch (err) {
    console.error('[aprovacoes GET]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as {
      id: string
      acao: 'aprovar' | 'rejeitar'
      justificativa?: string
      senha: string
      usuario_nome: string
      usuario_email: string
    }
    const { id, acao, justificativa, senha, usuario_nome, usuario_email } = body

    const { valido } = await verificarSenhaUsuario(usuario_email, senha)
    if (!valido) return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 })

    const supabase = getSupabaseAdmin()

    const { data: sol } = await supabase
      .from('solicitacoes_reembolso').select('*').eq('id', id).single()
    if (!sol) return NextResponse.json({ error: 'Solicitação não encontrada' }, { status: 404 })
    const s = sol as Solicitacao

    if (acao === 'aprovar') {
      await supabase.from('solicitacoes_reembolso').update({
        status: 'aprovado',
        aprovado_por_nome: usuario_nome,
        aprovado_por_email: usuario_email,
        updated_at: new Date().toISOString(),
      }).eq('id', id)

      if (s.sessoes_ids.length > 0) {
        await supabase.from('sessoes').update({ status: 'cancelada' }).in('id', s.sessoes_ids)
      }

      await supabase.from('ocorrencias_prontuario').insert({
        sale_id: s.sale_id,
        tipo: 'reembolso_aprovado',
        titulo: 'Reembolso aprovado pelo CEO',
        descricao: `Reembolso de ${fmtBRL(s.valor_reembolso)} aprovado por ${usuario_nome}. ${s.sessoes_ids.length} sessão(ões) cancelada(s).`,
        dados_extras: { solicitacao_id: id, sessoes_ids: s.sessoes_ids, valor_reembolso: s.valor_reembolso },
        criado_por_nome: usuario_nome,
        criado_por_tipo: 'admin',
        criado_por_email: usuario_email,
      })

      await registrarAtividade({
        usuario_nome,
        usuario_tipo: 'admin',
        tipo_acao: 'reembolso_aprovado',
        sale_id: s.sale_id,
        descricao: `Reembolso parcial aprovado — ${fmtBRL(s.valor_reembolso)} — paciente: ${s.paciente_nome}`,
        dados_novos: { solicitacao_id: id, valor_reembolso: s.valor_reembolso },
      })
    } else {
      if (!justificativa || justificativa.trim().length < 10) {
        return NextResponse.json({ error: 'Justificativa obrigatória (mínimo 10 caracteres)' }, { status: 400 })
      }

      await supabase.from('solicitacoes_reembolso').update({
        status: 'rejeitado',
        aprovado_por_nome: usuario_nome,
        aprovado_por_email: usuario_email,
        justificativa_rejeicao: justificativa,
        updated_at: new Date().toISOString(),
      }).eq('id', id)

      await supabase.from('ocorrencias_prontuario').insert({
        sale_id: s.sale_id,
        tipo: 'reembolso_rejeitado',
        titulo: 'Solicitação de reembolso rejeitada',
        descricao: `Rejeição de reembolso por ${usuario_nome}. Justificativa: ${justificativa}`,
        dados_extras: { solicitacao_id: id, justificativa },
        criado_por_nome: usuario_nome,
        criado_por_tipo: 'admin',
        criado_por_email: usuario_email,
      })

      await registrarAtividade({
        usuario_nome,
        usuario_tipo: 'admin',
        tipo_acao: 'reembolso_rejeitado',
        sale_id: s.sale_id,
        descricao: `Reembolso rejeitado — paciente: ${s.paciente_nome} — justificativa: ${justificativa}`,
      })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[aprovacoes PATCH]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
