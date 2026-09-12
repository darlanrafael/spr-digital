// As contas que TEM que fechar num fechamento, conferidas na propria tela.
//
// POR QUE EXISTE. Em 11-12/09/2026 o usuario pediu um metodo com chance minima
// de deixar passar. Teste pega o caso que eu imaginei; pre-voo pega o padrao que
// eu ja errei. Nenhum dos dois pega conta que nao fecha num dado que eu nunca
// vi - e e nesse que o dinheiro sai errado.
//
// Cada invariante aqui nasceu de um defeito REAL:
//
//   I1  a soma dos socios divergindo do total deduzido  -> achado em 12/09
//   I2  repasse de terapeuta sem base que o explique    -> Diagnostico, 11/09
//   I3  parte nao somando o todo no faturamento
//   I4  deducao maior que o proprio estorno
//   I5  venda contada duas vezes entre produtos
//
// A tela mostra o que falhar. Nao trava o fechamento de proposito: invariante
// que trava vira invariante que alguem desliga. Ela AVISA, com o numero dos dois
// lados, e quem fecha decide.

export type Invariante = {
  id: string
  titulo: string
  /** O que o usuario precisa fazer. Vazio quando a conta fechou. */
  detalhe: string
  esperado: number
  encontrado: number
  diferenca: number
}

/**
 * A conta e feita em CENTAVOS INTEIROS, e a tolerancia e UM centavo.
 *
 * Em ponto flutuante nao existe "exatamente na tolerancia": `9770 - (9770 +
 * 0.011)` da `-0.011000000000422`, que e maior que 0.011. Qualquer limite
 * escrito em reais e furado pela representacao, e o teste de fronteira que eu
 * escrevi depois do teste de mutacao bateu exatamente nisso, em 12/09/2026.
 *
 * Em centavos inteiros o limite e exato: um centavo de diferenca e
 * arredondamento e passa calado; dois ja e divergencia e aparece.
 */
const TOLERANCIA_EM_CENTAVOS = 1
const centavos = (n: number) => Math.round(n * 100)
const cent = (n: number) => Math.round(n * 100) / 100

export type DadosDoFechamento = {
  /** Linhas do Detalhamento de Faturamento. */
  byProduct: { nome: string; qtd: number; bruto: number; taxas: number; imposto: number; liquido: number; repasse_terapeuta?: number }[]
  faturamentoBruto: number
  taxasPlataforma: number
  impostoTotal: number
  faturamentoLiquido: number
  /** Estornos marcados para abater neste fechamento. */
  alertasSelecionados: { valor: number }[]
  /** Quanto cada socio absorve dos estornos. */
  deducaoPorSocio: number[]
  /** Zero quando a empresa absorve. */
  deducaoDosSocios: number
  /** Vendas que somaram faturamento, para achar contagem dupla. */
  compradores: { id: string }[]
}

