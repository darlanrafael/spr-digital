// Venda em moeda estrangeira: detectar na entrada, e converter uma vez so.
//
// O caso que originou (item 57 do spr-digital.md): Rosana Martins Afonso,
// 05/09/2026, primeira venda internacional da Hubla em 1.992 eventos. A cliente
// pagou EUR 319,55, a Hubla liquidou em USD e repassou USD 278,73, e o sistema
// gravou "278,73" num campo de reais. O fechamento contou R$ 278,73 onde havia
// perto de R$ 1.400.
//
// O que tornou o diagnostico dificil, e que este modulo existe para impedir:
// os quatro campos de dinheiro ficaram em moedas DIFERENTES na mesma linha -
// tres em euro e um em dolar. Nenhum cambio unico conserta uma linha assim.
//
// REGRA DA CASA: quando `moeda` esta preenchida, os QUATRO valores estao
// naquela moeda. Sem excecao. E o webhook que garante isso, escolhendo o bloco
// do payload que ja vem homogeneo.

/** A moeda em que a empresa fatura. Tudo diferente disto precisa de conversao. */
export const MOEDA_DA_CASA = 'BRL'

export type ValoresDaVenda = {
  preco_base: number
  valor_pago_cliente: number
  valor_com_juros: number
  valor_liquido: number
}

const naoEhDaCasa = (m: unknown): m is string =>
  typeof m === 'string' && m.trim().length > 0 && m.trim().toUpperCase() !== MOEDA_DA_CASA

/**
 * A moeda de uma venda da Hubla, ou null quando e real.
 *
 * A Hubla marca a moeda em dois lugares e os dois concordam: no bloco
 * `amount.settlement` e em cada `receivers[].currency`. Em 36 de 40 vendas
 * normais conferidas os receivers vem `BRL` e somam `amount.totalCents`; na
 * venda internacional vem `USD` e somam `settlement.totalCents`.
 *
 * Le os dois e aceita qualquer um: se um dia a Hubla parar de mandar um deles,
 * o outro ainda pega. Recusar por falta de um seria voltar ao defeito.
 */
export function moedaDaHubla(invoice: Record<string, unknown> | null | undefined): string | null {
  if (!invoice) return null
  const amount = invoice.amount as Record<string, unknown> | undefined
  const settlement = amount?.settlement as Record<string, unknown> | undefined
  if (naoEhDaCasa(settlement?.currency)) return String(settlement!.currency).trim().toUpperCase()

  const receivers = (invoice.receivers as Record<string, unknown>[]) ?? []
  const seller = receivers.find(r => r.role === 'seller') ?? receivers[0]
  if (naoEhDaCasa(seller?.currency)) return String(seller!.currency).trim().toUpperCase()

  return null
}

/**
 * A moeda de uma venda da Kiwify, ou null quando e real.
 *
 * A Kiwify marca em `Commissions.currency`. Ate 11/09/2026 o codigo dizia em
 * comentario que ela "manda o valor original cobrado sem indicar a moeda" - o
 * campo existe e estava sendo ignorado. O detector antigo era uma RAZAO
 * (`valor_pago_cliente / preco_base < 0.4`), que e chute: acerta quando a
 * diferenca de cambio e grande e erra em cupom ou promocao. Este le o campo.
 */
export function moedaDaKiwify(commissions: Record<string, unknown> | null | undefined): string | null {
  if (!commissions) return null
  // A moeda que IMPORTA e a do REPASSE (settlement): `valor_liquido` vem de
  // `my_commission`, que esta NELA. `commissions.currency` e a moeda da
  // COBRANCA (o que o cliente pagou) e pode ser OUTRA - foi o bug da Natalia
  // (pagou em peso, a empresa recebe em dolar). Ver item 108 do spr-digital.md.
  //
  // Quando o settlement VEM, ele MANDA: estrangeiro -> aquela moeda; BRL ->
  // real (null). Nao cai no fallback da cobranca nesse caso - senao uma venda
  // LIQUIDADA EM REAL mas cobrada em dolar seria marcada estrangeira por engano
  // e um cambio multiplicaria um valor que ja esta em real (achado da revisao).
  const settlement = commissions.settlement_amount_currency
  if (typeof settlement === 'string' && settlement.trim().length > 0) {
    return naoEhDaCasa(settlement) ? settlement.trim().toUpperCase() : null
  }
  // Settlement AUSENTE: cai pra moeda da cobranca so pra nao deixar passar como
  // real uma venda que ja chega estrangeira. Sem o settlement,
  // `valoresInternacionaisDaKiwify` devolve null -> normalizado:false -> a
  // conversao e recusada (nunca assume que cobranca == repasse).
  if (naoEhDaCasa(commissions.currency)) return String(commissions.currency).trim().toUpperCase()
  return null
}

/** Venda que ainda nao pode entrar num fechamento: os valores nao sao reais. */
export function precisaConverter(sale: { moeda?: string | null }): boolean {
  return naoEhDaCasa(sale.moeda)
}

/**
 * Converte os quatro valores com um cambio so.
 *
 * Um cambio so, e nao um por campo, porque a linha e homogenea por construcao.
 * Se algum dia entrar uma linha mista, esta funcao vai produzir numero errado
 * em silencio - por isso a regra da casa esta no topo do arquivo e no comentario
 * da migracao, e nao so aqui.
 */
