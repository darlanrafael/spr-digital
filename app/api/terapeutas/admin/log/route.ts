import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET() {
  const client = getSupabaseAdmin()
  const { data, error } = await client
    .from('atividades_log')
    .select('id, usuario_nome, usuario_tipo, tipo_acao, sessao_id, sale_id, descricao, dados_novos, created_at')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // `dados_novos` NAO sai daqui cru. Esta rota nao exige autenticacao (nenhum
  // GET de app/api/terapeutas exige), e o campo carrega, conforme o tipo de
  // acao: e-mail e telefone de paciente (`paciente_editado`), e-mail e valores
  // de venda (`lancamento_manual`), valor de reembolso (`reembolso_aprovado`) e
  // - pelo caminho de PUT em admin/usuarios - `senha_hash`.
  //
  // O motivo de ele ter sido incluido e um so: tornar visivel QUANDO alguem
  // passou por cima da trava de horario. Entao so as chaves de auditoria saem.
  const AUDITORIA = ['ignorou_bloqueio', 'bloqueios_atropelados'] as const
  const limpo = (data ?? []).map(l => {
    const d = (l as { dados_novos?: Record<string, unknown> | null }).dados_novos
    const auditoria: Record<string, unknown> = {}
    if (d && typeof d === 'object') {
      for (const k of AUDITORIA) if (k in d) auditoria[k] = d[k]
    }
    return { ...l, dados_novos: Object.keys(auditoria).length > 0 ? auditoria : null }
  })
  return NextResponse.json(limpo)
}
