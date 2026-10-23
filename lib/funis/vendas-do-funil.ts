import { funilDaVenda, ehProdutoPrincipal } from './funis-config'
import { precisaConverter } from '../moeda-da-venda'

const cent = (n: number) => Math.round(n * 100) / 100

/** O minimo que uma venda precisa trazer pra ser somada num funil. */
export type VendaParaFunil = {
  plataforma: string
  produto: string
  produto_id?: string | null
  status: string
  valor_pago_cliente: number
  valor_liquido: number
  /** Moeda estrangeira quando preenchida (valores NAO convertidos). Ver item 121. */
  moeda?: string | null
}

export type AgregadoVendasFunil = {
  /** Quantidade de vendas aprovadas do funil no periodo (TOTAL: principal + agregados). */
  vendas: number
  /** Vendas do produto PRINCIPAL (venda unica = nº de compradores). */
  vendasPrincipal: number
  /** Soma de valor_pago_cliente (faturamento bruto). */
  faturamentoBruto: number
  /** Soma de (valor_pago_cliente - valor_liquido) = taxas da plataforma. */
  taxas: number
}

/**
 * Soma as vendas (ja filtradas pelo periodo) que pertencem a UM funil.
 *
 * - Conta so status 'aprovada' (reembolso/chargeback nao entram no faturamento;
 *   reembolso tem bloco a parte).
 * - O match com o funil e por produto_id/nome, via funilDaVenda - mesma fonte e
 *   mesma regra que o resto do sistema, com a redundancia id+nome.
 *
 * Puro: recebe as vendas, nao acessa banco. Ver item 114 do spr-digital.md.
 */
export function agregarVendasDoFunil(vendas: VendaParaFunil[], funilId: string): AgregadoVendasFunil {
  let n = 0
  let nPrincipal = 0
  let bruto = 0
  let taxas = 0
  for (const v of vendas) {
    if (v.status !== 'aprovada') continue
    if (precisaConverter(v)) continue // venda em moeda estrangeira nao convertida: fora (igual o DRE)
    if (funilDaVenda(v)?.id !== funilId) continue
    n++
    if (ehProdutoPrincipal(v, funilId)) nPrincipal++
    bruto += v.valor_pago_cliente
    taxas += v.valor_pago_cliente - v.valor_liquido
  }
  return { vendas: n, vendasPrincipal: nPrincipal, faturamentoBruto: cent(bruto), taxas: cent(taxas) }
}
