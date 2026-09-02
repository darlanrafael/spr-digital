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
  //
  // Alerta com `solicitacaoId` é reembolso PARCIAL (ver
  // lib/alertas-reembolso-parcial.ts) e fica de fora: ele também carrega o
  // saleId, então contá-lo aqui faria uma devolução parcial já abatida
  // esconder o estorno INTEGRAL da mesma venda, que é outro dinheiro e
  // precisa ser deduzido por conta própria.
  const jaDeduzidos = new Set<string>()
  // Quanto de reembolso PARCIAL já foi abatido de cada venda. Quando a venda
  // inteira é estornada depois, só o que RESTA precisa voltar: o cliente já
  // recebeu a parte parcial e os sócios já pagaram por ela. Sem isto a mesma
  // venda era deduzida duas vezes - no caso do Miguel, R$ 1.560 + R$ 2.758,70
  // = R$ 4.318,70 sobre uma venda que gerou R$ 2.758,70.
  const parcialJaAbatido = new Map<string, number>()
  for (const c of closings) {
    for (const a of c.alertas ?? []) {
      if (!a.saleId) continue
      if (a.solicitacaoId) {
        parcialJaAbatido.set(a.saleId, (parcialJaAbatido.get(a.saleId) ?? 0) + a.valor)
      } else {
        jaDeduzidos.add(a.saleId)
      }
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

    // O que resta devolver, já sem o parcial abatido antes. Se o parcial cobriu
    // tudo, não sobra dedução: cobrar de novo tiraria dos sócios dinheiro que
    // nunca saiu.
    const valor = s.valor_liquido - (parcialJaAbatido.get(s.id) ?? 0)
    if (!(valor > 0)) continue

    achados.push({
      saleId: s.id,
      nome: s.nome,
      telefone: s.telefone || undefined,
      email: s.email || undefined,
      produto: s.produto,
      valor,
      tipo: s.status === 'chargeback' ? 'chargeback' : 'reembolso',
      data: s.data_reembolso ?? s.data_hora.slice(0, 10),
    })
  }

  return achados.sort((a, b) => b.valor - a.valor)
}
