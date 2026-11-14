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
  if (o.corpo.erro || o.corpo.error || o.corpo.incompleto) return false
  // Precisa trazer o que a tela usa: total numerico e lista de campanhas.
  const c = o.corpo as { total?: unknown; campanhas?: unknown }
  return typeof c.total === 'number' && Number.isFinite(c.total) && Array.isArray(c.campanhas)
}

// Textos exatos aprovados pelo dono (10/11/2026).
export const ERRO_TRAFEGO_INCOMPLETO = 'A Meta não respondeu por completo. Clique em Buscar de novo antes de fechar.'
export const BLOQUEIO_FECHAMENTO_TRAFEGO = 'O custo de tráfego não veio completo da Meta. Busque de novo antes de confirmar o fechamento.'
export const AVISO_DRE_META_INCOMPLETA = 'A Meta não respondeu por completo. O valor de Meta Ads pode estar menor do que o real. Atualize a página.'

/**
 * Numera as buscas de trafego do Fechamento: so a resposta da busca VIGENTE e
 * aplicada. iniciar() abre uma busca nova (supera as anteriores); invalidar()
 * descarta a que estiver em andamento (ex.: tirou o ultimo termo).
 */
export function criarSequenciaDeBusca() {
  let atual = 0
  return {
    iniciar: () => ++atual,
    invalidar: () => { atual++ },
    vigente: (n: number) => n === atual,
  }
}

/** Texto do erro da busca de trafego: falha das contas da Meta usa o texto aprovado; outro motivo (sessao, token) aparece como veio. */
export function mensagemDoErroDoTrafego(corpo: unknown): string {
  if (!corpo || typeof corpo !== 'object') return ERRO_TRAFEGO_INCOMPLETO
  const { erro, error } = corpo as { erro?: unknown; error?: unknown }
  if (erro === ERRO_TRAFEGO_INCOMPLETO) return ERRO_TRAFEGO_INCOMPLETO
  if (typeof error === 'string' && error.trim()) return error
  if (typeof erro === 'string' && erro.trim()) return erro
  return ERRO_TRAFEGO_INCOMPLETO
}

/**
 * Estado do trafego depois de qualquer mudanca na busca (tirar ou adicionar
 * termo, mudar data): custo zerado e nenhuma busca valida, ate clicar em Buscar.
 * Quem chama tambem invalida a busca em andamento (revisao final 13/11).
 */
export function semBuscaDeTrafego<T extends object>(t: T): T & {
  total: number; campanhas: never[]; erro: null; loading: false; buscaCompleta: null
} {
  return { ...t, total: 0, campanhas: [], erro: null, loading: false, buscaCompleta: null }
}
