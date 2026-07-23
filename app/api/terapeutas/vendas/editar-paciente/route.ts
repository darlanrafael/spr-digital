import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarSenhaUsuario, registrarAtividade, normalizarTelefoneBR } from '@/lib/terapeutas-auth'

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
      senha: string
      usuario_nome: string
      usuario_tipo: string
      usuario_email: string
    }
    const { sale_id, nome, email, telefone, senha, usuario_nome, usuario_tipo, usuario_email } = body

    if (!sale_id || !nome?.trim() || !email?.trim()) {
      return NextResponse.json({ error: 'Nome e e-mail são obrigatórios' }, { status: 400 })
    }

    const { valido } = await verificarSenhaUsuario(usuario_email, senha)
    if (!valido) return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 })

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

    await registrarAtividade({
      usuario_nome,
      usuario_tipo,
      tipo_acao: 'paciente_editado',
      sale_id,
      descricao: `Dados do paciente editados: ${anterior?.nome ?? '?'} → ${nome.trim()}`,
      dados_anteriores: anterior ?? undefined,
      dados_novos: { nome: nome.trim(), email: email.trim(), telefone },
    })

    return NextResponse.json({ success: true, sale })
  } catch (err) {
    console.error('[vendas/editar-paciente PUT]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