export function invariantesDoFechamento(d: DadosDoFechamento): Invariante[] {
  const falhas: Invariante[] = []
  const confere = (id: string, titulo: string, esperado: number, encontrado: number, detalhe: string) => {
    // Compara a diferenca CRUA com a tolerancia, e arredonda so para MOSTRAR.
    //
    // A primeira versao arredondava antes de comparar, e ai o limite efetivo
    // virava um centavo e meio em vez de um centavo e um milesimo - a constante
    // TOLERANCIA mentia sobre o proprio valor. Achado em 12/09/2026 por um
    // teste de fronteira escrito depois que o teste de mutacao mostrou que
    // nenhum caso exercitava o limite.
    const difEmCentavos = centavos(encontrado) - centavos(esperado)
    if (Math.abs(difEmCentavos) > TOLERANCIA_EM_CENTAVOS) {
      falhas.push({ id, titulo, detalhe, esperado: cent(esperado), encontrado: cent(encontrado), diferenca: difEmCentavos / 100 })
    }
  }

  // I1 — o que sai do bolso dos socios e o que os socios absorvem.
  // Defeito real: `deducaoDosSocios` vinha de `alertasTotal` e as linhas vinham
  // do rateio por alerta. Bastava a divisao de um alerta nao somar 100 para o
  // rodape dizer um total que as linhas nao somam.
  const somaSocios = d.deducaoPorSocio.reduce((a, v) => a + v, 0)
  if (d.deducaoDosSocios > 0) {
    confere('I1', 'A dedução dos sócios não soma o total',
      d.deducaoDosSocios, somaSocios,
      'O total deduzido e a soma por sócio discordam. Confira a coluna "Quem absorve": a divisão de algum estorno pode não estar somando 100%.')
  }

  // I2 — repasse de terapeuta sempre com base que o explique.
  // Defeito real: o Diagnostico Guiado tinha repasse R$ 0,00 porque o nome do
  // produto nao contem nome de terapeuta. Ficou invisivel por semanas.
  for (const p of d.byProduct) {
    const repasse = p.repasse_terapeuta ?? 0
    if (repasse > 0 && p.liquido <= 0) {
      falhas.push({ id: 'I2', titulo: 'Repasse a terapeuta sem faturamento que o sustente',
        detalhe: `${p.nome}: repasse de terapeuta com faturamento líquido zero ou negativo.`,
        esperado: 0, encontrado: cent(repasse), diferenca: cent(repasse) })
    }
    if (repasse < 0) {
      falhas.push({ id: 'I2', titulo: 'Repasse a terapeuta negativo',
        detalhe: `${p.nome}: repasse negativo não faz sentido.`,
        esperado: 0, encontrado: cent(repasse), diferenca: cent(repasse) })
    }
  }

  // I3 — a parte soma o todo.
  confere('I3', 'O faturamento bruto não soma as linhas do detalhamento',
    d.faturamentoBruto, d.byProduct.reduce((a, p) => a + p.bruto, 0),
    'A soma da coluna Faturamento bruto do detalhamento tem que dar o total mostrado acima.')
  confere('I3', 'O faturamento líquido não fecha com bruto menos taxas e imposto',
    d.faturamentoLiquido, d.faturamentoBruto - d.taxasPlataforma - d.impostoTotal,
    'Líquido tem que ser bruto menos taxas menos imposto.')

  // I4 — deducao nunca maior que o estorno que a originou.
  // Defeito real: a mesma venda deduzida duas vezes (parcial + integral),
  // R$ 4.318,70 sobre uma venda de R$ 2.758,70.
  const totalEstornos = d.alertasSelecionados.reduce((a, x) => a + x.valor, 0)
  if (d.deducaoDosSocios > 0 && centavos(d.deducaoDosSocios) - centavos(totalEstornos) > TOLERANCIA_EM_CENTAVOS) {
    falhas.push({ id: 'I4', titulo: 'Dedução maior que o total dos estornos',
      detalhe: 'Está sendo descontado dos sócios mais do que a soma dos estornos marcados. Algum estorno pode estar contado duas vezes.',
      esperado: cent(totalEstornos), encontrado: cent(d.deducaoDosSocios), diferenca: cent(d.deducaoDosSocios - totalEstornos) })
  }

  // I5 — nenhuma venda contada duas vezes.
  // O `compradores` e a lista autoritativa do que somou faturamento; id
  // repetido e receita dobrada.
  const vistos = new Set<string>()
  const repetidos = new Set<string>()
  for (const b of d.compradores) { if (b.id) { if (vistos.has(b.id)) repetidos.add(b.id); vistos.add(b.id) } }
  if (repetidos.size > 0) {
    falhas.push({ id: 'I5', titulo: 'Venda contada mais de uma vez',
      detalhe: `${repetidos.size} venda(s) aparecem duas vezes na lista de compradores: ${[...repetidos].slice(0, 3).join(', ')}. O faturamento está dobrado nelas.`,
      esperado: d.compradores.length - repetidos.size, encontrado: d.compradores.length, diferenca: repetidos.size })
  }

  return falhas
}
