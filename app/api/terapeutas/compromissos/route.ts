import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarSenhaUsuario, registrarAtividade, brasiliaLocalToISO } from '@/lib/terapeutas-auth'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      terapeuta_id: string
      titulo: string
      inicio: string
      fim: string
      usuario_nome: string
      usuario_tipo: string
      usuario_email: string
      senha: string
    }
    const { terapeuta_id, titulo, inicio, fim, usuario_nome, usuario_tipo, usuario_email, senha } = body

    if (!terapeuta_id || !titulo?.trim() || !inicio || !fim || !usuario_email || !senha) {
      return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 })
    }

    const inicioISO = brasiliaLocalToISO(inicio)
    const fimISO = brasiliaLocalToISO(fim)
    if (new Date(fimISO).getTime() <= new Date(inicioISO).getTime()) {
      return NextResponse.json({ error: 'Horário de fim precisa ser depois do início' }, { status: 400 })
    }

    const { valido, usuario } = await verificarSenhaUsuario(usuario_email, senha)
    if (!valido) return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 })

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('compromissos_terapeuta')
      .insert({
        terapeuta_id,
        titulo: titulo.trim(),
        inicio: inicioISO,
        fim: fimISO,
        criado_por_nome: usuario_nome,
        criado_por_tipo: usuario_tipo,
        criado_por_email: usuario_email,
      })
      .select('id')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await registrarAtividade({
      usuario_nome,
      usuario_tipo: usuario_tipo || ((usuario as Record<string, unknown>)?.tipo as string) || 'admin',
      tipo_acao: 'compromisso_criado',
      descricao: `Compromisso "${titulo.trim()}" lançado na agenda (${new Date(inicioISO).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} – ${new Date(fimISO).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })})`,
      dados_novos: { terapeuta_id, titulo: titulo.trim(), inicio: inicioISO, fim: fimISO },
    })

    return NextResponse.json({ success: true, id: data.id })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json() as {
      id: string
      usuario_nome: string
      usuario_tipo: string
      usuario_email: string
      senha: string
    }
    const { id, usuario_nome, usuario_tipo, usuario_email, senha } = body

    if (!id || !usuario_email || !senha) {
      return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 })
    }

    const { valido } = await verificarSenhaUsuario(usuario_email, senha)
    if (!valido) return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 })

    const supabase = getSupabaseAdmin()
    const { data: compromisso } = await supabase
      .from('compromissos_terapeuta').select('id,titulo').eq('id', id).single()
    if (!compromisso) return NextResponse.json({ error: 'Compromisso não encontrado' }, { status: 404 })

    const { error } = await supabase.from('compromissos_terapeuta').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await registrarAtividade({
      usuario_nome,
      usuario_tipo,
      tipo_acao: 'compromisso_apagado',
      descricao: `Compromisso "${compromisso.titulo}" removido da agenda`,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
