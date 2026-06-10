import { NextRequest, NextResponse } from 'next/server'
import { getClosings, addClosing } from '@/lib/services'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const projectId = searchParams.get('projectId') ?? 'proj_1'
  try {
    const closings = await getClosings(projectId)
    return NextResponse.json(closings)
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
