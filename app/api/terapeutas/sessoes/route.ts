import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarAcesso, erroAcesso, registrarAtividade, brasiliaLocalToISO } from '@/lib/terapeutas-auth'

// Sessões de UMA venda, lidas na hora.
//
// Existe pro modal de agendamento poder reler antes de deixar alguém confirmar:
// ele montava o aviso de "isto apaga o que existe" a partir do carregamento da
// página, então sessão criada por outra pessoa depois disso não aparecia e o
// modal chegava a mostrar o botão verde de "Confirmar agendamento" pra venda
// que já tinha pacote. A rota /agendar barra o caso destrutivo de qualquer
// jeito, mas a promessa da tela é declarar ANTES de destruir - e declarar com
// dado velho não é declarar.
//
// Sem senha, como o GET de /api/terapeutas/vendas que já alimenta essa mesma
// tela com as mesmas sessões: aqui é só um recorte por sale_id do que ela já
// recebe, e nenhuma escrita acontece.
export async function GET(req: NextRequest) {
  try {
    const saleId = req.nextUrl.searchParams.get('sale_id')
    if (!saleId) return NextResponse.json({ error: 'sale_id obrigatório' }, { status: 400 })

    const supabase = getSupabaseAdmin()
    // Sem paginação de propósito: é uma venda só, e o maior pacote do sistema
    // tem 9 sessões - longe do teto de 1000 linhas do PostgREST.
    const { data, error } = await supabase
      .from('sessoes')
      .select('id,sale_id,terapeuta_id,numero_sessao,total_sessoes,status,status_consulta,data_agendada,data_entrega,link_meet,comissao_valor,comissao_paga,paciente_nome,paciente_email,agendado_por,vendedor_nome,vendedor_email,entregue_confirmado_por,iniciado_em,concluido_em,terapeutas(nome)')
      .eq('sale_id', saleId)
      .order('numero_sessao', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ sessoes: data ?? [] })
  } catch (err) {
    console.error('[terapeutas/sessoes GET]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as {
      sessao_id: string
      acao: 'iniciar' | 'concluir' | 'anular' | 'nao_compareceu'
      motivo?: string
      data_entrega?: string
      senha?: string
      token?: string
      usuario_nome: string
      usuario_tipo: string
      usuario_email: string
    }
    const { sessao_id, acao, motivo, data_entrega, senha, token, usuario_nome, usuario_tipo, usuario_email } = body

    if (!sessao_id || !acao || (!senha && !token) || !usuario_email) {
      return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 })
    }

    const acesso = await verificarAcesso({ usuario_email, senha, token })
    if (!acesso.valido) {
      const { error, status } = erroAcesso(acesso)
      return NextResponse.json({ error }, { status })
    }

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
      const dataEntregaFinal = data_entrega ? brasiliaLocalToISO(data_entrega) : now
      updateData = {
        status_consulta: 'concluida',
        status: 'entregue',
        data_entrega: dataEntregaFinal,
        concluido_em: now,
        entregue_confirmado_por: usuario_nome,
      }
      ocorrenciaTipo = 'confirmacao_entrega'
      ocorrenciaTitulo = `Consulta Concluída — Sessão ${sessao.numero_sessao}`
      ocorrenciaDesc = data_entrega
        ? `Consulta concluída por ${usuario_nome} (data de entrega informada manualmente: ${new Date(dataEntregaFinal).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })})`
        : `Consulta concluída por ${usuario_nome} às ${horaLocal}`
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
    } else if (acao === 'nao_compareceu') {
      updateData = { status_consulta: 'nao_compareceu' }
      ocorrenciaTipo = 'nao_compareceu'
      ocorrenciaTitulo = `Paciente Não Compareceu — Sessão ${sessao.numero_sessao}`
      ocorrenciaDesc = `Paciente não compareceu à sessão. Registrado por ${usuario_nome} às ${horaLocal}`
      logAcao = 'nao_compareceu'
    } else {
      return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })
    }

    const { error: updateErr } = await supabase.from('sessoes').update(updateData).eq('id', sessao_id)
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

    await supabase.from('ocorrencias_prontuario').insert({
      sale_id: sessao.sale_id,
      sessao_id,
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
