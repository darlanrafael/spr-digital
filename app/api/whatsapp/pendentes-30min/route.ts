import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarSecretCron, buscarPendentes } from '@/lib/whatsapp-pendentes'

export async function GET(req: NextRequest) {
  if (!verificarSecretCron(req)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  const agora = new Date()
  const emTrintaMin = new Date(agora.getTime() + 30 * 60 * 1000)
  try {
    const terapeutas = await buscarPendentes(getSupabaseAdmin(), {
      inicio: agora.toISOString(),
      fim: emTrintaMin.toISOString(),
      colGrupo: 'lembrete_grupo_30min_enviado_em',
      colPaciente: 'lembrete_paciente_30min_enviado_em',
    })
    return NextResponse.json({ terapeutas })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
