import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarSenhaUsuario, registrarAtividade } from '@/lib/terapeutas-auth'

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as {
      sessao_id: string
      acao: 'iniciar' | 'concluir' | 'anular'
      motivo?: string
      senha: string
      usuario_nome: string
      usuario_tipo: string
      usuario_email: string
    }
    const { sessao_id, acao, motivo, senha, usuario_nome, usuario_tipo, usuario_email } = body

    if (!sessao_id || !acao || !senha || !usuario_email) {
      return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 })
    }

    const { valido } = await verificarSenhaUsuario(usuario_email, senha)
    if (!valido) return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 })

    const supabase = getSupabaseAdmin()

    const { data: sessao } = await supabase
      .from('sessoes')
      .select('id,sale_id,status,status_consulta,paciente_nome,numero_sessao')
      .eq('id', sessao_id)
      .single()
    if (!sessao) return NextResponse.json({ error: 'Sessão não encontrada' }, { status: 404 })

    const now = new Date().toISOString()
    const horaLocal = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
    let updateData: Record<string, unknown> = {}
    let ocorrenciaTipo = 'nota'
    let ocorrenciaTitulo = ''
    let ocorrenciaDesc = ''
    let logAcao: string = acao

    if (acao === 'iniciar') {
      updateData = { status_consulta: 'em_atendimento', iniciado_em: now }
      ocorrenciaTitulo = `Consulta Iniciada — Sessão ${sessao.numero_sessao}`
      ocorrenciaDesc = `Consulta iniciada por ${usuario_nome} às ${horaLocal}`
    } else if (acao === 'concluir') {
      updateData = {
        status_consulta: 'concluida',
        status: 'entregue',
        data_entrega: now,
        concluido_em: now,
        entregue_confirmado_por: usuario_nome,
      }
      ocorrenciaTipo = 'confirmacao_entrega'
      ocorrenciaTitulo = `Consulta Concluída — Sessão ${sessao.numero_sessao}`
      ocorrenciaDesc = `Consulta concluída por ${usuario_nome} às ${horaLocal}`
      logAcao = 'confirmacao_entrega'
    } else if (acao === 'anular') {
      if (!motivo || motivo.trim().length < 10) {
        return NextResponse.json({ error: 'Motivo obrigatório (mínimo 10 caracteres)' }, { status: 400 })
      }
      updateData = {
        status_consulta: 'aguardando',
        status: 'agendada',
        data_entrega: null,
        entregue_confirmado_por: null,
        concluido_em: null,
      }
      ocorrenciaTitulo = `Sessão Anulada — Sessão ${sessao.numero_sessao}`
      ocorrenciaDesc = `Sessão anulada por ${usuario_nome}. Motivo: ${motivo}`
      logAcao = 'cancelamento'
    } else {
      return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })
    }

    const { error: updateErr } = await supabase.from('sessoes').update(updateData).eq('id', sessao_id)
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

    await supabase.from('ocorrencias_prontuario').insert({
      sale_id: sessao.sale_id,
      tipo: ocorrenciaTipo,
      titulo: ocorrenciaTitulo,
      descricao: ocorrenciaDesc,
      dados_extras: { sessao_id, acao, motivo: motivo ?? null },
      criado_por_nome: usuario_nome,
      criado_por_tipo: usuario_tipo,
      criado_por_email: usuario_email,
    })

    await registrarAtividade({
      usuario_nome,
      usuario_tipo,
      tipo_acao: logAcao,
      sessao_id,
      sale_id: sessao.sale_id,
      descricao: ocorrenciaDesc,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[sessoes PATCH]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
