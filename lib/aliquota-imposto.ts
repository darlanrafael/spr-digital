import type { Sale } from '@/types'
import { getAliquotaRegraAntiga } from './formatters'

// Aliquota de imposto nova (dono 13/11/2026). Uma regra por tela:
// - Fechamento: venda que nao entrou em fechamento calculado pela regra antiga
//   usa a regra nova (por venda, nao por data).
// - DRE e Dashboard: venda de 20/10/2026 em diante usa a regra nova (por data).
// Comissao/repasse de terapeuta nao muda: segue a regra antiga.
// Ver docs/superpowers/specs/2026-11-13-aliquota-imposto-nova-design.md.

/** Carimbo gravado em cada item de by_product dos fechamentos feitos pela regra nova. */
export const REGRA_IMPOSTO_NOVA = 'nova-2026-11' as const
/** Primeiro dia (BRT) em que o DRE e o Dashboard usam a regra nova. */
export const INICIO_REGRA_NOVA_DRE = '2026-10-20'

/** Regra nova: 3,8% ate R$ 167 (inclusive), 8,71% acima. */
export function aliquotaRegraNova(preco: number): number {
  return preco <= 167 ? 3.8 : 8.71
}

type FechamentoParaRegra = {
  byProduct?: { regraImposto?: string }[] | null
  compradores?: { id?: string }[] | null
}

/** O fechamento foi calculado pela regra nova (tem o carimbo em algum item)? */
export function fechamentoEhDaRegraNova(c: Pick<FechamentoParaRegra, 'byProduct'>): boolean {
  return (c.byProduct ?? []).some(p => p?.regraImposto === REGRA_IMPOSTO_NOVA)
}

/** Ids das vendas que entraram em fechamento calculado pela regra antiga (sem carimbo). */
export function idsDaRegraAntiga(closings: FechamentoParaRegra[]): Set<string> {
  const ids = new Set<string>()
  for (const c of closings) {
    if (fechamentoEhDaRegraNova(c)) continue
    for (const b of c.compradores ?? []) if (b?.id) ids.add(b.id)
  }
  return ids
}

export function aliquotaNoFechamento(venda: Pick<Sale, 'id' | 'preco_base'>, idsAntigos: ReadonlySet<string>): number {
  return idsAntigos.has(venda.id) ? getAliquotaRegraAntiga(venda.preco_base) : aliquotaRegraNova(venda.preco_base)
}

/** `data_hora` ja vem em BRT (lib/datas-da-plataforma.ts normTs): o dia e o texto. */
export function aliquotaNoDre(venda: Pick<Sale, 'data_hora' | 'preco_base'>): number {
  return String(venda.data_hora).slice(0, 10) >= INICIO_REGRA_NOVA_DRE
    ? aliquotaRegraNova(venda.preco_base)
    : getAliquotaRegraAntiga(venda.preco_base)
}

/**
 * Aliquota mostrada numa linha de produto: a das vendas, se todas (com base > 0)
 * tiveram a mesma; senao a efetiva (imposto / base) com duas casas; 0 sem base.
 */
export function aliquotaDaLinha(itens: { base: number; aliquota: number }[]): { aliquota: number; efetiva: boolean } {
  const comBase = itens.filter(i => i.base > 0)
  if (comBase.length === 0) return { aliquota: 0, efetiva: false }
  const distintas = new Set(comBase.map(i => i.aliquota))
  if (distintas.size === 1) return { aliquota: comBase[0].aliquota, efetiva: false }
  const base = comBase.reduce((a, i) => a + i.base, 0)
  const imposto = comBase.reduce((a, i) => a + i.base * i.aliquota, 0)
  return { aliquota: Math.round((imposto / base) * 100) / 100, efetiva: true }
}

/** "3%", "3,8%", "8,71%"; efetiva sempre com duas casas ("10,10%"). */
export function formatAliquota(aliquota: number, efetiva = false): string {
  return `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: efetiva ? 2 : 0, maximumFractionDigits: 2 }).format(aliquota)}%`
}
