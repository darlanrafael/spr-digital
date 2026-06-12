import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  // Capturar headers
  const headers: Record<string, string> = {}
  req.headers.forEach((value, key) => { headers[key] = value })

  // Capturar payload
  let payload: unknown = null
  let payloadErro: string | null = null
  try {
    payload = await req.json()
  } catch (err) {
    payloadErro = err instanceof Error ? err.message : String(err)
  }

  // Status das variáveis de ambiente
  const envStatus = {
    NEXT_PUBLIC_SUPABASE_URL:     Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    HUBLA_WEBHOOK_SECRET:          Boolean(process.env.HUBLA_WEBHOOK_SECRET),
    META_ACCESS_TOKEN:             Boolean(process.env.META_ACCESS_TOKEN),
    META_AD_ACCOUNT_IDS:           Boolean(process.env.META_AD_ACCOUNT_IDS),
  }

  // Tentar SELECT count(*)
  let selectResult: unknown = null
  let selectErro: string | null = null
  const client = getSupabaseClient()

  if (client) {
    try {
      const { data, error } = await client
        .from('sales')
        .select('*', { count: 'exact', head: true })
      selectResult = { count: data, error }
      if (error) selectErro = error.message
    } catch (err) {
      selectErro = err instanceof Error ? err.message : String(err)
    }
  } else {
    selectErro = 'Supabase client não inicializado (env vars ausentes)'
  }

  // Tentar INSERT de venda de teste
  let insertResult: unknown = null
  let insertErro: string | null = null

  if (client) {
    const testSale = {
      id: `debug_test_${Date.now()}`,
      project_id: 'proj_1',
      plataforma: 'hubla',
      plataforma_sale_id: `debug_${Date.now()}`,
      status: 'aprovada',
      data_hora: new Date().toISOString(),
      nome: 'DEBUG TEST - pode deletar',
      email: 'debug@test.com',
      telefone: '',
      produto: 'DEBUG',
      preco_base: 0,
      valor_pago_cliente: 0,
      valor_liquido: 0,
    }
    try {
      const { data, error } = await client.from('sales').insert(testSale).select()
      insertResult = { data, error }
      if (error) insertErro = error.message
      // Limpar logo após inserir
      if (!error) {
        await client.from('sales').delete().eq('id', testSale.id)
        insertResult = { sucesso: true, mensagem: 'INSERT e DELETE executados com sucesso', registroTestado: testSale }
      }
    } catch (err) {
      insertErro = err instanceof Error ? err.message : String(err)
    }
  } else {
    insertErro = 'Supabase client não inicializado'
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    headers,
    payload,
    payloadErro,
    envStatus,
    supabaseConectado: Boolean(client),
    selectCount: selectResult,
    selectErro,
    insertTeste: insertResult,
    insertErro,
  })
}
