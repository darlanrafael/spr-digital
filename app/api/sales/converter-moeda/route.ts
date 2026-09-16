import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { converterParaReais, precisaConverter, MOEDA_DA_CASA } from '@/lib/moeda-da-venda'
import { lerIdentidade, podeMexerEmVenda } from '@/lib/identidade-da-chamada'

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
  // QUEM ESTA CHAMANDO, pelo cracha que o middleware confere (guarda de
  // papel - Tarefa 14). Vem do cabecalho, entao roda ANTES de tocar em
  // req.json() ou banco: provado em 15/09/2026 que uma terapeuta alcancava
  // esta rota (404 "Venda nao encontrada" - passou da permissao, so nao
  // achou o id falso). Comercial e admin trabalham com venda; terapeuta e
  // socio nao.
  const quem = lerIdentidade(req)
  if (!quem) return NextResponse.json({ error: 'Você precisa entrar no sistema.' }, { status: 401 })
  if (!podeMexerEmVenda(quem)) {
    return NextResponse.json({ error: 'Você não tem permissão para converter vendas.' }, { status: 403 })
  }

  // Corpo protegido: sem isto, um JSON malformado derruba a rota com 500 e sem
  // mensagem util. Achado na auditoria das rotas em 15/09/2026.
  let corpo: { sale_id?: string; cambio?: unknown; usuario_email?: string }
  try {
    corpo = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }
  const { sale_id, cambio, usuario_email } = corpo

  // CAMADA EXTRA, historica: esta rota GRAVA DINHEIRO - ela reescreve os
  // quatro valores de uma venda - e subiu em 11/09/2026 sem nenhuma
  // verificacao: qualquer um que soubesse a URL podia converter uma venda
  // com o cambio que quisesse. Achado na auditoria das rotas de 15/09/2026,
  // junto com o `req.json()` desprotegido e a falta de try/catch. A guarda
  // por identidade acima ja fecha a porta por papel; esta checagem continua
  // como camada a mais, mesmo criterio das outras rotas de dinheiro do
  // projeto: o e-mail precisa existir em `usuarios_sistema` e estar ativo.
  const email = String(usuario_email ?? '').trim().toLowerCase()
  if (!email) return NextResponse.json({ error: 'usuario_email é obrigatório' }, { status: 401 })
  const { data: usuarioDoEmail } = await getSupabaseAdmin()
    .from('usuarios_sistema').select('id').ilike('email', email).eq('ativo', true).maybeSingle()
  if (!usuarioDoEmail) return NextResponse.json({ error: 'Usuário não autorizado' }, { status: 403 })

  if (!sale_id) return NextResponse.json({ error: 'sale_id é obrigatório' }, { status: 400 })
  const taxa = Number(cambio)
  if (!(taxa > 0)) return NextResponse.json({ error: 'Câmbio precisa ser um número maior que zero' }, { status: 400 })
  // Teto de sanidade: erro de digitação (500 no lugar de 5,00) multiplicaria o
  // faturamento por cem, e a linha ainda pareceria plausível na tela.
  if (taxa > 100) return NextResponse.json({ error: `Câmbio de ${taxa} parece erro de digitação. Confira antes de aplicar.` }, { status: 400 })

  try {
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
  } catch (err) {
    // Falha inesperada nao pode virar 500 mudo: quem esta fechando precisa
    // saber que a conversao NAO aconteceu.
    console.error('[converter-moeda]', err)
    return NextResponse.json({ error: 'Falha ao converter. A venda não foi alterada.' }, { status: 500 })
  }
}
