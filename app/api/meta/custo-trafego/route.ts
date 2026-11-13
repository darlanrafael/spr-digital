import { NextRequest, NextResponse } from 'next/server'
import { getProjectInvestment, type RelatoMeta } from '@/lib/meta'
import { ERRO_TRAFEGO_INCOMPLETO } from '@/lib/trafego-do-fechamento'
import { lerIdentidade } from '@/lib/identidade-da-chamada'

export const revalidate = 0

export async function GET(req: NextRequest) {
  const quem = lerIdentidade(req)
  if (!quem) return NextResponse.json({ error: 'Você precisa entrar no sistema.' }, { status: 401 })
  if (quem.area !== 'dashboard') return NextResponse.json({ error: 'Sem acesso ao financeiro.' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const dateStart = searchParams.get('dateStart') ?? ''
  const dateEnd = searchParams.get('dateEnd') ?? ''
  const termos = searchParams.getAll('termos').map(t => t.trim()).filter(Boolean)

  if (!dateStart || !dateEnd || termos.length === 0) {
    return NextResponse.json({ total: 0, campanhas: [] })
  }

  if (!process.env.META_ACCESS_TOKEN) {
    return NextResponse.json({ total: 0, campanhas: [], erro: 'Token não configurado', incompleto: true })
  }

  try {
    const relato: RelatoMeta = { falhas: 0 }
    const result = await getProjectInvestment(termos, dateStart, dateEnd, undefined, relato)
    // Uma conta da Meta falhou: o total viria MENOR sem erro e iria para o
    // fechamento. Volta 0 de propósito com o erro, para a tela pedir nova busca
    // (dono 10/11/2026, Task 6).
    if (relato.falhas > 0) {
      return NextResponse.json({ total: 0, campanhas: [], erro: ERRO_TRAFEGO_INCOMPLETO, incompleto: true })
    }

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
    return NextResponse.json({ total: 0, campanhas: [], erro: ERRO_TRAFEGO_INCOMPLETO, incompleto: true })
  }
}
