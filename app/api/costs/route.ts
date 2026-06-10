import { NextRequest, NextResponse } from 'next/server'
import {
  getFixedCosts, addFixedCost, updateFixedCost, deleteFixedCost,
  getVariableCosts, addCost, updateCost, deleteCost,
  getMetaAds, upsertMetaAds,
} from '@/lib/services'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const projectId = searchParams.get('projectId') ?? 'proj_1'
  const type = searchParams.get('type') // 'fixed' | 'variable' | 'meta'
  try {
    if (type === 'fixed') {
      return NextResponse.json(await getFixedCosts())
    }
    if (type === 'variable') {
      const dateStart = searchParams.get('dateStart') ?? undefined
      const dateEnd = searchParams.get('dateEnd') ?? undefined
      return NextResponse.json(await getVariableCosts(projectId, dateStart, dateEnd))
    }
    if (type === 'meta') {
      return NextResponse.json(await getMetaAds(projectId))
    }
    const [fixos, variaveis, metaAds] = await Promise.all([
      getFixedCosts(),
      getVariableCosts(projectId),
      getMetaAds(projectId),
    ])
    return NextResponse.json({ fixos, variaveis, metaAds })
  } catch {
    return NextResponse.json({ error: 'Erro ao buscar custos' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { type, ...data } = body
    if (type === 'fixed') {
      await addFixedCost(data)
    } else if (type === 'meta') {
      await upsertMetaAds(data.projectId, data.mes, data.valor)
    } else {
      await addCost(data)
    }
    return NextResponse.json({ success: true }, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Erro ao criar custo' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { id, type, ...patch } = await req.json()
    if (!id) return NextResponse.json({ error: 'id é obrigatório' }, { status: 400 })
    if (type === 'fixed') {
      await updateFixedCost(id, patch)
    } else {
      await updateCost(id, patch)
    }
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Erro ao atualizar custo' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id, type } = await req.json()
    if (!id) return NextResponse.json({ error: 'id é obrigatório' }, { status: 400 })
    if (type === 'fixed') {
      await deleteFixedCost(id)
    } else {
      await deleteCost(id)
    }
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Erro ao excluir custo' }, { status: 500 })
  }
}
