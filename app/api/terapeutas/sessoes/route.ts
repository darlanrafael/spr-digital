import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarAcesso, erroAcesso, registrarAtividade } from '@/lib/terapeutas-auth'
import { lerIdentidade, podeMexerEmVenda } from '@/lib/identidade-da-chamada'
import { podeAgirNaSessao } from '@/lib/sessao-do-terapeuta'
import { montarConclusaoDaSessao, sessaoConcluivel } from '@/lib/conclusao-da-sessao'
import { planejarFalta } from '@/lib/falta-comissao'
import { ehPedroSocio } from '@/lib/socio'

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
    const quem = lerIdentidade(req)
    if (!quem) return NextResponse.json({ error: 'Você precisa entrar no sistema.' }, { status: 401 })
    if (!podeMexerEmVenda(quem)) return NextResponse.json({ error: 'Sem permissão para ver as sessões.' }, { status: 403 })

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
      .select('id,sale_id,status,status_consulta,paciente_nome,paciente_email,numero_sessao,total_sessoes,data_agendada,terapeuta_id,comissao_valor,terapeutas(nome)')
      .eq('id', sessao_id)
      .single()
    if (!sessao) return NextResponse.json({ error: 'Sessão não encontrada' }, { status: 404 })

    const quem = lerIdentidade(req)
    if (!quem) return NextResponse.json({ error: 'Você precisa entrar no sistema.' }, { status: 401 })
    if (!podeAgirNaSessao(quem, (sessao as { terapeuta_id: string | null }).terapeuta_id)) {
      return NextResponse.json({ error: 'Esta sessão não é sua.' }, { status: 403 })
    }

    const agoraMs = Date.now()
    const now = new Date(agoraMs).toISOString()
    const horaLocal = new Date(agoraMs).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
    let updateData: Record<string, unknown> = {}
    let ocorrenciaTipo = 'nota'
    let ocorrenciaTitulo = ''
    let ocorrenciaDesc = ''
    let logAcao: string = acao
    let desfazendoFalta = false
    // Preenchido so no "nao compareceu" de contratado COM comissao: a comissao
    // a mandar pra aprovacao do dono. Gravada ANTES de consumir a sessao.
    let faltaParaCriar: { comissaoValor: number } | null = null

    if (acao === 'iniciar') {
      if (sessao.status === 'entregue') {
        return NextResponse.json({ error: 'Sessão já finalizada.' }, { status: 409 })
      }
      updateData = { status_consulta: 'em_atendimento', iniciado_em: now }
      ocorrenciaTitulo = `Consulta Iniciada — Sessão ${sessao.numero_sessao}`
      ocorrenciaDesc = `Consulta iniciada por ${usuario_nome} às ${horaLocal}`
    } else if (acao === 'concluir') {
      // Igual ao lote: nao reconcluir uma sessao ja entregue/falta/cancelada.
      if (!sessaoConcluivel(sessao.status)) {
        return NextResponse.json({ error: 'Sessão já finalizada.' }, { status: 409 })
      }
      const c = montarConclusaoDaSessao({
        numeroSessao: sessao.numero_sessao,
        usuarioNome: usuario_nome,
        dataEntregaManual: data_entrega,
        agoraMs,
      })
      updateData = c.updateData
      ocorrenciaTipo = c.ocorrenciaTipo
      ocorrenciaTitulo = c.ocorrenciaTitulo
      ocorrenciaDesc = c.ocorrenciaDesc
      logAcao = c.logAcao
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
      // Desfazendo uma falta: destrava a comissao (a falta pendente e
      // cancelada depois da escrita da sessao).
      if (sessao.status_consulta === 'nao_compareceu') {
        updateData.comissao_bloqueada = false
        desfazendoFalta = true
      }
      ocorrenciaTitulo = `Sessão Anulada — Sessão ${sessao.numero_sessao}`
      ocorrenciaDesc = `Sessão anulada por ${usuario_nome}. Motivo: ${motivo}`
      logAcao = 'cancelamento'
    } else if (acao === 'nao_compareceu') {
      const s = sessao as unknown as {
        status: string; comissao_valor: number | null; terapeuta_id: string | null
        terapeutas: { nome: string } | null; data_agendada: string | null
      }
      // Guarda 1: so agendada/pendente. Cobre cancelada, reembolsada e ja
      // entregue (senao travaria/duplicaria comissao ja resolvida).
      if (!sessaoConcluivel(s.status)) {
        return NextResponse.json({ error: 'Esta sessão não pode receber falta (já finalizada ou cancelada).' }, { status: 409 })
      }
      // Guarda 2: a sessao precisa ja ter acontecido. (fimEfetivoSessao pede
      // duracao/grade que nao estao neste select; usa o inicio agendado.)
      if (s.data_agendada && new Date(s.data_agendada).getTime() > agoraMs) {
        return NextResponse.json({ error: 'A sessão ainda não aconteceu.' }, { status: 409 })
      }
      const terapeutaResolvido = !!(s.terapeuta_id && s.terapeutas?.nome)
      const ehSocio = ehPedroSocio(s.terapeutas?.nome ?? '')
      const comissaoValor = Number(s.comissao_valor ?? 0)
      const p = planejarFalta({
        ehSocio,
        temComissao: comissaoValor > 0,
        numeroSessao: sessao.numero_sessao,
        usuarioNome: usuario_nome,
        agoraMs,
      })
      updateData = p.updateData
      ocorrenciaTipo = 'nao_compareceu'
      ocorrenciaTitulo = p.ocorrenciaTitulo
      ocorrenciaDesc = p.ocorrenciaDesc
      logAcao = 'nao_compareceu'
      // Sem terapeuta resolvido: consome e trava, mas nao manda aprovacao fantasma.
      if (p.criarFalta && terapeutaResolvido) faltaParaCriar = { comissaoValor }
    } else {
      return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })
    }

    // Falta de contratado com comissao: grava/reabre a aprovacao ANTES de
    // consumir a sessao. Com dinheiro, a ordem importa: se a escrita da falta
    // falhar, a sessao NAO e alterada (a comissao nunca fica travada sem o
    // registro). unique(sessao_id): se ja ha falta cancelada/negada (sessao
    // anulada e remarcada), reabre como pendente; pendente/aprovada aborta.
    if (faltaParaCriar) {
      const s = sessao as unknown as {
        sale_id: string; terapeuta_id: string | null; terapeutas: { nome: string } | null
        paciente_nome: string; paciente_email: string | null
        numero_sessao: number; total_sessoes: number; data_agendada: string | null
      }
      const { data: existente, error: buscaErr } = await supabase
        .from('solicitacoes_falta_comissao')
        .select('id,status')
        .eq('sessao_id', sessao_id)
        .maybeSingle()
      if (buscaErr) return NextResponse.json({ error: buscaErr.message }, { status: 500 })

      const dadosFalta = {
        sale_id: s.sale_id,
        terapeuta_id: s.terapeuta_id,
        terapeuta_nome: s.terapeutas?.nome ?? null,
        paciente_nome: s.paciente_nome,
        paciente_email: s.paciente_email,
        numero_sessao: s.numero_sessao,
        total_sessoes: s.total_sessoes,
        data_sessao: s.data_agendada,
        comissao_valor: faltaParaCriar.comissaoValor,
        status: 'pendente',
        solicitado_por_nome: usuario_nome,
        solicitado_por_email: usuario_email,
      }
      if (!existente) {
        const { error: insErr } = await supabase
          .from('solicitacoes_falta_comissao')
          .insert({ sessao_id, ...dadosFalta })
        if (insErr) {
          const conflito = (insErr as { code?: string }).code === '23505'
          return NextResponse.json({ error: conflito ? 'Já existe uma falta registrada para esta sessão.' : insErr.message }, { status: conflito ? 409 : 500 })
        }
      } else if (existente.status === 'cancelado' || existente.status === 'negado') {
        const { error: reabreErr } = await supabase
          .from('solicitacoes_falta_comissao')
          .update({ ...dadosFalta, decidido_por: null, decidido_em: null, created_at: now })
          .eq('id', existente.id)
          .in('status', ['cancelado', 'negado'])
        if (reabreErr) return NextResponse.json({ error: reabreErr.message }, { status: 500 })
      } else {
        return NextResponse.json({ error: 'Já existe uma falta registrada para esta sessão.' }, { status: 409 })
      }
    }

    const { error: updateErr } = await supabase.from('sessoes').update(updateData).eq('id', sessao_id)
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

    if (desfazendoFalta) {
      const { error: cancelaErr } = await supabase
        .from('solicitacoes_falta_comissao')
        .update({ status: 'cancelado' })
        .eq('sessao_id', sessao_id)
        .eq('status', 'pendente')
      if (cancelaErr) return NextResponse.json({ error: cancelaErr.message }, { status: 500 })
    }

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

    // A falta ja foi gravada acima (antes de consumir a sessao); aqui so o log.
    if (faltaParaCriar) {
      await registrarAtividade({
        usuario_nome,
        usuario_tipo,
        tipo_acao: 'solicitacao_falta_comissao',
        sessao_id,
        sale_id: sessao.sale_id,
        descricao: `Falta enviada para aprovação de comissão (R$ ${faltaParaCriar.comissaoValor.toFixed(2)})`,
      })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[sessoes PATCH]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
