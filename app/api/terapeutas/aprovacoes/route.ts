import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarSenhaUsuario, registrarAtividade } from '@/lib/terapeutas-auth'
import { cancelarEvento } from '@/lib/google-meet'
import { planejarAprovacaoReembolso } from '@/lib/aprovacao-reembolso'

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
      // O que for cancelado de fato pode ser menor que o pedido: sessão que já
      // estava cancelada não entra de novo. O prontuário registra o que
      // aconteceu, não o que foi pedido.
      let canceladas: string[] = []
      let eventosACancelar: string[] = []

      if (s.sessoes_ids.length > 0) {
        const { data: alvo, error: lerErr } = await supabase
          .from('sessoes')
          .select('id, numero_sessao, status, google_event_id')
          .in('id', s.sessoes_ids)
        if (lerErr) return NextResponse.json({ error: lerErr.message }, { status: 500 })

        const plano = planejarAprovacaoReembolso(alvo ?? [])
        if (!plano.ok) {
          return NextResponse.json({
            error: `Esta solicitação está desatualizada: a sessão ${plano.numeros.join(', ')} já foi entregue depois que o pedido foi aberto. O valor de ${fmtBRL(s.valor_reembolso)} foi calculado contando com ela. Cancele esta solicitação e abra outra com as sessões que ainda faltam.`,
          }, { status: 409 })
        }
        canceladas = plano.cancelar
        eventosACancelar = plano.eventosACancelar
      }

      // Só marca como aprovado DEPOIS de validar. Na ordem anterior o update
      // vinha primeiro, então uma recusa deixaria a solicitação como
      // 'aprovado' com zero sessão cancelada: o pedido sumia da fila do CEO
      // sem nada ter acontecido.
      const { error: solErr } = await supabase.from('solicitacoes_reembolso').update({
        status: 'aprovado',
        aprovado_por_nome: usuario_nome,
        aprovado_por_email: usuario_email,
        updated_at: new Date().toISOString(),
      }).eq('id', id)
      if (solErr) return NextResponse.json({ error: solErr.message }, { status: 500 })

      if (canceladas.length > 0) {
        // link_meet e google_event_id saem junto do status: sessão cancelada
        // não existe mais para o paciente, e deixar o link na tela do
        // terapeuta convida a entrar numa sala de sessão reembolsada.
        const { error: updErr } = await supabase
          .from('sessoes')
          .update({ status: 'cancelada', link_meet: null, google_event_id: null })
          .in('id', canceladas)
        // Sem conferir o erro, um update que falhasse deixava o pedido marcado
        // como aprovado e as sessões vivas na agenda, sem nada na tela.
        if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
      }

      // O convite continuava na agenda do PACIENTE com o link do Meet
      // funcionando: do lado do sistema a sessão sumia, do lado dele não, e ele
      // podia entrar na sala no horário de uma sessão reembolsada. Depois do
      // update de propósito: o cancelamento no banco é o que vale, e evento no
      // Google pode ser cancelado a qualquer momento depois.
      for (const eventId of eventosACancelar) await cancelarEvento(eventId)

      await supabase.from('ocorrencias_prontuario').insert({
        sale_id: s.sale_id,
        tipo: 'reembolso_aprovado',
        titulo: 'Reembolso aprovado pelo CEO',
        descricao: `Reembolso de ${fmtBRL(s.valor_reembolso)} aprovado por ${usuario_nome}. ${canceladas.length} sessão(ões) cancelada(s).`,
        dados_extras: { solicitacao_id: id, sessoes_ids: canceladas, valor_reembolso: s.valor_reembolso },
        criado_por_nome: usuario_nome,
        criado_por_tipo: 'admin',
        criado_por_email: usuario_email,
      })

      await registrarAtividade({
        usuario_nome,
        usuario_tipo: 'admin',
        tipo_acao: 'reembolso_aprovado',
        sale_id: s.sale_id,
        descricao: `Reembolso parcial aprovado - ${fmtBRL(s.valor_reembolso)} - paciente: ${s.paciente_nome}`,
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
