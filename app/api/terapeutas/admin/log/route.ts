import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET() {
  const client = getSupabaseAdmin()
  const { data, error } = await client
    .from('atividades_log')
    .select('id, usuario_nome, usuario_tipo, tipo_acao, sessao_id, sale_id, descricao, created_at')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
