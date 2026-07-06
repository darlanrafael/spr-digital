import { NextRequest, NextResponse } from 'next/server'
import { getProjectInvestment } from '@/lib/meta'

export const revalidate = 0

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const dateStart = searchParams.get('dateStart') ?? ''
  const dateEnd = searchParams.get('dateEnd') ?? ''
  const termos = searchParams.getAll('termos').map(t => t.trim()).filter(Boolean)

  if (!dateStart || !dateEnd || termos.length === 0) {
    return NextResponse.json({ total: 0, campanhas: [] })
  }

  if (!process.env.META_ACCESS_TOKEN) {
    return NextResponse.json({ total: 0, campanhas: [], erro: 'Token não configurado' })
  }

  try {
    const result = await getProjectInvestment(termos, dateStart, dateEnd)

    const totalFormatado = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
    }).format(result.total)

    return NextResponse.json({
      total: result.total,
      totalFormatado,
      campanhas: result.campanhas,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[Meta API] Erro ao buscar custo de tráfego:', msg)
    return NextResponse.json({ total: 0, campanhas: [], erro: msg })
  }
}
