import type { Closing, ClosingAlert } from '@/types'

// Quem absorve cada reembolso descontado num fechamento, e em que proporcao.
//
// O DEFEITO QUE ORIGINOU (11/09/2026, achado pelo usuario na tela):
// toda deducao herdava a divisao digitada NAQUELE fechamento. Ele estava
// fechando o funil IAR a 50/50 e o reembolso parcial do Miguel Pires, que e
// Mentoria Particular, foi rateado 50/50 junto - quando o combinado para
// Mentoria e 35/65.
//
//   Miguel, R$ 1.560     SPR        Pedro
//   50/50 (o que estava) R$ 780,00  R$   780,00
//   35/65 (o combinado)  R$ 546,00  R$ 1.014,00
//   a SPR absorvia R$ 234 a mais do que o acordado.
//
// A MEDICAO QUE DEU A REGRA CERTA. Conferido no banco, nos 8 fechamentos
// existentes: cada funil sempre rodou com a mesma divisao.
//
//   FECHAMENTO IAR              50/50   (2 fechamentos)
//   FECHAMENTO PERPETUO - CCC   50/50   (2)
//   FECHAMENTO TERAPEUTA        50/50   (2)
//   FECHAMENTO MENTORIAS-PEDRO  35/65   (2)
//
// E os 6 estornos do O RESGATE desta tela vieram TODOS do mesmo fechamento
// (close_1786715202610, IAR, 50/50) - ou seja, estavam certos. So o Miguel
// estava errado, e por um motivo que o dado explica: a venda dele nunca entrou
// em fechamento nenhum, entao nao havia divisao de origem a herdar.
//
// DAI A REGRA: a deducao de um estorno usa a divisao do FECHAMENTO QUE PAGOU
// aquela venda. E o dinheiro voltando pelo mesmo caminho por onde saiu. Quando
// nao ha fechamento de origem (reembolso parcial de venda nunca repassada),
// nao ha o que herdar e quem fecha decide.
//
// POR QUE NAO UM CADASTRO DE "% POR PRODUTO": a divisao e negociacao por funil
// e muda com o tempo - o proprio banco tem 35/65 num mes e 50/50 em outro. Um
// cadastro desses vira numero velho que ninguem lembra de atualizar, e passa a
// errar em silencio. O fechamento de origem, ao contrario, e fato historico:
// nao muda depois de gravado.

/** nome do socio -> percentual. Sempre soma 100 quando vem de um fechamento. */
export type DivisaoSocios = Record<string, number>

export type OrigemDaDivisao = {
  divisao: DivisaoSocios
  /** De onde veio, para a tela poder dizer ao usuario. */
  closingId: string
  etiqueta?: string
  periodo?: string
}

/**
 * A divisao com que a venda deste alerta foi repassada, ou null.
 *
 * Procura o alerta em `compradores` de cada fechamento - e a mesma lista que
 * `calcularAlertasPendentes` usa para decidir que a venda "ja foi repassada",
 * entao quando o alerta existe, o fechamento de origem existe junto. A excecao
 * conhecida e o reembolso PARCIAL: ele nasce de uma solicitacao aprovada e a
 * venda pode nunca ter entrado em fechamento (foi o caso do Miguel).
 *
 * Quando mais de um fechamento contem a venda, vale o MAIS RECENTE: e o que
 * efetivamente pagou por ela por ultimo.
 */
export function divisaoOriginalDoAlerta(
  alerta: Pick<ClosingAlert, 'saleId'>,
  closings: Closing[],
): OrigemDaDivisao | null {
  if (!alerta.saleId) return null

  const candidatos = closings.filter(c => (c.compradores ?? []).some(b => b.id === alerta.saleId))
  if (candidatos.length === 0) return null

  const escolhido = candidatos.reduce((mais, c) =>
    String(c.data_confirmacao ?? c.data ?? '') > String(mais.data_confirmacao ?? mais.data ?? '') ? c : mais)

  const socios = escolhido.socios ?? []
  if (socios.length === 0) return null

  const divisao: DivisaoSocios = {}
  for (const s of socios) divisao[s.nome] = Number(s.percentual)

  return {
    divisao,
    closingId: escolhido.id,
    etiqueta: escolhido.etiqueta,
    periodo: escolhido.periodo ? `${escolhido.periodo.inicio} a ${escolhido.periodo.fim}` : undefined,
  }
}

export type DeducaoRateada = {
  chave: string
  valor: number
  divisao: DivisaoSocios
}

