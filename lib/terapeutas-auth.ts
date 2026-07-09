import { getSupabaseAdmin } from '@/lib/supabase'
import * as crypto from 'crypto'

export function hashSenha(senha: string): string {
  return crypto.createHash('sha256').update(senha + 'spr-terapeutas-salt-2026').digest('hex')
}

// Inputs <input type="datetime-local"> (ex.: agendar sessão, remarcar, concluir
// com data manual) chegam como string sem timezone ("2026-07-13T15:00"). Fazer
// `new Date(string)` direto no servidor é ambíguo — o resultado depende do TZ
// do runtime (Vercel), não do horário real que o usuário digitou em Brasília.
// Sempre usar isso pra converter, nunca `new Date()` puro nesses campos.
// Brasil não tem mais horário de verão desde 2019, então UTC-3 é fixo.
export function brasiliaLocalToISO(datetimeLocal: string): string {
  // datetime-local sempre vem como "YYYY-MM-DDTHH:mm", sem segundos.
  return new Date(`${datetimeLocal}:00-03:00`).toISOString()
}

export async function verificarSenhaUsuario(
  email: string,
  senha: string
): Promise<{ valido: boolean; usuario?: Record<string, unknown> }> {
  const client = getSupabaseAdmin()
  const hash = hashSenha(senha)
  const { data } = await client
    .from('usuarios_sistema')
    .select('*')
    .eq('email', email)
    .eq('senha_hash', hash)
    .eq('ativo', true)
    .single()
  if (!data) return { valido: false }
  return { valido: true, usuario: data }
}

export async function registrarAtividade(params: {
  usuario_nome: string
  usuario_tipo: string
  tipo_acao: string
  sessao_id?: string
  sale_id?: string
  descricao: string
  dados_anteriores?: Record<string, unknown>
  dados_novos?: Record<string, unknown>
}) {
  const client = getSupabaseAdmin()
  await client.from('atividades_log').insert({
    usuario_nome: params.usuario_nome,
    usuario_tipo: params.usuario_tipo,
    tipo_acao: params.tipo_acao,
    sessao_id: params.sessao_id ?? null,
    sale_id: params.sale_id ?? null,
    descricao: params.descricao,
    dados_anteriores: params.dados_anteriores ?? null,
    dados_novos: params.dados_novos ?? null,
  })
}

export function inferirNumeroSessoes(nomeProduto: string): number {
  const nome = nomeProduto.toLowerCase()
  if (nome.includes('8 sess') || nome.includes('8sess')) return 8
  if (nome.includes('4 sess') || nome.includes('4sess')) return 4
  if (nome.includes('2 sess') || nome.includes('2sess')) return 2
  return 1
}

export function calcularComissao(params: {
  valor_liquido: number
  percentual: number
  numero_sessoes: number
}): { comissao_total: number; comissao_por_sessao: number; imposto: number; base: number } {
  const imposto = params.valor_liquido * 0.1285
  const base = params.valor_liquido - imposto
  const comissao_total = base * (params.percentual / 100)
  const comissao_por_sessao = comissao_total / params.numero_sessoes
  return { comissao_total, comissao_por_sessao, imposto, base }
}

export function calcularReembolso(params: {
  terapeuta_nome: string
  sessoes_total: number
  sessoes_feitas: number
  valor_pago: number
}): { valor_reembolso: number; explicacao: string } {
  const tabelaPedro: Record<number, number> = { 1: 1300, 2: 1550, 4: 2860, 8: 5280 }
  const tabelaDenise: Record<number, number> = { 1: 550, 2: 790, 4: 1400, 8: 2640 }
  const isPedro = params.terapeuta_nome.toLowerCase().includes('pedro')
  const tabela = isPedro ? tabelaPedro : tabelaDenise
  const planos = Object.keys(tabela).map(Number).sort((a, b) => a - b)

  if (params.sessoes_feitas === 0) {
    return {
      valor_reembolso: params.valor_pago,
      explicacao: `Nenhuma sessão realizada — reembolso integral de R$ ${params.valor_pago.toFixed(2)}`,
    }
  }
  if (params.sessoes_feitas >= params.sessoes_total) {
    return { valor_reembolso: 0, explicacao: 'Todas as sessões foram realizadas — sem reembolso' }
  }

  let plano_equivalente = 0
  let valor_plano_equivalente = 0
  for (const plano of planos) {
    if (plano <= params.sessoes_feitas) {
      plano_equivalente = plano
      valor_plano_equivalente = tabela[plano]
    }
  }
  const valor_reembolso = Math.max(0, params.valor_pago - valor_plano_equivalente)
  return {
    valor_reembolso,
    explicacao: `Comprou ${params.sessoes_total} sessão(ões) (R$ ${params.valor_pago.toFixed(2)}), realizou ${params.sessoes_feitas} sessão(ões) — equivale ao plano de ${plano_equivalente} sessão(ões) = R$ ${valor_plano_equivalente.toFixed(2)} → Reembolso: R$ ${valor_reembolso.toFixed(2)}`,
  }
}
