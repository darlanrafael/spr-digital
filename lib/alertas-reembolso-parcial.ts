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
// devolvemos a diferença: R$ 1.560. Deduzir sobre o líquido devolveria menos
// do que voltou de verdade para o cliente.
//
// QUEM ABSORVE (mesma conversa): não sai do caixa da empresa. O valor é
// descontado do PRÓXIMO REPASSE aos sócios, na proporção do fechamento - com
// 35/65, a SPR absorve R$ 546 e o Pedro R$ 1.014. Isso já é o comportamento
// da tela de fechamento para qualquer alerta (`deducoes` e `repasse_final` em
// app/fechamentos/page.tsx), e é justamente por isso que o parcial entra
// nesta lista em vez de virar um custo à parte: o rateio vem de graça.

export type SolicitacaoReembolso = {
  id: string
  sale_id: string
  sessoes_ids?: string[] | null
  paciente_nome: string
  paciente_email?: string | null
  valor_reembolso: number
  status: string
  updated_at?: string | null
  created_at: string
}

export type VendaDoAlerta = { produto: string; status: string }

export function calcularAlertasReembolsoParcial({
  solicitacoes,
  closings,
  vendaPorSaleId,
}: {
  solicitacoes: SolicitacaoReembolso[]
  closings: Closing[]
  vendaPorSaleId: Map<string, VendaDoAlerta>
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
  // Sessões que uma solicitação já aprovada desta rodada reivindicou. Duas
  // aprovações que cobrem a MESMA sessão são o mesmo dinheiro: o banco já tem
  // um par assim (solicitações 57bbdc78 e ae08b8ac, mesma venda, mesma sessão,
  // R$ 700 cada), salvo até hoje só porque as duas foram rejeitadas.
  const sessoesReivindicadas = new Map<string, Set<string>>()

  const aprovadas = solicitacoes
    .filter(s => s.status === 'aprovado')
    // Ordem estável para a dedup: vale a primeira aprovada, e o resultado não
    // depende da ordem em que o banco devolveu as linhas.
    .slice()
    .sort((a, b) => (a.updated_at ?? a.created_at).localeCompare(b.updated_at ?? b.created_at))

  for (const s of aprovadas) {
    if (jaDeduzidas.has(s.id)) continue
    // Valor não positivo não é dedução: entraria como crédito e inflaria o
    // repasse dos sócios em vez de reduzi-lo.
    if (!(s.valor_reembolso > 0)) continue

    const venda = vendaPorSaleId.get(s.sale_id)
    // Venda que não conta mais faturamento não pode gerar dedução. Quando ela
    // vira 'reembolsada'/'chargeback', o filtro do fechamento tira a receita
    // inteira e quem trata a devolução é lib/alertas-reembolso.ts, já
    // descontando o parcial que tenha sido abatido antes. Deduzir aqui também
    // cobraria dos sócios duas vezes pelo mesmo dinheiro - ou, se a venda
    // nunca entrou em fechamento nenhum, cobraria por dinheiro que eles jamais
    // receberam.
    if (venda && venda.status !== 'aprovada') continue

    const jaVistas = sessoesReivindicadas.get(s.sale_id) ?? new Set<string>()
    const ids = s.sessoes_ids ?? []
    if (ids.length > 0 && ids.some(id => jaVistas.has(id))) continue
    for (const id of ids) jaVistas.add(id)
    sessoesReivindicadas.set(s.sale_id, jaVistas)

    achados.push({
      solicitacaoId: s.id,
      saleId: s.sale_id,
      nome: s.paciente_nome,
      email: s.paciente_email ?? undefined,
      produto: venda?.produto ?? 'Reembolso parcial',
      valor: s.valor_reembolso,
      tipo: 'reembolso_parcial',
      // A data que importa é a da APROVAÇÃO, que é quando o dinheiro sai, e
      // não a da abertura do pedido: entre uma e outra pode passar semana.
      // Em BRT: `updated_at` é timestamptz UTC, e cortar a string direto
      // jogaria uma aprovação das 21h30 para o dia seguinte.
      data: paraDataBrt(s.updated_at ?? s.created_at),
    })
  }

  return achados.sort((a, b) => b.valor - a.valor)
}

const BRT_OFFSET_MS = 3 * 60 * 60 * 1000

function paraDataBrt(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts.slice(0, 10)
  return new Date(d.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 10)
}

// Chave de identidade de um alerta, para marcar "abater aqui" e para não
// deduzir duas vezes. Reembolso parcial se identifica pela solicitação; estorno
// de venda inteira, pela venda.
export function chaveAlerta(a: ClosingAlert): string | undefined {
  return a.solicitacaoId ?? a.saleId
}
