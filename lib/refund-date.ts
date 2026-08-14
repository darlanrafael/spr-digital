// Determina a data de um reembolso a partir do que a plataforma informou,
// e não do momento em que o nosso servidor processou o webhook.
//
// Motivo (13/08/2026): os handlers gravavam `new Date().toISOString().split('T')[0]`,
// que erra de dois jeitos. (1) É a data de processamento: um webhook reenviado
// horas depois, ou um reprocessamento de eventos antigos, carimbava tudo com "hoje".
// (2) É UTC, três horas à frente de Brasília — todo estorno feito entre 21h e 23h59
// já era o dia seguinte em UTC e entrava com um dia a mais. Um estorno em 31/07 às
// 22h virava 01/08 e mudava de mês, deslocando dois fechamentos.
//
// As duas plataformas mandam o dado certo, em formatos diferentes:
//   Hubla  → invoice.statusAt: [{ when: ISO-UTC, status: 'refunded' }, …]
//   Kiwify → refunded_at: "2026-08-13 17:41" (já em horário de Brasília)

const BRT_OFFSET_MS = 3 * 60 * 60 * 1000

/** Converte um instante UTC para a data-calendário correspondente em Brasília. */
export function toBrtDate(instant: Date): string {
  return new Date(instant.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 10)
}

export function hublaRefundDate(invoice: Record<string, unknown>, now: Date): string {
  const statusAt = invoice?.statusAt as { when?: string; status?: string }[] | undefined

  if (Array.isArray(statusAt)) {
    const refunds = statusAt.filter(s => s?.status === 'refunded' && !!s?.when)
    if (refunds.length > 0) {
      // A ordem do array não é garantida pelo contrato; vale o estorno mais recente.
      const latest = refunds.reduce((a, b) =>
        new Date(b.when as string) > new Date(a.when as string) ? b : a,
      )
      return toBrtDate(new Date(latest.when as string))
    }
  }

  return toBrtDate(now)
}

export function kiwifyRefundDate(payload: Record<string, unknown>, now: Date): string {
  const refundedAt = payload?.refunded_at

  if (typeof refundedAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(refundedAt.trim())) {
    // Já vem em horário de Brasília — converter de novo deslocaria o dia.
    return refundedAt.trim().slice(0, 10)
  }

  return toBrtDate(now)
}
