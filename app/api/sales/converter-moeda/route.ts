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

  // Linha que o webhook nao conseguiu normalizar pode estar em moedas
  // MISTURADAS - foi exatamente o estado da venda da Rosana antes da correcao
  // (tres campos em euro, um em dolar). Um cambio unico ali da numero errado
  // com cara de certo. Melhor recusar e mandar conferir.
  const orig = venda.valores_originais as { normalizado?: boolean } | null
  if (orig && orig.normalizado === false) {
    return NextResponse.json({
      error: 'Esta venda veio da plataforma com os valores em moedas diferentes na mesma linha, '
        + 'e não dá para converter tudo com um câmbio só. Confira o pedido na plataforma antes.',
    }, { status: 409 })
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
  //
  // E o `.not('moeda', 'is', null)` faz disto um compare-and-swap: a checagem
  // acima olha o estado LIDO, e entre a leitura e a gravação cabe outra
  // requisição. Dois cliques ao mesmo tempo com câmbios diferentes se
  // sobrescreviam em silêncio; agora o segundo não casa nenhuma linha e é
  // recusado. `select` é o que permite SABER que não casou - `update` sozinho
  // devolve sucesso mesmo afetando zero linhas.
  const { data: gravadas, error: e2 } = await client.from('sales').update({
    ...depois,
    moeda: null,
    cambio_aplicado: taxa,
    // Guarda os valores da linha junto do que o webhook já tinha: dá pra
    // refazer a conta com outro câmbio sem depender do payload original.
    valores_originais: { ...(venda.valores_originais as Record<string, unknown> ?? {}), moeda: venda.moeda, valores: antes },
  }).eq('id', sale_id).not('moeda', 'is', null).select('id')

  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })
  if (!gravadas || gravadas.length === 0) {
    return NextResponse.json({
      error: 'Esta venda já foi convertida por outra ação agora mesmo. Recarregue a tela para ver o valor atual.',
    }, { status: 409 })
  }

  return NextResponse.json({ success: true, nome: venda.nome, moeda: venda.moeda, cambio: taxa, antes, depois })
}
