import { NextRequest, NextResponse } from 'next/server'
import { getSales, addSale, updateSaleStatus } from '@/lib/services'
import { lerIdentidade, podeMexerEmVenda } from '@/lib/identidade-da-chamada'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const projectId = searchParams.get('projectId') ?? 'proj_1'
  const dateStart = searchParams.get('dateStart') ?? undefined
  const dateEnd = searchParams.get('dateEnd') ?? undefined
  try {
    const sales = await getSales(projectId, dateStart, dateEnd)
    return NextResponse.json(sales)
  } catch {
    return NextResponse.json({ error: 'Erro ao buscar vendas' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    await addSale(body)
    return NextResponse.json({ success: true }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Erro ao criar venda' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const quem = lerIdentidade(req)
    if (!quem) return NextResponse.json({ error: 'Você precisa entrar no sistema.' }, { status: 401 })
    if (!podeMexerEmVenda(quem)) {
      return NextResponse.json({ error: 'Você não tem permissão para alterar vendas.' }, { status: 403 })
    }
    const { id, status, dataReembolso } = await req.json()
    if (!id || !status) {
      return NextResponse.json({ error: 'id e status são obrigatórios' }, { status: 400 })
    }
    await updateSaleStatus(id, status, dataReembolso)
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Erro ao atualizar venda' }, { status: 500 })
  }
}
