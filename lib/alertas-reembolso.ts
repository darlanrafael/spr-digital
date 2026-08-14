import type { Closing, ClosingAlert, Sale } from '@/types'

// Levanta os reembolsos e chargebacks de vendas que JÁ ENTRARAM num fechamento
// confirmado — ou seja, dinheiro que já foi repassado aos sócios e precisa ser
// devolvido no fechamento seguinte.
//
// Existe porque a mecânica estava pela metade (descoberto em 13/08/2026): a tela
// do Step 4 já tinha a tabela de alertas, o total em vermelho e a dedução rateada
// por sócio, mas `handleConfirm` gravava `alertas: []` fixo. Nada nunca calculava
// a lista, então a ausência de alerta não significava "não houve reembolso", e sim
// "ninguém olhou". Quatro vendas de fechamentos anteriores tinham sido estornadas
// sem nenhuma dedução — R$ 1.394,59 líquidos.
//
// Uma venda entra na lista quando:
//   1. o produto estava no fechamento;
//   2. a data dela cai na janela daquele produto (respeitando produtos_periodos);
//   3. ela já existia quando o fechamento foi confirmado;
//   4. hoje não está mais aprovada;
//   5. o estorno é posterior à confirmação (se fosse anterior, a venda nunca
//      teria entrado no faturamento — o fechamento só soma `aprovada`);
//   6. ela ainda não foi deduzida num fechamento anterior.
//
// O valor usado é o LÍQUIDO: é o que de fato volta pra plataforma quando o
// cliente é reembolsado, e portanto o que a empresa deixa de ter em caixa.

const dia = (iso: string) => String(iso).slice(0, 10)

/** Data-calendário em Brasília do instante de confirmação (gravado em UTC). */
function diaBRT(instanteISO: string): string {
  const t = Date.parse(instanteISO)
  if (Number.isNaN(t)) return dia(instanteISO)
  return new Date(t - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export function calcularAlertasPendentes({
  closings,
  sales,
}: {
  closings: Closing[]
  sales: Sale[]
}): ClosingAlert[] {
  const jaDeduzidos = new Set<string>()
  for (const c of closings) {
    for (const a of c.alertas ?? []) {
      if (a.saleId) jaDeduzidos.add(a.saleId)
    }
  }

  const achados = new Map<string, ClosingAlert>()

  for (const c of closings) {
    if (!c.data_confirmacao) continue
    const confirmacao = c.data_confirmacao
    const confirmacaoDia = diaBRT(confirmacao)
    const incluidos = c.produtos_incluidos ?? []

    for (const s of sales) {
      if (s.status === 'aprovada') continue
      if (jaDeduzidos.has(s.id) || achados.has(s.id)) continue
      if (!incluidos.includes(s.produto)) continue

      // Janela própria do produto quando existir, senão o período principal.
      const grupo = (c.produtos_periodos ?? []).find(g => g.produtos.includes(s.produto))
      const janela = grupo ?? c.periodo
      const d = dia(s.data_hora)
      if (!janela.inicio || !janela.fim || d < janela.inicio || d > janela.fim) continue

      // Não existia ainda quando o fechamento foi confirmado.
      if (s.data_hora >= confirmacao) continue

      // Estorno anterior à confirmação: a venda já não era `aprovada` naquele
      // momento, então nunca somou faturamento — não há o que devolver.
      if (s.data_reembolso && s.data_reembolso <= confirmacaoDia) continue

      achados.set(s.id, {
        saleId: s.id,
        nome: s.nome,
        telefone: s.telefone || undefined,
        email: s.email || undefined,
        produto: s.produto,
        valor: s.valor_liquido,
        tipo: s.status === 'chargeback' ? 'chargeback' : 'reembolso',
        data: s.data_reembolso ?? dia(s.data_hora),
      })
    }
  }

  return [...achados.values()].sort((a, b) => b.valor - a.valor)
}
