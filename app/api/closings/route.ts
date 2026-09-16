import { NextRequest, NextResponse } from 'next/server'
import { getClosings, addClosing } from '@/lib/services'
import { lerIdentidade, deveEsconderDivisaoDeSocios, semDivisaoDeSocios, podeEditarFechamento } from '@/lib/identidade-da-chamada'

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
    // O financeiro do DRE e sistema separado do modulo de terapeutas: so quem
    // e da area 'dashboard' le. Guarda vem ANTES da logica de esconder a
    // divisao entre socios (Tarefa 10) - depois dela, so quem e do dashboard
    // chega, e dentro do dashboard o socio continua sem ver a divisao.
    if (quem.area !== 'dashboard') return NextResponse.json({ error: 'Sem acesso ao financeiro.' }, { status: 403 })
    return NextResponse.json(deveEsconderDivisaoDeSocios(quem) ? semDivisaoDeSocios(closings) : closings)
  } catch {
    return NextResponse.json({ error: 'Erro ao buscar fechamentos' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const quem = lerIdentidade(req)
  if (!quem) return NextResponse.json({ error: 'Você precisa entrar no sistema.' }, { status: 401 })
  if (!podeEditarFechamento(quem)) {
    return NextResponse.json({ error: 'Você não tem permissão para confirmar fechamento.' }, { status: 403 })
  }
  try {
    const { closing, projectId = 'proj_1' } = await req.json()
    if (!closing) return NextResponse.json({ error: 'closing é obrigatório' }, { status: 400 })
    await addClosing(closing, projectId)
    return NextResponse.json({ success: true }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Erro ao criar fechamento' }, { status: 500 })
  }
}
