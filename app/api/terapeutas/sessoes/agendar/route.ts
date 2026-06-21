import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarSenhaUsuario, registrarAtividade, inferirNumeroSessoes, calcularComissao } from '@/lib/terapeutas-auth'

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const { sale_id, terapeuta_id, data_primeira_sessao, usuario_email, senha } = body as {
    sale_id: string
    terapeuta_id: string
    data_primeira_sessao: string
    usuario_email: string
    senha: string
  }

  if (!sale_id || !terapeuta_id || !data_primeira_sessao || !usuario_email || !senha) {
    return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 })
  }

  const { valido, usuario } = await verificarSenhaUsuario(usuario_email, senha)
  if (!valido) return NextResponse.json({ error: 'Senha inválida' }, { status: 401 })

  const client = getSupabaseAdmin()

  const { data: sale, error: saleErr } = await client
    .from('sales').select('id,nome,email,produto,valor_liquido').eq('id', sale_id).single()
  if (saleErr || !sale) return NextResponse.json({ error: 'Venda não encontrada' }, { status: 404 })

  const { data: terapeuta, error: terapErr } = await client
    .from('terapeutas').select('id,percentual_comissao').eq('id', terapeuta_id).single()
  if (terapErr || !terapeuta) return NextResponse.json({ error: 'Terapeuta não encontrado' }, { status: 404 })

  const numSessoes = inferirNumeroSessoes(sale.produto as string)
  const { comissao_por_sessao } = calcularComissao({
    valor_liquido: sale.valor_liquido as number,
    percentual: terapeuta.percentual_comissao as number,
    numero_sessoes: numSessoes,
  })

  // Deletar sessões existentes que ainda não foram entregues (reagendamento total)
  await client.from('sessoes').delete()
    .eq('sale_id', sale_id)
    .in('status', ['pendente', 'agendada', 'remarcada'])

  const primeiraData = new Date(data_primeira_sessao)
  const sessoes = Array.from({ length: numSessoes }, (_, i) => {
    const data = new Date(primeiraData)
    data.setDate(data.getDate() + i * 7)
    return {
      sale_id,
      terapeuta_id,
      numero_sessao: i + 1,
      total_sessoes: numSessoes,
      status: 'agendada',
      status_consulta: 'aguardando',
      data_agendada: data.toISOString(),
      link_meet: null,
      comissao_valor: comissao_por_sessao,
      comissao_paga: false,
      paciente_nome: sale.nome as string,
      paciente_email: sale.email as string,
      agendado_por: (usuario as Record<string, unknown>)?.nome as string ?? usuario_email,
      vendedor_nome: (usuario as Record<string, unknown>)?.nome as string ?? usuario_email,
      vendedor_email: usuario_email,
    }
  })

  const { error: insertErr } = await client.from('sessoes').insert(sessoes)
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  await registrarAtividade({
    usuario_nome: (usuario as Record<string, unknown>)?.nome as string ?? usuario_email,
    usuario_tipo: (usuario as Record<string, unknown>)?.tipo as string ?? 'comercial',
    tipo_acao: 'agendamento',
    sale_id,
    descricao: `${numSessoes} sessões agendadas para ${sale.nome} — primeira em ${primeiraData.toLocaleDateString('pt-BR')}`,
    dados_novos: { numSessoes, data_primeira_sessao, terapeuta_id, comissao_por_sessao },
  })

  return NextResponse.json({ success: true, sessoes_criadas: numSessoes })
}
