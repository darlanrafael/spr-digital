import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { converterParaReais, precisaConverter, MOEDA_DA_CASA } from '@/lib/moeda-da-venda'

// Converte para real uma venda que entrou em moeda estrangeira.
//
// Por que o cambio vem de FORA e nao de uma API de cotacao: ele e decisao do
// negocio, nao dado tecnico. Na primeira conversao (item 57) o usuario escolheu
// 5,00 tendo as cotacoes oficiais de 5,1253 e 5,0856 na mesa. Buscar a cotacao
// e aplicar sozinho seria decidir por ele o valor do faturamento.
//
// A conversao e IDEMPOTENTE por construcao: so roda enquanto `moeda` esta
// preenchida, e a mesma gravacao que converte limpa esse campo. Chamar duas
// vezes nao multiplica o valor duas vezes - a segunda chamada e recusada.
export async function POST(req: NextRequest) {
  const { sale_id, cambio } = await req.json()

  if (!sale_id) return NextResponse.json({ error: 'sale_id é obrigatório' }, { status: 400 })
  const taxa = Number(cambio)
  if (!(taxa > 0)) return NextResponse.json({ error: 'Câmbio precisa ser um número maior que zero' }, { status: 400 })
  // Teto de sanidade: erro de digitação (500 no lugar de 5,00) multiplicaria o
  // faturamento por cem, e a linha ainda pareceria plausível na tela.
  if (taxa > 100) return NextResponse.json({ error: `Câmbio de ${taxa} parece erro de digitação. Confira antes de aplicar.` }, { status: 400 })

  const client = getSupabaseAdmin()
  const { data: venda, error } = await client.from('sales')
    .select('id,nome,produto,moeda,preco_base,valor_pago_cliente,valor_com_juros,valor_liquido,valores_originais')
    .eq('id', sale_id).single()

  if (error || !venda) return NextResponse.json({ error: 'Venda não encontrada' }, { status: 404 })
  if (!precisaConverter(venda)) {
    return NextResponse.json({ error: `Esta venda já está em ${MOEDA_DA_CASA}. Nada a converter.` }, { status: 409 })
  }

  const antes = {
    preco_base:         Number(venda.preco_base),
    valor_pago_cliente: Number(venda.valor_pago_cliente),
    valor_com_juros:    Number(venda.valor_com_juros ?? venda.valor_pago_cliente),
    valor_liquido:      Number(venda.valor_liquido),
  }
  const depois = converterParaReais(antes, taxa)

  // `moeda: null` na MESMA gravação dos valores: é o que torna a rota
  // idempotente. Separado em dois updates, uma falha no meio deixaria a venda
  // convertida e ainda marcada como estrangeira, pronta para converter de novo.
  const { error: e2 } = await client.from('sales').update({
    ...depois,
    moeda: null,
    cambio_aplicado: taxa,
    // Guarda os valores da linha junto do que o webhook já tinha: dá pra
    // refazer a conta com outro câmbio sem depender do payload original.
    valores_originais: { ...(venda.valores_originais as Record<string, unknown> ?? {}), moeda: venda.moeda, valores: antes },
  }).eq('id', sale_id)

  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })

  return NextResponse.json({ success: true, nome: venda.nome, moeda: venda.moeda, cambio: taxa, antes, depois })
}
