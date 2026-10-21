import { ACRESCIMO_TRAFEGO } from './funis-config'

const cent = (n: number) => Math.round(n * 100) / 100

export type EntradaResultado = {
  /** Soma do faturamento BRUTO das vendas do funil no periodo. */
  faturamentoBruto: number
  /** Taxas da plataforma (bruto - liquido das vendas). */
  taxas: number
  /** Investimento em trafego da Meta (sem o acrescimo). */
  trafego: number
  /** Aliquota de imposto do funil (fracao): 0.1285 CSP, 0.0385 Imersao. */
  impostoRate: number
}

export type ResultadoDoFunil = {
  faturamentoLiquido: number
  impostos: number
  /** Trafego com o acrescimo de 13,85% (o que de fato "custou"). */
  trafegoComAcrescimo: number
  resultadoLiquido: number
  /** Faturamento bruto / trafego (sem acrescimo). 0 quando nao houve trafego. */
  roas: number
  /** Resultado liquido / faturamento bruto. 0 quando nao houve faturamento. */
  margem: number
}

/**
 * A conta financeira de um funil. Pura. As regras (aliquota por funil, acrescimo
 * de trafego) vem da config - ver lib/funis/funis-config.ts.
 */
export function resultadoDoFunil(e: EntradaResultado): ResultadoDoFunil {
  const faturamentoLiquido = cent(e.faturamentoBruto - e.taxas)
  const impostos = cent(e.faturamentoBruto * e.impostoRate)
  const trafegoComAcrescimo = cent(e.trafego * (1 + ACRESCIMO_TRAFEGO))
  const resultadoLiquido = cent(faturamentoLiquido - impostos - trafegoComAcrescimo)
  const roas = e.trafego > 0 ? e.faturamentoBruto / e.trafego : 0
  const margem = e.faturamentoBruto > 0 ? resultadoLiquido / e.faturamentoBruto : 0
  return { faturamentoLiquido, impostos, trafegoComAcrescimo, resultadoLiquido, roas, margem }
}
