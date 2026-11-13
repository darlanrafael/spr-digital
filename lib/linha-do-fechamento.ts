import type { Sale } from '@/types'
import { getAliquotaRegraAntiga, getImpostoBase } from './formatters'
import { aliquotaNoFechamento } from './aliquota-imposto'

// Imposto de uma venda no Fechamento (dono 13/11/2026). A empresa paga pela
// regra da venda (lib/aliquota-imposto.ts); o repasse do terapeuta nao muda e
// continua descontando a regra antiga.

export function impostoDaVendaNoFechamento(
  venda: Pick<Sale, 'id' | 'preco_base' | 'valor_com_juros' | 'valor_pago_cliente'>,
  idsAntigos: ReadonlySet<string>,
): { base: number; aliquota: number; imposto: number; impostoDoRepasse: number } {
  const base = getImpostoBase(venda)
  const aliquota = aliquotaNoFechamento(venda, idsAntigos)
  return {
    base,
    aliquota,
    imposto: base * aliquota / 100,
    impostoDoRepasse: base * getAliquotaRegraAntiga(venda.preco_base) / 100,
  }
}

/** Os numeros do Fechamento so valem com a lista da regra antiga carregada, e sem confirmacao em andamento. */
export function fechamentoLiberado(o: { estadoRegra: 'carregando' | 'pronto' | 'erro'; confirmando: boolean }): boolean {
  return o.estadoRegra === 'pronto' && !o.confirmando
}

export function mesmaLista(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const x of a) if (!b.has(x)) return false
  return true
}
