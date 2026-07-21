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
      categoria?: string
      repetir_frequencia?: 'semanal' | 'diaria'
      repetir_vezes?: number
      usuario_nome: string
      usuario_tipo: string
      usuario_email: string
      senha: string
    }
    const { terapeuta_id, titulo, inicio, fim, categoria, repetir_frequencia, repetir_vezes, usuario_nome, usuario_tipo, usuario_email, senha } = body

    if (!terapeuta_id || !titulo?.trim() || !inicio || !fim || !usuario_email || !senha) {
      return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 })
    }
    if (categoria && categoria !== 'sessao' && categoria !== 'compromisso') {
      return NextResponse.json({ error: 'Categoria inválida' }, { status: 400 })
    }

    const inicioISO = brasiliaLocalToISO(inicio)
    const fimISO = brasiliaLocalToISO(fim)
    if (new Date(fimISO).getTime() <= new Date(inicioISO).getTime()) {
      return NextResponse.json({ error: 'Horário de fim precisa ser depois do início' }, { status: 400 })
    }

    const { valido, usuario } = await verificarSenhaUsuario(usuario_email, senha)
    if (!valido) return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 })

    const supabase = getSupabaseAdmin()
    const frequencia = repetir_frequencia === 'diaria' ? 'diaria' : 'semanal'
    const INTERVALO_MS = frequencia === 'diaria' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000
    // Diário permite mais repetições que semanal pro mesmo horizonte de tempo
    // (90 dias ~ 12 semanas) — sem isso, o limite de 52 ficaria curto demais
    // pra uma rotina diária.
    const LIMITE_REPETICOES = frequencia === 'diaria' ? 90 : 52
    const inicioMs = new Date(inicioISO).getTime()
    const fimMs = new Date(fimISO).getTime()
    const repeticoes = repetir_vezes && repetir_vezes > 1 ? Math.min(Math.floor(repetir_vezes), LIMITE_REPETICOES) : 1
    const linhas = Array.from({ length: repeticoes }, (_, i) => ({
      terapeuta_id,
      titulo: titulo.trim(),
      inicio: new Date(inicioMs + i * INTERVALO_MS).toISOString(),
      fim: new Date(fimMs + i * INTERVALO_MS).toISOString(),
      categoria: categoria ?? 'compromisso',
      criado_por_nome: usuario_nome,
      criado_por_tipo: usuario_tipo,
      criado_por_email: usuario_email,
    }))

    const { data, error } = await supabase
      .from('compromissos_terapeuta')
      .insert(linhas)
      .select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await registrarAtividade({
      usuario_nome,
      usuario_tipo: usuario_tipo || ((usuario as Record<string, unknown>)?.tipo as string) || 'admin',
      tipo_acao: 'compromisso_criado',
      descricao: repeticoes > 1
        ? `Compromisso "${titulo.trim()}" lançado ${repeticoes}x, ${frequencia === 'diaria' ? 'diariamente' : 'semanalmente'} a partir de ${new Date(inicioISO).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
        : `Compromisso "${titulo.trim()}" lançado na agenda (${new Date(inicioISO).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} – ${new Date(fimISO).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })})`,
      dados_novos: { terapeuta_id, titulo: titulo.trim(), inicio: inicioISO, fim: fimISO, repeticoes },
    })

    return NextResponse.json({ success: true, ids: data.map(d => d.id) })
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
