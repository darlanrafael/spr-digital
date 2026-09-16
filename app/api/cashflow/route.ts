import { NextRequest, NextResponse } from 'next/server'
import { getCashflow, addCashflowEntry } from '@/lib/services'
import { lerIdentidade, podeEditarCaixa } from '@/lib/identidade-da-chamada'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const projectId = searchParams.get('projectId') ?? 'proj_1'
  const quem = lerIdentidade(req)
  if (!quem) return NextResponse.json({ error: 'Você precisa entrar no sistema.' }, { status: 401 })
  if (quem.area !== 'dashboard') return NextResponse.json({ error: 'Sem acesso ao financeiro.' }, { status: 403 })
  try {
    const entries = await getCashflow(projectId)
    return NextResponse.json(entries)
  } catch {
    return NextResponse.json({ error: 'Erro ao buscar caixa' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const quem = lerIdentidade(req)
  if (!quem) return NextResponse.json({ error: 'Você precisa entrar no sistema.' }, { status: 401 })
  if (!podeEditarCaixa(quem)) {
    return NextResponse.json({ error: 'Você não tem permissão para lançar no caixa.' }, { status: 403 })
  }
  try {
    const { entry, projectId = 'proj_1' } = await req.json()
    if (!entry) return NextResponse.json({ error: 'entry é obrigatório' }, { status: 400 })
    await addCashflowEntry(entry, projectId)
    return NextResponse.json({ success: true }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Erro ao criar movimentação' }, { status: 500 })
  }
}
