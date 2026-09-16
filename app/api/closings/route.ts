import { NextRequest, NextResponse } from 'next/server'
import { getClosings, addClosing } from '@/lib/services'
import { lerIdentidade, deveEsconderDivisaoDeSocios, semDivisaoDeSocios } from '@/lib/identidade-da-chamada'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const projectId = searchParams.get('projectId') ?? 'proj_1'
  try {
    const closings = await getClosings(projectId)
    // A tela ja escondia a divisao do socio (`podeVerRepasse` em
    // app/fechamentos/page.tsx:240). Esconder so na tela nao adianta: o dado
    // vinha inteiro por aqui, e bastava abrir o endereco no navegador.
    const quem = lerIdentidade(req)
    if (!quem) return NextResponse.json({ error: 'Você precisa entrar no sistema.' }, { status: 401 })
    return NextResponse.json(deveEsconderDivisaoDeSocios(quem) ? semDivisaoDeSocios(closings) : closings)
  } catch {
    return NextResponse.json({ error: 'Erro ao buscar fechamentos' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { closing, projectId = 'proj_1' } = await req.json()
    if (!closing) return NextResponse.json({ error: 'closing é obrigatório' }, { status: 400 })
    await addClosing(closing, projectId)
    return NextResponse.json({ success: true }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Erro ao criar fechamento' }, { status: 500 })
  }
}
