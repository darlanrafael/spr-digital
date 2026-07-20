import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarSecretCron, buscarPendentes } from '@/lib/whatsapp-pendentes'

// Brasília = UTC-3, fixo (sem horário de verão desde 2019). "Amanhã" é
// calculado em cima da data de Brasília, não da data UTC do servidor.
function brasiliaAmanhaRangeUTC(): { inicio: string; fim: string } {
  const now = new Date()
  const br = new Date(now.getTime() - 3 * 60 * 60 * 1000)
  const amanha = new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate() + 1))
  const inicio = new Date(Date.UTC(amanha.getUTCFullYear(), amanha.getUTCMonth(), amanha.getUTCDate(), 3, 0, 0))
  const fim = new Date(Date.UTC(amanha.getUTCFullYear(), amanha.getUTCMonth(), amanha.getUTCDate() + 1, 2, 59, 59))
  return { inicio: inicio.toISOString(), fim: fim.toISOString() }
}

export async function GET(req: NextRequest) {
  if (!verificarSecretCron(req)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  const { inicio, fim } = brasiliaAmanhaRangeUTC()
  try {
    const terapeutas = await buscarPendentes(getSupabaseAdmin(), {
      inicio, fim,
      colGrupo: 'lembrete_grupo_vespera_enviado_em',
      colPaciente: 'lembrete_paciente_vespera_enviado_em',
    })
    return NextResponse.json({ terapeutas })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
