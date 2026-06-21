import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { hashSenha } from '@/lib/terapeutas-auth'

export async function POST(req: NextRequest) {
  try {
    const { email, senha } = await req.json() as { email: string; senha: string }
    if (!email || !senha) {
      return NextResponse.json({ error: 'Email e senha obrigatórios' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()
    const hash = hashSenha(senha)

    const { data } = await supabase
      .from('usuarios_sistema')
      .select('id,nome,email,tipo,terapeuta_id,ativo')
      .eq('email', email.toLowerCase().trim())
      .eq('senha_hash', hash)
      .eq('ativo', true)
      .single()

    if (!data) {
      return NextResponse.json({ error: 'Email ou senha inválidos' }, { status: 401 })
    }

    const row = data as { id: string; nome: string; email: string; tipo: string; terapeuta_id: string | null; ativo: boolean }

    return NextResponse.json({
      success: true,
      usuario: {
        id: row.id,
        nome: row.nome,
        email: row.email,
        tipo: row.tipo,
        terapeuta_id: row.terapeuta_id,
      },
    })
  } catch (err) {
    console.error('[terapeutas/login POST]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
