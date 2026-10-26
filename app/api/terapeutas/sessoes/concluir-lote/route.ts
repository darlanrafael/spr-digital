import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarAcesso, erroAcesso, registrarAtividade } from '@/lib/terapeutas-auth'
import { lerIdentidade } from '@/lib/identidade-da-chamada'
import { podeAgirNaSessao } from '@/lib/sessao-do-terapeuta'
import { montarConclusaoDaSessao, sessaoConcluivel } from '@/lib/conclusao-da-sessao'

// Concluir VARIAS sessoes de uma vez - o terapeuta marca a pilha de pendentes
// de conclusao num clique so, em vez de linha por linha.
//
// Nao e um atalho novo de regra: cada sessao e concluida pela MESMA
// `montarConclusaoDaSessao` do botao ✓ verde individual (acao=concluir, sem
// data manual => data de entrega = agora). O que muda aqui e so o LOOP e o
// resultado parcial: devolve quais concluiram e quais falharam, pra uma falha
// numa sessao nao derrubar as outras.
//
// Autorizacao igual ao PATCH individual: senha OU token, e `podeAgirNaSessao`
// por sessao (terapeuta so conclui as proprias; admin/comercial concluem).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      sessao_ids: string[]
      senha?: string
      token?: string
      usuario_nome: string
      usuario_tipo: string
      usuario_email: string
    }
    const { sessao_ids, senha, token, usuario_nome, usuario_tipo, usuario_email } = body

    if (!Array.isArray(sessao_ids) || sessao_ids.length === 0 || (!senha && !token) || !usuario_email) {
      return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 })
    }

    const acesso = await verificarAcesso({ usuario_email, senha, token })
    if (!acesso.valido) {
      const { error, status } = erroAcesso(acesso)
      return NextResponse.json({ error }, { status })
    }

    const quem = lerIdentidade(req)
    if (!quem) return NextResponse.json({ error: 'Você precisa entrar no sistema.' }, { status: 401 })

    const supabase = getSupabaseAdmin()
    const agoraMs = Date.now()
    const concluidas: string[] = []
    const falhas: { sessao_id: string; motivo: string }[] = []

    // Dedup: dois cliques ou um id repetido no corpo nao concluem a mesma
    // sessao duas vezes.
    const ids = [...new Set(sessao_ids)]

    for (const sessao_id of ids) {
      const { data: sessao } = await supabase
        .from('sessoes')
        .select('id,sale_id,status,status_consulta,paciente_nome,numero_sessao,terapeuta_id')
        .eq('id', sessao_id)
        .single()
      if (!sessao) { falhas.push({ sessao_id, motivo: 'Sessão não encontrada' }); continue }

      if (!podeAgirNaSessao(quem, (sessao as { terapeuta_id: string | null }).terapeuta_id)) {
        falhas.push({ sessao_id, motivo: 'Esta sessão não é sua.' }); continue
      }
      // Idempotente: id ja entregue (ou em estado estranho) e pulado, nao
      // reconcluido - senao reescreveria data_entrega e duplicaria prontuario.
      if (!sessaoConcluivel((sessao as { status: string | null }).status)) {
        falhas.push({ sessao_id, motivo: 'Sessão não está pendente de conclusão.' }); continue
      }

      const c = montarConclusaoDaSessao({
        numeroSessao: sessao.numero_sessao,
        usuarioNome: usuario_nome,
        agoraMs,
      })

      const { error: updateErr } = await supabase.from('sessoes').update(c.updateData).eq('id', sessao_id)
      if (updateErr) { falhas.push({ sessao_id, motivo: updateErr.message }); continue }

      await supabase.from('ocorrencias_prontuario').insert({
        sale_id: sessao.sale_id,
        sessao_id,
        tipo: c.ocorrenciaTipo,
        titulo: c.ocorrenciaTitulo,
        descricao: c.ocorrenciaDesc,
        dados_extras: { sessao_id, acao: 'concluir', motivo: null, lote: true },
        criado_por_nome: usuario_nome,
        criado_por_tipo: usuario_tipo,
        criado_por_email: usuario_email,
      })

      await registrarAtividade({
        usuario_nome,
        usuario_tipo,
        tipo_acao: c.logAcao,
        sessao_id,
        sale_id: sessao.sale_id,
        descricao: c.ocorrenciaDesc,
      })

      concluidas.push(sessao_id)
    }

    return NextResponse.json({ success: true, concluidas, falhas })
  } catch (err) {
    console.error('[sessoes/concluir-lote POST]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
