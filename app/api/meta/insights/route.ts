import { NextRequest, NextResponse } from 'next/server'
import { getProjectInvestment, type RelatoMeta } from '@/lib/meta'
import { AVISO_DRE_META_INCOMPLETA } from '@/lib/trafego-do-fechamento'
import { nomenclaturasDoProjeto } from '@/lib/nomenclaturas-trafego'
import { lerIdentidade } from '@/lib/identidade-da-chamada'

// Sem cache do Next aqui (10/11/2026): com revalidate, os fetch da Meta dentro
// da rota podiam ficar guardados 5 min e o "Atualize a página" do aviso traria
// o mesmo valor incompleto.
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const quem = lerIdentidade(req)
  if (!quem) return NextResponse.json({ error: 'Você precisa entrar no sistema.' }, { status: 401 })
  if (quem.area !== 'dashboard') return NextResponse.json({ error: 'Sem acesso ao financeiro.' }, { status: 403 })

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
    return NextResponse.json({ total: 0, campanhas: [], erro: 'Token não configurado', incompleto: true, aviso: AVISO_DRE_META_INCOMPLETA })
  }

  const nomenclaturas = nomenclaturasDoProjeto(projectId)

  try {
    const relato: RelatoMeta = { falhas: 0 }
    const result = await getProjectInvestment(
      nomenclaturas,
      dateStart,
      dateEnd,
      datePreset || undefined,
      relato,
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
      ...(relato.falhas > 0 ? { incompleto: true, aviso: AVISO_DRE_META_INCOMPLETA } : {}),
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[Meta API] Erro ao buscar insights:', msg)
    return NextResponse.json({ total: 0, campanhas: [], erro: msg, incompleto: true, aviso: AVISO_DRE_META_INCOMPLETA })
  }
}
