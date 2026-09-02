import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET() {
  const client = getSupabaseAdmin()
  const { data, error } = await client
    .from('atividades_log')
    .select(// `dados_novos` entra por causa de `ignorou_bloqueio`: quando alguem passa por
    // cima da trava de horario, a evidencia fica ali. Sem este campo o registro
    // era indistinguivel de um agendamento comum, e a pergunta "alguem forcou?"
    // so tinha resposta com acesso direto ao banco.
    'id, usuario_nome, usuario_tipo, tipo_acao, sessao_id, sale_id, descricao, dados_novos, created_at')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
