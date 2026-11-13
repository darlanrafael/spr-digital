import type { Sale } from '@/types'
import { getSaleBruto, getImpostoBase } from './formatters'
import { aliquotaNoDre } from './aliquota-imposto'

// Receita de um mes no DRE (dono 13/11/2026). Antes, "taxas" subtraia o imposto
// e a receita liquida somava de volta: o resultado saia SEM descontar imposto.
// Agora: taxas = bruto - liquido das plataformas (com sinal); receita liquida =
// bruto - imposto - taxas (= liquido - imposto). Aliquota pela data da venda.

type VendaDoDre = Pick<Sale, 'plataforma' | 'valor_pago_cliente' | 'preco_base' | 'valor_com_juros' | 'valor_liquido' | 'data_hora'>

export function receitaDoMesNoDre(vendas: VendaDoDre[]): {
  receitaBruta: number; impostos: number; taxasPlataforma: number; receitaLiquida: number; liquidoPosImpostos: number
} {
  let receitaBruta = 0, impostos = 0, liquido = 0
  for (const v of vendas) {
    receitaBruta += getSaleBruto(v)
    impostos += getImpostoBase(v) * aliquotaNoDre(v) / 100
    liquido += v.valor_liquido
  }
  const taxasPlataforma = receitaBruta - liquido
  const receitaLiquida = receitaBruta - impostos - taxasPlataforma
  return { receitaBruta, impostos, taxasPlataforma, receitaLiquida, liquidoPosImpostos: receitaLiquida }
}
