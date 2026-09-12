import type { Closing, Sale } from '@/types'

// Uma venda que já entrou num fechamento confirmado nunca entra em outro.
//
// Custos ganharam `fechamento_id` em 16-17/07/2026 e somem do pool depois de
// pagos. Vendas nunca tiveram equivalente: a única barreira contra contar a
// mesma receita duas vezes era o usuário acertar as datas na mão.
//
// Só que acertar a data é impossível sem perder venda. Um fechamento é
// confirmado num INSTANTE — 06/07 às 21:36, por exemplo — e leva o que existia
// até ali. As vendas do resto daquele dia ficam órfãs: pertencem a um período
// já fechado mas não entraram nele. Começar o próximo em 07/07 as perde;
// começar em 06/07 repete tudo que veio antes das 21:36. Em 13/08/2026 as duas
// coisas aconteceram: 11 vendas órfãs de 06/07 (R$ 1.899,00) e duas repetidas
// (Antônio Belone R$ 747 e Marcos Gilvane R$ 697).
//
// A data deixa de importar quando o corte é por VENDA: o período pode sobrepor
// à vontade, que cada venda é contada uma vez só. Uma venda já foi fechada
// quando o produto dela estava no fechamento, a data cai na janela efetiva
// daquele produto (respeitando `produtos_periodos`) e ela já existia no
// instante da confirmação.

export type VendaJaFechada = Sale & { fechamentoId: string }

const dia = (iso: string) => String(iso).slice(0, 10)

/**
 * O INSTANTE da venda, em milissegundos.
 *
 * `Sale.data_hora` sai de `normTs` (lib/services.ts) e e sempre hora de
 * BRASILIA sem fuso escrito: `2026-08-14T14:42:44`. Na Hubla o UTC ja foi
 * convertido subtraindo 3h; na Kiwify o valor ja vinha em BRT e so teve o
 * sufixo cortado. Nos dois casos o texto e BRT, entao o fuso e -03:00.
 *
 * Sem isto a comparacao com `data_confirmacao` - que vem do banco em UTC, com
 * fracao de segundo e `+00:00` - era feita como TEXTO entre bases diferentes, e
 * errava por TRES HORAS.
 *
 * Achado pelo pre-voo em 12/09/2026 e medido: 11 vendas, R$ 3.181,85 marcadas
 * como "ja fechadas" tendo vindo DEPOIS do fechamento, sem estar em
 * `compradores` de nenhum - receita presa, que nunca seria contada. A maior e a
 * do Marcio Adriano Silva, R$ 2.827,65, feita 3h depois do fechamento de 14/08.
 */
const instanteBRT = (data_hora: string): number | null => {
  if (!data_hora) return null
  // Se ja vier com fuso (dado antigo ou de outra origem), respeita o que veio.
  const comFuso = /[+-]\d{2}:\d{2}$|Z$/.test(data_hora) ? data_hora : `${data_hora}-03:00`
  const t = new Date(comFuso).getTime()
  return Number.isNaN(t) ? null : t
}

export function fechamentoQueContou(venda: Sale, closings: Closing[]): Closing | null {
  for (const c of closings) {
    if (!c.data_confirmacao) continue
    if (!(c.produtos_incluidos ?? []).includes(venda.produto)) continue

    const grupo = (c.produtos_periodos ?? []).find(g => g.produtos.includes(venda.produto))
    const janela = grupo ?? c.periodo
    if (!janela.inicio || !janela.fim) continue

    const d = dia(venda.data_hora)
    if (d < janela.inicio || d > janela.fim) continue

    // O corte é o INSTANTE da confirmação, não o dia: é isso que separa a venda
    // que entrou no fechamento anterior da que veio depois dele, no mesmo dia.
    //
    // Comparado por ÉPOCA. Como texto, `2026-08-14T14:42:44` (BRT) contra
    // `2026-08-14T14:46:08.403+00:00` (UTC) errava por 3 horas — ver
    // `instanteBRT` acima.
    const tVenda = instanteBRT(venda.data_hora)
    const tFechamento = new Date(String(c.data_confirmacao)).getTime()
    if (tVenda === null || Number.isNaN(tFechamento)) continue
    if (tVenda >= tFechamento) continue

    return c
  }
  return null
}

export function separarJaFechadas(
  vendas: Sale[],
  closings: Closing[],
): { novas: Sale[]; jaFechadas: VendaJaFechada[] } {
  const novas: Sale[] = []
  const jaFechadas: VendaJaFechada[] = []

  for (const v of vendas) {
    const c = fechamentoQueContou(v, closings)
    if (c) jaFechadas.push({ ...v, fechamentoId: c.id })
    else novas.push(v)
  }

  return { novas, jaFechadas }
}
