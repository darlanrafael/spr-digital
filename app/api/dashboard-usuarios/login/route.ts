import { NextRequest, NextResponse } from 'next/server'
import { verificarSenhaDashboard } from '@/lib/dashboard-auth'

export async function POST(req: NextRequest) {
  try {
    const { email, senha } = await req.json() as { email: string; senha: string }
    if (!email || !senha) {
      return NextResponse.json({ error: 'Email e senha obrigatórios' }, { status: 400 })
    }

    const { valido, usuario } = await verificarSenhaDashboard(email, senha)
    if (!valido || !usuario) {
      return NextResponse.json({ error: 'Email ou senha inválidos' }, { status: 401 })
    }

    return NextResponse.json({
      email: usuario.email,
      name: usuario.nome,
      role: usuario.role,
    })
  } catch (err) {
    console.error('[dashboard-usuarios/login POST]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
