import { ehDiagnosticoGuiado } from './vendas-por-situacao'

// QUAIS produtos ficam fora da reserva de caixa de 30%, e como isso divide o
// lucro.
//
// A regra nao e contabil, e de ordem de pagamento: quando alguem ENTREGA a
// sessao, essa pessoa precisa ser paga antes de os socios dividirem a parte
// deles. Guardar 30% do lucro desses produtos reservaria dinheiro que ja tem
// dono.
//
// Vale para dois casos:
//
//   1. MENTORIA - a terapeuta recebe um percentual do liquido (ex.: 30% da
//      Denise). Regra antiga, ja valia.
//   2. DIAGNOSTICO GUIADO - a Denise recebe R$ 95 fixos por sessao entregue.
//      DECISAO DO USUARIO em 15/09/2026, nas palavras dele: *"o diagnostico nao
//      entra com 30% para o caixa"*.
//
// O Diagnostico estava do lado errado por um motivo simples: a regra olhava a
// palavra "mentoria" no nome do produto, e o nome do Diagnostico nao a contem.
//
// De quebra, isto conserta uma incoerencia que existia antes: o REPASSE do
// Diagnostico (R$ 95 por sessao) ja era descontado junto com o das mentorias,
// mas a RECEITA dele ficava no bolo que sofre a reserva. Despesa de um lado,
// receita do outro. Agora os dois estao no mesmo lugar.

export const PERCENTUAL_DA_RESERVA = 0.3

/**
 * Este produto fica de fora da reserva de caixa de 30%?
 *
 * Decide pelo NOME do produto, que e o unico dado disponivel na linha do
 * fechamento.
 */
export function foraDaReservaDeCaixa(nomeDoProduto: string): boolean {
  const nome = (nomeDoProduto ?? '').toLowerCase()
  return nome.includes('mentoria') || ehDiagnosticoGuiado(nome)
}

export type LinhaDeProduto = {
  nome: string
  /** Receita liquida da linha, ja sem taxa de plataforma e sem imposto. */
  liquidoPosImpostos: number
}

/**
 * A divisao do lucro entre o que sofre reserva e o que nao sofre.
 *
 * Toda a aritmetica do rodape do fechamento vive aqui, junta, porque os cinco
 * numeros precisam fechar entre si: eram cinco expressoes soltas na tela, e uma
 * mudanca em qualquer uma delas podia deixar as outras quatro incoerentes sem
 * nada reclamar.
 */
export function divisaoDoLucro(params: {
  linhas: LinhaDeProduto[]
  /** Faturamento liquido total do periodo (todas as linhas). */
  faturamentoLiquido: number
  /** Custos fixos e variaveis do periodo. */
  totalCustos: number
  /** Soma de TODOS os repasses a terapeuta, mentoria e diagnostico. */
  repasseTerapeutasTotal: number
}): {
  /** Receita liquida dos produtos que NAO sofrem reserva. */
  faturamentoLiquidoForaDaReserva: number
  lucroBruto: number
  /** Lucro sobre o qual a reserva de 30% incide. */
  lucroBrutoComReserva: number
  reservaCaixa: number
  lucroReal: number
} {
  const faturamentoLiquidoForaDaReserva = params.linhas
    .filter(l => foraDaReservaDeCaixa(l.nome))
    .reduce((a, l) => a + l.liquidoPosImpostos, 0)

  const lucroBruto = params.faturamentoLiquido - params.totalCustos
  const lucroBrutoComReserva = lucroBruto - faturamentoLiquidoForaDaReserva

  // Sem reserva quando da prejuizo: nao ha como reservar 30% de um valor
  // negativo. Nesse caso o prejuizo inteiro vira Lucro Real negativo, para ser
  // rateado entre os socios normalmente.
  const reservaCaixa = lucroBrutoComReserva > 0 ? lucroBrutoComReserva * PERCENTUAL_DA_RESERVA : 0
  const lucroDaParteComReserva = lucroBrutoComReserva > 0
    ? lucroBrutoComReserva * (1 - PERCENTUAL_DA_RESERVA)
    : lucroBrutoComReserva

  const lucroReal = lucroDaParteComReserva
    + (faturamentoLiquidoForaDaReserva - params.repasseTerapeutasTotal)

  return {
    faturamentoLiquidoForaDaReserva,
    lucroBruto,
    lucroBrutoComReserva,
    reservaCaixa,
    lucroReal,
  }
}
