import type { Closing, ClosingAlert, Sale } from '@/types'

// Levanta os reembolsos e chargebacks de vendas que JÁ FORAM REPASSADAS aos
// sócios num fechamento confirmado, e portanto precisam ser devolvidos no
// fechamento seguinte.
//
// Regra de negócio (seção 12): o cliente tem 7 dias de garantia por lei. Todo
// fechamento entra, por construção, com vendas ainda dentro desse prazo, e os
// sócios já retiram sobre elas. Quando uma delas é estornada depois, o dinheiro
// já saiu.
//
// O sinal de "foi repassada" é a lista `compradores` do fechamento: ela guarda
// o id exato de cada venda que somou faturamento ali. É autoritativo e dispensa
// qualquer reconstrução de janela ou de status passado.
//
// A primeira versão (13/08) tentava reconstruir isso a partir do período do
// fechamento, da janela do produto e da comparação entre `data_reembolso` e a
// data de confirmação. Funcionava para reembolso, mas errava em venda
// CANCELADA: cancelamento não tem `data_reembolso`, então a regra assumia que
// a mudança fora posterior ao fechamento e acusava vendas que jamais tinham
// entrado nele. Apareceu em 14/08 com as duas vendas fantasma canceladas na
// véspera (Maria de Fátima e Daiani), que somavam R$ 723,41 de dedução
// indevida no fechamento seguinte.
//
// Cancelamento continua fora de propósito: é correção de faturamento (a venda
// nunca existiu), não devolução ao cliente. O painel fala em "reembolso ou
// chargeback" e misturar cancelamento ali seria mentira. Venda cancelada que
// JÁ tenha sido repassada é um caso distinto, ainda sem tratamento — não
// ocorreu até 14/08 e está registrado na seção 0 do spr-digital.md.

const ESTORNOS: ReadonlySet<string> = new Set(['reembolsada', 'chargeback'])

export function calcularAlertasPendentes({
  closings,
  sales,
}: {
  closings: Closing[]
  sales: Sale[]
}): ClosingAlert[] {
  // Vendas cujo estorno já foi descontado em algum fechamento.
  const jaDeduzidos = new Set<string>()
  for (const c of closings) {
    for (const a of c.alertas ?? []) {
      if (a.saleId) jaDeduzidos.add(a.saleId)
    }
  }

  // Vendas que somaram faturamento em algum fechamento confirmado.
  const repassadas = new Set<string>()
  for (const c of closings) {
    for (const b of c.compradores ?? []) {
      if (b.id) repassadas.add(b.id)
    }
  }

  const achados: ClosingAlert[] = []

  for (const s of sales) {
    if (!ESTORNOS.has(s.status)) continue
    if (!repassadas.has(s.id)) continue
    if (jaDeduzidos.has(s.id)) continue

    achados.push({
      saleId: s.id,
      nome: s.nome,
      telefone: s.telefone || undefined,
      email: s.email || undefined,
      produto: s.produto,
      valor: s.valor_liquido,
      tipo: s.status === 'chargeback' ? 'chargeback' : 'reembolso',
      data: s.data_reembolso ?? s.data_hora.slice(0, 10),
    })
  }

  return achados.sort((a, b) => b.valor - a.valor)
}
