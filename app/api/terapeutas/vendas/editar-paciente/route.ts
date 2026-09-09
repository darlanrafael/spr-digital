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
    }
    const { sale_id, nome, email, telefone, senha, token, usuario_nome, usuario_tipo, usuario_email } = body

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
      .from('sales').select('nome,email,telefone').eq('id', sale_id).single()

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

    await registrarAtividade({
      usuario_nome,
      usuario_tipo,
      tipo_acao: 'paciente_editado',
      sale_id,
      descricao: `Dados do paciente editados: ${anterior?.nome ?? '?'} → ${nome.trim()} (${sessoesAtualizadas ?? 0} ${sessoesAtualizadas === 1 ? 'sessão atualizada' : 'sessões atualizadas'})`,
      dados_anteriores: anterior ?? undefined,
      dados_novos: { nome: nome.trim(), email: email.trim(), telefone },
    })

    return NextResponse.json({ success: true, sale, sessoes_atualizadas: sessoesAtualizadas ?? 0 })
  } catch (err) {
    console.error('[vendas/editar-paciente PUT]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
