// Trava do custo de trafego no Fechamento (dono 10/11/2026, Task 6 do plano
// docs/superpowers/plans/2026-11-10-botao-resgate-funis.md). Se uma conta da
// Meta falha, a soma vem menor sem erro; o valor gravado no fechamento baixa o
// custo e sobe o lucro e o repasse. Segunda protecao alem da conferencia do dono.

type Busca = { termos: string[]; inicio: string; fim: string }

const mesmaLista = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false
  const x = [...a].sort(), y = [...b].sort()
  return x.every((t, i) => t === y[i])
}

/**
 * O custo de trafego da tela pode ir para o fechamento? Nesta ordem: buscando ->
 * nao; sem termos -> so com total 0; senao, so sem erro e com uma busca completa
 * feita com os mesmos termos (ordem indiferente) e as mesmas datas da tela.
 */
export function podeConfirmarTrafego(o: {
  termos: string[]
  periodo: { inicio: string; fim: string }
  loading: boolean
  erro: string | null
  total: number
  buscaCompleta: Busca | null
}): boolean {
  if (o.loading) return false
  if (o.termos.length === 0) return o.total === 0
  if (o.erro || !o.buscaCompleta) return false
  const b = o.buscaCompleta
  return mesmaLista(o.termos, b.termos) && b.inicio === o.periodo.inicio && b.fim === o.periodo.fim
}

/** A resposta das rotas /api/meta/* veio completa? */
export function respostaMetaCompleta(o: {
  ok: boolean
  corpo: { erro?: string; error?: string; incompleto?: boolean } | null
}): boolean {
  if (!o.ok || !o.corpo) return false
  return !o.corpo.erro && !o.corpo.error && !o.corpo.incompleto
}