export function converterParaReais(valores: ValoresDaVenda, cambio: number): ValoresDaVenda {
  if (!(cambio > 0)) throw new Error('cambio precisa ser maior que zero')
  const r = (n: number) => Math.round(n * cambio * 100) / 100
  return {
    preco_base:         r(valores.preco_base),
    valor_pago_cliente: r(valores.valor_pago_cliente),
    valor_com_juros:    r(valores.valor_com_juros),
    valor_liquido:      r(valores.valor_liquido),
  }
}

/**
 * Os valores da venda da Hubla quando ela e internacional.
 *
 * Usa o bloco `settlement` em vez do `amount` de proposito: `amount` vem na
 * moeda do CLIENTE (euro, no caso de Portugal) e o repasse vem na moeda da
 * LIQUIDACAO (dolar). Misturar os dois foi exatamente o defeito. O `settlement`
 * esta na mesma moeda do repasse, entao a linha sai homogenea.
 *
 * O imposto estrangeiro (IVA) fica dentro de `valor_com_juros` e fora de
 * `valor_pago_cliente`, espelhando o que o sistema ja faz com o valor com juros
 * das vendas brasileiras: bruto e a venda, a base do imposto e o total pago.
 */
export function valoresInternacionaisDaHubla(invoice: Record<string, unknown>): ValoresDaVenda | null {
  const amount = invoice.amount as Record<string, unknown> | undefined
  const settlement = amount?.settlement as Record<string, unknown> | undefined
  const receivers = (invoice.receivers as Record<string, unknown>[]) ?? []
  const seller = receivers.find(r => r.role === 'seller')

  const sub = settlement?.subtotalCents as number | undefined
  const tot = settlement?.totalCents as number | undefined
  const rep = seller?.totalCents as number | undefined
  if (typeof sub !== 'number' || typeof tot !== 'number' || typeof rep !== 'number') return null

  return {
    preco_base:         sub / 100,
    valor_pago_cliente: sub / 100,
    valor_com_juros:    tot / 100,
    valor_liquido:      Math.round(rep) / 100,
  }
}

/**
 * Os valores da venda da Kiwify quando ela e internacional, HOMOGENEOS na moeda
 * do REPASSE (settlement).
 *
 * `my_commission`/`settlement_amount` ja vem na moeda do repasse (ex.: USD). O
 * bruto tem que sair NA MESMA moeda:
 * - quando a cobranca e o repasse estao na MESMA moeda, usa o `charge_amount`
 *   cobrado;
 * - quando a cobranca esta em OUTRA moeda (a Natalia pagou em peso e a empresa
 *   recebe em dolar), reconstroi o bruto pelo lado do repasse: liquido + taxa da
 *   Kiwify - e so quando a taxa tambem esta na moeda do repasse.
 * Se nao da pra fechar numa moeda so, devolve null: a linha fica
 * `normalizado:false` e a conversao e RECUSADA, em vez de sair errada em
 * silencio (mesma defesa do `valoresInternacionaisDaHubla`).
 */
export function valoresInternacionaisDaKiwify(commissions: Record<string, unknown>): ValoresDaVenda | null {
  // O liquido do PRODUTOR e `my_commission` (o que a SPR recebe). Em venda
  // co-produzida `settlement_amount` e o TOTAL liquidado e superestimaria o
  // repasse; por isso `my_commission` vem primeiro (achado da revisao).
  const liq = (commissions.my_commission ?? commissions.settlement_amount) as number | undefined
  if (typeof liq !== 'number') return null

  // A moeda do REPASSE tem que ser CONHECIDA e estrangeira pra montar a linha.
  // Sem ela (ou BRL), NAO monta -> null -> normalizado:false -> conversao
  // recusada. Nao assume cobranca == repasse: se o settlement nao veio, uma
  // linha cruzada (cobra peso, recebe dolar) viraria mista marcada normalizada.
  const repasse = commissions.settlement_amount_currency
  if (!naoEhDaCasa(repasse)) return null
  const rep = String(repasse).trim().toUpperCase()
  const cobranca = typeof commissions.currency === 'string' ? commissions.currency.trim().toUpperCase() : ''

  let bruto: number
  if (cobranca !== '' && cobranca === rep) {
    // Cobranca e repasse na MESMA moeda (confirmado): o bruto cobrado ja esta nela.
    bruto = typeof commissions.charge_amount === 'number' ? commissions.charge_amount : liq
  } else {
    // Cobranca em outra moeda: reconstroi o bruto no repasse (liquido + taxa).
    // So vale se a taxa tambem estiver na moeda do repasse; senao, linha mista.
    const fee = commissions.kiwify_fee
    const feeCur = typeof commissions.kiwify_fee_currency === 'string' ? commissions.kiwify_fee_currency.trim().toUpperCase() : ''
    if (typeof fee !== 'number' || feeCur !== rep) return null
    bruto = liq + fee
  }

  return {
    preco_base:         bruto / 100,
    valor_pago_cliente: bruto / 100,
    valor_com_juros:    bruto / 100,
    valor_liquido:      Math.round(liq) / 100,
  }
}
