// As sessoes entregues desde o ultimo fechamento da terapeuta, incluindo as que
// JA foram pagas - com a etiqueta dizendo em qual fechamento.
//
// POR QUE EXISTE (pedido do usuario em 11/09/2026, depois de um dia inteiro de
// confusao com isto): a tela de pagamento mostra so o que esta PENDENTE. Sessao
// entregue que ja foi paga por antecipacao some da tela.
//
// O caso real: a Denise entregou 14 sessoes desde 14/08. A tela mostrava 10. O
// usuario conferiu com a lista dela, contou 13, e passou horas tentando
// entender a diferenca - porque as 4 pagas por antecipacao nao apareciam em
// lugar nenhum.
//
//   entregues desde o ultimo fechamento   14   R$ 1.321,35
//   a pagar agora                         10   R$   965,10
//   ja pagas                               4   R$   356,25
//
// A ETIQUETA DIZ O FECHAMENTO, NAO SO "ANTECIPADO". Duas razoes: e mais preciso
// (a sessao da Billimaicon de 17/08 foi paga pelo fechamento datado de 14/08,
// que e "antes da entrega" mas nao e antecipacao no sentido da tela), e diz
// onde procurar quando o numero nao bater.

export type SessaoEntregue = {
  id: string
  comissao_valor: number
  comissao_paga?: boolean | null
  data_entrega?: string | null
}

export type FechamentoComSnapshot = {
  id: string
  data_confirmacao: string
  sessoes?: { id?: string }[] | null
}

export type EntregueComEtiqueta<T> = {
  sessao: T
  /** ISO do fechamento que pagou esta sessao. Null quando ainda nao foi paga. */
  pagoEm: string | null
  /** Id do fechamento, para a tela poder ligar um no outro se quiser. */
  fechamentoId: string | null
}

export type ResumoEntregues<T> = {
  sessoes: EntregueComEtiqueta<T>[]
  /** A data de corte usada. Null quando nao ha fechamento anterior. */
  corte: string | null
  aPagar: number
  jaPago: number
  total: number
}

/**
 * O corte e a data de confirmacao do ULTIMO fechamento.
 *
 * Nao a maior `data_entrega` do snapshot: o fechamento pode ter pago sessao
 * entregue depois dele (foi o caso do de 14/08, que cobriu uma entrega de
 * 17/08), e usar a entrega como corte esconderia justamente essas.
 *
 * Sem fechamento anterior, nao ha corte: entram todas as entregues.
 */
/**
 * Milissegundos, ou null. Comparar timestamp como STRING e a armadilha desta
 * funcao: `data_confirmacao` vem com fracao de segundo
 * (`2026-08-14T18:00:18.948+00:00`) e `data_entrega` sem
 * (`2026-07-20T15:20:00+00:00`). No segundo exato em que coincidem, '+' (0x2B)
 * e menor que '.' (0x2E) e a sessao e excluida errado. E se um dia entrar
 * timestamp com outro fuso, a comparacao erra por horas - mesmo tipo de defeito
 * que o `slice(0, 10)` que este projeto ja teve.
 */
const ms = (iso?: string | null): number | null => {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? null : t
}

export function entreguesDesdeOFechamento<T extends SessaoEntregue>(params: {
  sessoes: T[]
  fechamentos: FechamentoComSnapshot[]
}): ResumoEntregues<T> {
  const ordenados = [...params.fechamentos]
    .filter(f => ms(f.data_confirmacao) !== null)
    .sort((a, b) => (ms(b.data_confirmacao) ?? 0) - (ms(a.data_confirmacao) ?? 0))
  const corte = ordenados[0]?.data_confirmacao ?? null
  const corteMs = ms(corte)

  // De qual fechamento veio cada sessao ja paga. Um mapa so, montado uma vez -
  // varrer os snapshots por sessao seria quadratico.
  const pagaEm = new Map<string, FechamentoComSnapshot>()
  for (const f of params.fechamentos) {
    for (const s of f.sessoes ?? []) if (s?.id) pagaEm.set(s.id, f)
  }

  const dentro = params.sessoes
    .filter(s => {
      const e = ms(s.data_entrega)
      if (e === null) return false
      return corteMs === null || e >= corteMs
    })
    .sort((a, b) => (ms(a.data_entrega) ?? 0) - (ms(b.data_entrega) ?? 0))

  let aPagar = 0
  let jaPago = 0
  const sessoes: EntregueComEtiqueta<T>[] = dentro.map(s => {
    const valor = Number(s.comissao_valor ?? 0)
    const f = pagaEm.get(s.id)
    // A marca autoritativa e `comissao_paga`, nao a presenca no snapshot: o
    // snapshot e historico e pode nao existir para pagamento feito por fora.
    if (s.comissao_paga) jaPago += valor
    else aPagar += valor
    return {
      sessao: s,
      pagoEm: s.comissao_paga ? (f?.data_confirmacao ?? null) : null,
      fechamentoId: s.comissao_paga ? (f?.id ?? null) : null,
    }
  })

  // O TOTAL sai da soma das PARTES ja arredondadas, nao do arredondamento da
  // soma crua. `cent(a) + cent(b)` pode diferir de `cent(a + b)` em um centavo,
  // e a tela mostra os tres numeros juntos - "Total entregue X, a pagar Y, ja
  // pago Z". Se Y + Z nao dao X, quem le perde a confianca nos tres.
  //
  // Achado pelo teste por propriedade em 12/09/2026, na rodada 11: R$ 32.963,60
  // contra R$ 32.963,61. Um centavo, mas do tipo que aparece na tela.
  const cent = (n: number) => Math.round(n * 100) / 100
  const aPagarCent = cent(aPagar)
  const jaPagoCent = cent(jaPago)
  return { sessoes, corte, aPagar: aPagarCent, jaPago: jaPagoCent, total: cent(aPagarCent + jaPagoCent) }
}
