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

  // Marca SÓ quando ainda não há marca, e devolve se marcou.
  //
  // A primeira versão gravava por cima sem checar. Duas consequências, as duas
  // ruins e as duas descobertas na varredura de 14/09/2026:
  //
  //   1. A marca original era perdida. Se a mesma sessão fosse enviada duas
  //      vezes, o banco guardava só a última e não havia como saber que houve
  //      duplicata — nem olhando o histórico depois.
  //   2. A resposta era sempre `success: true`, então quem chamou nunca ficava
  //      sabendo que estava marcando algo já marcado.
  //
  // Isso virou risco de verdade quando a véspera passou a rodar três vezes por
  // noite (21:30, 21:45, 22:00) para tolerar a falha intermitente do Supabase.
  // A proteção contra envio repetido é a consulta de pendentes, que já exclui
  // o que está marcado — mas se o envio acontecer e a marcação falhar logo
  // depois, a rodada seguinte reenviaria. Agora esse caso deixa rastro em vez
  // de sumir.
  const { data: marcadas, error } = await getSupabaseAdmin()
    .from('sessoes')
    .update({ [coluna]: new Date().toISOString() })
    .eq('id', sessao_id)
    .is(coluna, null)
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const marcou = !!marcadas && marcadas.length > 0
  // 200 nos dois casos de propósito: para o n8n, "já estava marcado" não é
  // falha — é o resultado esperado de uma segunda rodada. Devolver erro faria
  // a rodada de segurança parecer quebrada toda noite.
  return NextResponse.json({
    success: true,
    marcou,
    ...(marcou ? {} : { aviso: 'Esta sessão já estava marcada como enviada. Se uma mensagem acabou de sair, houve envio repetido.' }),
  })
}
