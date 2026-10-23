import { ACRESCIMO_TRAFEGO } from './funis-config'

const cent = (n: number) => Math.round(n * 100) / 100

export type VendaDia = { data_hora: string; valor_pago_cliente: number; valor_liquido: number }
export type TrafegoDia = { data: string; investido: number }
export type PontoResultado = { data: string; faturamento: number; resultadoLiquido: number }

/**
 * Resultado liquido dia a dia do funil: combina as vendas (por data_hora, ja em
 * BRT pelo mapSaleRow) com o trafego da Meta (por dia), aplicando o imposto do
 * funil e o acrescimo de 13,85% no trafego. Dia com trafego e sem venda aparece
 * (resultado negativo); dia com venda e sem trafego tambem. Puro.
 */
export function resultadoDiario(vendas: VendaDia[], trafego: TrafegoDia[], impostoRate: number): PontoResultado[] {
  const bruto = new Map<string, number>()
  const taxas = new Map<string, number>()
  for (const v of vendas) {
    const dia = v.data_hora.slice(0, 10)
    bruto.set(dia, (bruto.get(dia) ?? 0) + v.valor_pago_cliente)
    taxas.set(dia, (taxas.get(dia) ?? 0) + (v.valor_pago_cliente - v.valor_liquido))
  }
  const traf = new Map<string, number>()
  for (const t of trafego) traf.set(t.data, (traf.get(t.data) ?? 0) + t.investido)

  const dias = [...new Set([...bruto.keys(), ...traf.keys()])].sort()
  return dias.map(dia => {
    const b = bruto.get(dia) ?? 0
    const tx = taxas.get(dia) ?? 0
    const tr = traf.get(dia) ?? 0
    const resultadoLiquido = cent((b - tx) - b * impostoRate - tr * (1 + ACRESCIMO_TRAFEGO))
    return { data: dia, faturamento: cent(b), resultadoLiquido }
  })
}

export type VendaReembolso = { data_reembolso?: string | null; valor_pago_cliente: number }
export type PontoReembolso = { data: string; reembolso: number }

/**
 * Reembolso dia a dia do funil, agrupado por data_reembolso (que no banco ja e
 * uma DATA pura YYYY-MM-DD). Soma o valor_pago_cliente das vendas estornadas.
 */
export function reembolsoDiario(reembolsos: VendaReembolso[]): PontoReembolso[] {
  const porDia = new Map<string, number>()
  for (const v of reembolsos) {
    const dia = v.data_reembolso
    if (!dia) continue
    porDia.set(dia, (porDia.get(dia) ?? 0) + v.valor_pago_cliente)
  }
  return [...porDia.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([data, reembolso]) => ({ data, reembolso: cent(reembolso) }))
}
