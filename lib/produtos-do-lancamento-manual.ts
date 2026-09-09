// Os produtos que o lancamento manual oferece, e o que cada um pergunta.
//
// Ate 09/09/2026 o produto era um campo de texto livre. Duas consequencias:
//
//   1. o sistema nao sabia como distribuir as sessoes. No Diagnostico Guiado a
//      divisao entre Pedro e Denise depende do FORMATO, e digitar o nome do
//      produto a mao nao diz formato nenhum;
//   2. nasceram quatro grafias do mesmo produto na base ("Mentoria Particular -
//      Pedro Roncada", "Mentoria - Individual Pedro Roncada", "MENTORIA EM
//      GRUPO - PEDRO RONCADA", "Mentoria em grupo- Pedro Roncada"), e TUDO que
//      decide de quem e a venda depende do nome bater.
//
// Decisao do usuario: tres produtos, escolhidos numa lista. "assim voce sabe se
// for diagnostico como tem que distribuir as sessoes".
import { SESSOES_POR_FORMATO_PUBLICO } from './diagnostico-guiado'

export type ProdutoDoLancamento = {
  /** O valor gravado em `sales.produto`. Grafia unica, para o resto do sistema casar. */
  nome: string
  /** O que a tela pergunta depois de escolher. */
  pergunta: 'quantidade' | 'formato'
  /** Terapeuta sugerido, quando o produto nomeia um so. */
  terapeutaPadrao: 'pedro' | 'denise' | null
}

export const PRODUTOS_DO_LANCAMENTO_MANUAL: ProdutoDoLancamento[] = [
  { nome: 'Mentoria Particular - Pedro Roncada', pergunta: 'quantidade', terapeutaPadrao: 'pedro' },
  { nome: 'Mentoria Particular - Denise Nascimento', pergunta: 'quantidade', terapeutaPadrao: 'denise' },
  // O Diagnostico pergunta o FORMATO, nao a quantidade: a quantidade e a
  // divisao entre os dois terapeutas saem dele.
  { nome: 'Diagnóstico Guiado: Programa de acompanhamento Individual', pergunta: 'formato', terapeutaPadrao: null },
]

export function produtoDoLancamento(nome: string | null | undefined): ProdutoDoLancamento | null {
  if (!nome) return null
  const alvo = nome.trim().toLowerCase()
  return PRODUTOS_DO_LANCAMENTO_MANUAL.find(p => p.nome.trim().toLowerCase() === alvo) ?? null
}

/** O produto escolhido e o Diagnostico Guiado? */
export function ehDiagnosticoNoLancamento(nome: string | null | undefined): boolean {
  return produtoDoLancamento(nome)?.pergunta === 'formato'
}

/**
 * Quantas sessoes o pacote tem, a partir do que a tela perguntou.
 *
 * No Diagnostico, a quantidade NAO e escolha de quem lanca - ela vem do
 * formato, que e regra do produto. Mesma regra que vale no agendamento de
 * venda real.
 */
export function totalDeSessoes(params: {
  produto: string | null | undefined
  formato?: 1 | 2 | 3 | null
  quantidade?: number | null
}): { total: number | null; erro?: string } {
  const p = produtoDoLancamento(params.produto)
  if (!p) return { total: null, erro: 'Escolha um dos produtos da lista.' }

  if (p.pergunta === 'formato') {
    if (!params.formato) return { total: null, erro: 'Escolha o formato do Diagnóstico Guiado (1, 2 ou 3).' }
    return { total: SESSOES_POR_FORMATO_PUBLICO[params.formato].totalSessoes }
  }

  const q = params.quantidade ?? 0
  if (!Number.isInteger(q) || q < 1 || q > 60) {
    return { total: null, erro: 'Informe um número inteiro de sessões, de 1 a 60.' }
  }
  return { total: q }
}

/** Como as sessoes do Diagnostico se dividem: as primeiras com o Pedro, o resto com a Denise. */
export function divisaoDoDiagnostico(formato: 1 | 2 | 3): { totalSessoes: number; sessoesPedro: number; sessoesDenise: number } {
  const f = SESSOES_POR_FORMATO_PUBLICO[formato]
  return { totalSessoes: f.totalSessoes, sessoesPedro: f.sessoesPedro, sessoesDenise: f.totalSessoes - f.sessoesPedro }
}
