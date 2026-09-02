import type { Closing, ClosingAlert } from '@/types'

// Reembolso PARCIAL aprovado pelo CEO: o cliente comprou um pacote, usou parte
// e devolveu o resto. Por decisão do usuário (02/09/2026) a venda original NÃO
// é alterada - ela continua valendo o que valeu, com o status e o valor que a
// plataforma registrou. O que entra no fechamento seguinte é uma DEDUÇÃO, do
// mesmo jeito que já acontece com estorno de venda que foi repassada aos
// sócios (ver lib/alertas-reembolso.ts).
//
// Por que dedução e não correção da venda: mexer no `valor_liquido` faria o
// faturamento histórico mudar de valor depois de fechado, e os fechamentos já
// confirmados passariam a não bater com o que foi realmente repassado. A
// dedução preserva o histórico e mostra o dinheiro saindo no momento em que
// saiu de verdade.
//
// REGRA DO VALOR (usuário, 02/09/2026): o abatimento é sempre sobre o VALOR
// PAGO pelo cliente, nunca sobre o líquido depois das taxas. O cliente pagou
// R$ 2.860, fez 1 sessão, descontamos os R$ 1.300 do plano de 1 sessão e
// devolvemos a diferença: R$ 1.560. É esse número que sai do caixa, e é ele
// que entra aqui como dedução - a taxa que a plataforma reteve na venda
// original não é redistribuída no estorno parcial, então não entra na conta.
// Deduzir sobre o líquido devolveria menos do que saiu de verdade.

export type SolicitacaoReembolso = {
  id: string
  sale_id: string
  paciente_nome: string
  paciente_email?: string | null
  valor_reembolso: number
  status: string
  updated_at?: string | null
  created_at: string
}

export function calcularAlertasReembolsoParcial({
  solicitacoes,
  closings,
  produtoPorSaleId,
}: {
  solicitacoes: SolicitacaoReembolso[]
  closings: Closing[]
  produtoPorSaleId: Map<string, string>
}): ClosingAlert[] {
  // Deduzido é o que já foi marcado em algum fechamento confirmado. A chave é
  // o id da SOLICITAÇÃO: usar o saleId faria um reembolso parcial já abatido
  // esconder um estorno total posterior da mesma venda.
  const jaDeduzidas = new Set<string>()
  for (const c of closings) {
    for (const a of c.alertas ?? []) {
      if (a.solicitacaoId) jaDeduzidas.add(a.solicitacaoId)
    }
  }

  const achados: ClosingAlert[] = []

  for (const s of solicitacoes) {
    if (s.status !== 'aprovado') continue
    if (jaDeduzidas.has(s.id)) continue
    // Valor não positivo não é dedução: entraria como crédito e inflaria o
    // repasse dos sócios em vez de reduzi-lo.
    if (!(s.valor_reembolso > 0)) continue

    achados.push({
      solicitacaoId: s.id,
      saleId: s.sale_id,
      nome: s.paciente_nome,
      email: s.paciente_email ?? undefined,
      produto: produtoPorSaleId.get(s.sale_id) ?? 'Reembolso parcial',
      valor: s.valor_reembolso,
      tipo: 'reembolso_parcial',
      // A data que importa é a da APROVAÇÃO, que é quando o dinheiro sai, e
      // não a da abertura do pedido: entre uma e outra pode passar semana.
      data: (s.updated_at ?? s.created_at).slice(0, 10),
    })
  }

  return achados.sort((a, b) => b.valor - a.valor)
}

// Chave de identidade de um alerta, para marcar "abater aqui" e para não
// deduzir duas vezes. Reembolso parcial se identifica pela solicitação; estorno
// de venda inteira, pela venda.
export function chaveAlerta(a: ClosingAlert): string | undefined {
  return a.solicitacaoId ?? a.saleId
}