/**
 * Quanto cada socio absorve, somando deducoes que podem ter divisoes
 * diferentes entre si.
 *
 * Um mesmo fechamento pode conter estornos de funis diferentes - foi
 * exatamente o caso que originou isto: seis do O RESGATE a 50/50 e um da
 * Mentoria a 35/65, na mesma tela. Por isso a soma e por item, e nao um
 * percentual unico aplicado ao total.
 */
export function deducoesPorSocio(itens: DeducaoRateada[], socios: string[]): Record<string, number> {
  // Acumula SEM arredondar e arredonda uma vez so, no fim.
  //
  // Arredondar a cada item parece inofensivo e nao e: com sete deducoes o
  // desvio ja aparecia no centavo, e o pior e que a soma dos socios deixava de
  // bater com o total mostrado na tela. Num fechamento, dois numeros que
  // deveriam ser iguais e nao sao custam mais tempo do que valem.
  const exato: Record<string, number> = {}
  for (const nome of socios) exato[nome] = 0
  for (const item of itens) {
    for (const nome of socios) {
      exato[nome] += item.valor * ((item.divisao[nome] ?? 0) / 100)
    }
  }

  // O ULTIMO socio recebe o RESTO, nao a propria conta arredondada. E o que
  // garante que a soma feche exatamente com o total: sem isso, R$ 0,01 sobra ou
  // falta e ninguem sabe de quem e.
  const totalExato = itens.reduce((a, i) =>
    a + socios.reduce((b, n) => b + i.valor * ((i.divisao[n] ?? 0) / 100), 0), 0)
  const cent = (n: number) => Math.round(n * 100) / 100

  const saida: Record<string, number> = {}
  let distribuido = 0
  socios.forEach((nome, i) => {
    if (i === socios.length - 1) {
      saida[nome] = cent(cent(totalExato) - distribuido)
    } else {
      saida[nome] = cent(exato[nome])
      distribuido = cent(distribuido + saida[nome])
    }
  })
  return saida
}

/**
 * A divisao que vale para um alerta: a de origem quando existe, senao a que
 * quem fecha escolheu, senao a do proprio fechamento.
 *
 * A ordem importa e e deliberada. A escolha manual ganha da origem porque quem
 * fecha pode saber de um acordo que o historico nao conta; e a do fechamento
 * atual e o ultimo recurso, que era o comportamento ANTIGO aplicado a tudo.
 */
export function divisaoQueVale(params: {
  origem: OrigemDaDivisao | null
  escolhaManual?: DivisaoSocios | null
  divisaoDoFechamento: DivisaoSocios
}): { divisao: DivisaoSocios; fonte: 'manual' | 'origem' | 'fechamento' } {
  if (params.escolhaManual && Object.keys(params.escolhaManual).length > 0) {
    return { divisao: params.escolhaManual, fonte: 'manual' }
  }
  if (params.origem) return { divisao: params.origem.divisao, fonte: 'origem' }
  return { divisao: params.divisaoDoFechamento, fonte: 'fechamento' }
}

/**
 * O texto do lancamento no caixa quando a EMPRESA absorve o prejuizo.
 *
 * Pedido do usuario em 11/09/2026: *"concordo em fazer e que a saida sera do
 * caixa da empresa. ou seja, a empresa ta pagando.. isso so precisa constar nos
 * minimos detalhes para melhor orientacao"*.
 *
 * A descricao carrega a lista inteira de quem gerou o prejuizo porque e o campo
 * que aparece na tela do Caixa: quem abrir isso daqui a seis meses precisa
 * saber de onde veio sem ter que cruzar tabela nenhuma.
 */
export function descricaoDoPrejuizoNoCaixa(params: {
  itens: { nome: string; produto: string; valor: number; tipo: string; data: string }[]
  etiquetaDoFechamento?: string
  periodo: string
}): string {
  const brl = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const total = params.itens.reduce((a, i) => a + i.valor, 0)
  const linhas = params.itens.map(i => `${i.data} ${i.nome} (${i.produto}) ${i.tipo} R$ ${brl(i.valor)}`)
  return [
    `REEMBOLSOS ABSORVIDOS PELA EMPRESA - R$ ${brl(total)}`,
    `Fechamento${params.etiquetaDoFechamento ? ` "${params.etiquetaDoFechamento}"` : ''}, periodo ${params.periodo}.`,
    `A EMPRESA ESTA PAGANDO: este valor NAO foi descontado do repasse dos socios.`,
    `Saida do caixa da empresa, por decisao de quem fechou.`,
    `${params.itens.length} reembolso(s)/chargeback(s):`,
    ...linhas,
  ].join('\n')
}
