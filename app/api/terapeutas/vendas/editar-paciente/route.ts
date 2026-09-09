import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarAcesso, erroAcesso, registrarAtividade, normalizarTelefoneBR } from '@/lib/terapeutas-auth'

// Edita nome/e-mail/telefone da venda (dado que a tela de prontuário lê
// direto de `sales`, não existe uma tabela "paciente" separada — corrigir um
// nome digitado errado ou um telefone mal formatado é editar a venda mais
// recente do paciente).
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as {
      sale_id: string
      nome: string
      email: string
      telefone: string
      senha?: string
      token?: string
      usuario_nome: string
      usuario_tipo: string
      usuario_email: string
      /** Por que os dados estao mudando. Obrigatoria quando muda nome ou e-mail. */
      motivo?: string
    }
    const { sale_id, nome, email, telefone, senha, token, usuario_nome, usuario_tipo, usuario_email, motivo } = body

    if (!sale_id || !nome?.trim() || !email?.trim()) {
      return NextResponse.json({ error: 'Nome e e-mail são obrigatórios' }, { status: 400 })
    }

    const acesso = await verificarAcesso({ usuario_email, senha, token })
    if (!acesso.valido) {
      const { error, status } = erroAcesso(acesso)
      return NextResponse.json({ error }, { status })
    }

    const supabase = getSupabaseAdmin()

    const { data: anterior } = await supabase
      .from('sales').select('nome,email,telefone,produto,plataforma,valor_pago_cliente,data_hora').eq('id', sale_id).single()

    // Trocar NOME ou E-MAIL exige motivo escrito.
    //
    // E a acao que, em 04/08/2026, sobrescreveu uma paciente inteira pela
    // outra - nome, e-mail e telefone de uma vez - sem deixar nada visivel no
    // prontuario. A unica razao de ter sido possivel reconstruir o caso e que
    // as sessoes ainda guardavam o nome antigo, por causa de OUTRO defeito
    // (corrigido em d238ef5). Sem aquele defeito, nao haveria rastro nenhum.
    //
    // O caso legitimo que motivou o campo (usuario, 09/09/2026): a esposa
    // comprou a sessao para o marido, e o comercial precisa deixar os dados
    // DELE no prontuario mantendo registrado quem comprou, com qual e-mail e
    // em qual plataforma. Antes disso so dava para escolher entre uma coisa e
    // outra.
    const a = anterior as { nome?: string; email?: string } | null
    const mudouIdentidade = !!a && (a.nome?.trim() !== nome.trim() || a.email?.trim().toLowerCase() !== email.trim().toLowerCase())
    if (mudouIdentidade && (motivo ?? '').trim().length < 10) {
      return NextResponse.json({
        error: 'Trocar o nome ou o e-mail do paciente exige uma justificativa (mínimo 10 letras). Escreva o que está acontecendo - por exemplo, quem comprou e por que o atendimento é de outra pessoa.',
        precisa_motivo: true,
      }, { status: 400 })
    }

    // Daqui pra baixo so chega quem NAO trocou de identidade: correcao de
    // telefone, acento, espaco. Essas valem na hora, como sempre valeram.
    const { data: sale, error: updErr } = await supabase
      .from('sales')
      .update({ nome: nome.trim(), email: email.trim(), telefone: normalizarTelefoneBR(telefone) ?? (telefone.trim() || null) })
      .eq('id', sale_id)
      .select()
      .single()
    if (updErr) throw new Error(updErr.message)

    // As sessões guardam a PRÓPRIA cópia do nome e do e-mail do paciente,
    // tirada no momento do agendamento. Sem propagar aqui, a correção ficava
    // presa na venda: o Overview, a agenda do terapeuta e a mensagem de
    // WhatsApp leem `sessoes.paciente_nome`, não `sales.nome`.
    //
    // Medido em 09/09/2026, antes desta correção: 15 sessões de 6 pacientes
    // com dado velho - uma delas exibindo "41 98403-2550" como nome do
    // paciente, o telefone que alguém já tinha corrigido na venda meses antes.
    // Esse nome ia junto no lembrete que o paciente recebe.
    //
    // Vale para as sessões PASSADAS também: corrigir um nome digitado errado é
    // corrigir quem a pessoa é, e o prontuário mostra o histórico inteiro.
    const { error: sessErr, count: sessoesAtualizadas } = await supabase
      .from('sessoes')
      .update({ paciente_nome: nome.trim(), paciente_email: email.trim() }, { count: 'exact' })
      .eq('sale_id', sale_id)
    // Falha aqui não desfaz a venda: o dado da venda é o autoritativo e já foi
    // corrigido. Mas precisa aparecer, senão a tela diz "salvo" e o Overview
    // continua com o nome velho - que é exatamente o defeito relatado.
    if (sessErr) {
      return NextResponse.json({
        error: `A venda foi corrigida, mas as sessões não: ${sessErr.message}. O Overview vai continuar mostrando o nome antigo até isto ser resolvido.`,
      }, { status: 500 })
    }

    // TROCA DE IDENTIDADE NAO APLICA AQUI: vira pedido de aprovacao.
    //
    // Decisao do usuario em 09/09/2026: "apos isso, deve ir para aprovacao
    // para mim". Os dados ANTIGOS ficam no prontuario ate ele decidir - custo
    // aceito por ele, sabendo que o terapeuta pode atender vendo o nome antigo
    // nesse intervalo.
    //
    // Corrigir telefone ou acento no nome continua valendo na hora: so a troca
    // de QUEM E O PACIENTE espera.
    if (mudouIdentidade && a) {
      const v = anterior as Record<string, unknown>
      const { data: pedido, error: pedErr } = await supabase.from('solicitacoes_edicao_paciente').insert({
        sale_id,
        nome_atual: a.nome ?? null,
        email_atual: a.email ?? null,
        telefone_atual: (v.telefone as string) ?? null,
        nome_novo: nome.trim(),
        email_novo: email.trim(),
        telefone_novo: normalizarTelefoneBR(telefone) ?? (telefone.trim() || null),
        produto: (v.produto as string) ?? null,
        plataforma: (v.plataforma as string) ?? null,
        valor_pago_cliente: (v.valor_pago_cliente as number) ?? null,
        data_compra: (v.data_hora as string) ?? null,
        motivo: (motivo ?? '').trim(),
        solicitado_por_nome: usuario_nome,
        solicitado_por_email: usuario_email,
      }).select('id').single()
      if (pedErr) return NextResponse.json({ error: pedErr.message }, { status: 500 })

      await registrarAtividade({
        usuario_nome, usuario_tipo,
        tipo_acao: 'paciente_editado',
        sale_id,
        descricao: `Pedido de troca de paciente enviado para aprovação: ${a.nome ?? '?'} → ${nome.trim()}. Motivo: ${(motivo ?? '').trim()}. Nada foi alterado ainda.`,
        dados_anteriores: { nome: a.nome, email: a.email, telefone: v.telefone },
      })

      return NextResponse.json({
        success: true,
        aguardando_aprovacao: true,
        solicitacao_id: (pedido as { id: string }).id,
      })
    }

    await registrarAtividade({
      usuario_nome,
      usuario_tipo,
      tipo_acao: 'paciente_editado',
      sale_id,
      descricao: `Dados do paciente editados: ${a?.nome ?? '?'} → ${nome.trim()} (${sessoesAtualizadas ?? 0} ${sessoesAtualizadas === 1 ? 'sessão atualizada' : 'sessões atualizadas'})${mudouIdentidade ? ` — motivo: ${(motivo ?? '').trim()}` : ''}`,
      dados_anteriores: anterior ?? undefined,
      dados_novos: { nome: nome.trim(), email: email.trim(), telefone },
    })

    return NextResponse.json({ success: true, sale, sessoes_atualizadas: sessoesAtualizadas ?? 0 })
  } catch (err) {
    console.error('[vendas/editar-paciente PUT]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
