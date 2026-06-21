import { NextRequest, NextResponse } from 'next/server'
import { getProjectInvestment } from '@/lib/meta'

export const revalidate = 300

// Nomenclaturas por projeto — fallback enquanto não buscamos do Supabase
const PROJECT_NOMENCLATURAS: Record<string, string[]> = {
  'proj_1': ['[F01-IRM', '[PF01_RC'],
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const dateStart  = searchParams.get('dateStart')  ?? ''
  const dateEnd    = searchParams.get('dateEnd')    ?? ''
  const datePreset = searchParams.get('datePreset') ?? ''
  const projectId  = searchParams.get('projectId') ?? 'proj_1'
  console.log('[Meta Insights] requisição recebida:', searchParams.toString())

  if (!datePreset && (!dateStart || !dateEnd)) {
    return NextResponse.json({ error: 'datePreset ou dateStart+dateEnd são obrigatórios' }, { status: 400 })
  }

  if (!process.env.META_ACCESS_TOKEN) {
    return NextResponse.json({ total: 0, campanhas: [], erro: 'Token não configurado' })
  }

  const nomenclaturas = PROJECT_NOMENCLATURAS[projectId] ?? PROJECT_NOMENCLATURAS['proj_1']

  try {
    const result = await getProjectInvestment(
      nomenclaturas,
      dateStart,
      dateEnd,
      datePreset || undefined,
    )

    const totalFormatado = new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
    }).format(result.total)

    return NextResponse.json({
      total: result.total,
      totalFormatado,
      campanhas: result.campanhas,
      periodo: datePreset ? { datePreset } : { dateStart, dateEnd },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[Meta API] Erro ao buscar insights:', msg)
    return NextResponse.json({ total: 0, campanhas: [], erro: msg })
  }
}
