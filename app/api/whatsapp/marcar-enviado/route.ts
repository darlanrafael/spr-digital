import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarSecretCron } from '@/lib/whatsapp-pendentes'

const COLUNA_POR_TIPO = {
  grupo_vespera: 'lembrete_grupo_vespera_enviado_em',
  paciente_vespera: 'lembrete_paciente_vespera_enviado_em',
  grupo_30min: 'lembrete_grupo_30min_enviado_em',
  paciente_30min: 'lembrete_paciente_30min_enviado_em',
} as const

type Tipo = keyof typeof COLUNA_POR_TIPO

export async function POST(req: NextRequest) {
  if (!verificarSecretCron(req)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const { sessao_id, tipo } = body as { sessao_id?: string; tipo?: string }
  if (!sessao_id || !tipo || !(tipo in COLUNA_POR_TIPO)) {
    return NextResponse.json(
      { error: 'sessao_id e tipo (grupo_vespera|paciente_vespera|grupo_30min|paciente_30min) são obrigatórios' },
      { status: 400 }
    )
  }

  const coluna = COLUNA_POR_TIPO[tipo as Tipo]
  const { error } = await getSupabaseAdmin()
    .from('sessoes')
    .update({ [coluna]: new Date().toISOString() })
    .eq('id', sessao_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
