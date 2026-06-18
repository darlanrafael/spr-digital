import { getSupabaseAdmin } from '@/lib/supabase'
import * as crypto from 'crypto'

export function hashSenha(senha: string): string {
  return crypto.createHash('sha256').update(senha + 'spr-terapeutas-salt-2026').digest('hex')
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
