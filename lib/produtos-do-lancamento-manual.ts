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
  terapeutaPadrao: 'pedro' | 'denise' | 'leomir' | null
  /** O que aparece na lista da tela. */
  rotulo: string
}

export const PRODUTOS_DO_LANCAMENTO_MANUAL: ProdutoDoLancamento[] = [
  { nome: 'Mentoria Particular - Pedro Roncada', pergunta: 'quantidade', terapeutaPadrao: 'pedro', rotulo: 'Mentoria Particular - Pedro' },
  { nome: 'Mentoria Particular - Denise Nascimento', pergunta: 'quantidade', terapeutaPadrao: 'denise', rotulo: 'Mentoria Particular - Denise' },
  // O Leomir entrou em 02/10/2026, depois desta lista. Mesmo nome que a tela dele
  // ja sugeria: "Pedro | Leomir" e lido como venda dos dois terapeutas.
  { nome: 'Mentoria Particular - Leomir Santos', pergunta: 'quantidade', terapeutaPadrao: 'leomir', rotulo: 'Mentoria Particular - Leomir' },
  // O Diagnostico pergunta o FORMATO, nao a quantidade: a quantidade e a
  // divisao entre os dois terapeutas saem dele.
  { nome: 'Diagnóstico Guiado: Programa de acompanhamento Individual', pergunta: 'formato', terapeutaPadrao: null, rotulo: 'Diagnóstico Guiado - Pedro e Denise' },
  { nome: 'Diagnóstico Guiado: Programa de acompanhamento Individual - Leomir', pergunta: 'formato', terapeutaPadrao: null, rotulo: 'Diagnóstico Guiado - Pedro e Leomir' },
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

/** Quem continua depois do Pedro. Mesma regra de lib/terapeuta-do-diagnostico.ts: sem nome no produto, Denise. */
function continuidade(produto: string): string {
  return produto.toLowerCase().includes('leomir') ? 'Leomir' : 'Denise'
}

/** O texto que a tela mostra ao escolher o formato. `null` quando nao e Diagnostico ou falta o formato. */
export function distribuicaoNaTela(produto: string | null | undefined, formato: 1 | 2 | 3 | null | undefined): string | null {
  if (!formato || !ehDiagnosticoNoLancamento(produto)) return null
  const d = divisaoDoDiagnostico(formato)
  return `${d.totalSessoes} sessões: ${d.sessoesPedro} com Pedro e ${d.sessoesDenise} com ${continuidade(produto as string)}`
}

/** O produto ja vem escolhido pela tela do terapeuta. Vazio obriga a escolher. */
export function produtoPadraoDoTerapeuta(nomeTerapeuta: string | null | undefined): string {
  const alvo = chaveDoTerapeuta(nomeTerapeuta)
  return PRODUTOS_DO_LANCAMENTO_MANUAL.find(p => alvo && p.terapeutaPadrao === alvo)?.nome ?? ''
}

function chaveDoTerapeuta(nome: string | null | undefined): 'pedro' | 'denise' | 'leomir' | null {
  const n = (nome ?? '').toLowerCase()
  return n.includes('pedro') ? 'pedro' : n.includes('denise') ? 'denise' : n.includes('leomir') ? 'leomir' : null
}

/**
 * O que a lista mostra na tela de um terapeuta. As sessoes da Mentoria vao para
 * o terapeuta da tela, entao oferecer a de outro criaria sessao e comissao na
 * pessoa errada. O Diagnostico aparece em todas: quem divide e o agendamento.
 */
export function produtosDaTela(nomeTerapeuta: string | null | undefined): ProdutoDoLancamento[] {
  const chave = chaveDoTerapeuta(nomeTerapeuta)
  return PRODUTOS_DO_LANCAMENTO_MANUAL.filter(p => p.pergunta === 'formato' || p.terapeutaPadrao === chave)
}

export type PedidoPreparado =
  | { ok: true; total_sessoes: number; oferta_nome: string }
  | { ok: false; erro: string }

/**
 * Valida o pedido no servidor e decide quantidade e oferta. O que veio da tela
 * nesses dois campos e ignorado no Diagnostico.
 *
 * A oferta gravada e o que faz o resto do sistema entender a venda depois:
 * `formatoDaVenda` le "Formato N" e `sessoesDoNomeDaOferta` le "9 sessoes". Sem
 * ela, o agendamento deduzia pelo preco e caia em 1 sessao (caso Maisa).
 *
 * Diagnostico nao aceita data nem sessao entregue: criarLancamentoManual cria
 * tudo em UM terapeuta, e quem divide entre Pedro e o outro e o agendamento.
 */
export function prepararPedido(p: {
  produto?: string | null
  formato_diagnostico?: 1 | 2 | 3 | null
  total_sessoes?: number | null
  sessoes_entregues?: number | null
  proxima_sessao_data?: string | null
  /** Quando vem, a Mentoria precisa ser deste terapeuta. */
  terapeuta_nome?: string | null
}): PedidoPreparado {
  if (ehDiagnosticoNoLancamento(p.produto)) {
    const f = p.formato_diagnostico
    if (f !== 1 && f !== 2 && f !== 3) return { ok: false, erro: 'Escolha o formato do Diagnóstico Guiado (1, 2 ou 3).' }
    if (p.proxima_sessao_data || (p.sessoes_entregues ?? 0) > 0) {
      return { ok: false, erro: 'No Diagnóstico Guiado as datas são escolhidas no agendamento, depois da aprovação. Deixe a próxima sessão e as entregues em branco.' }
    }
    return { ok: true, total_sessoes: SESSOES_POR_FORMATO_PUBLICO[f].totalSessoes, oferta_nome: `Formato ${f}` }
  }
  const dono = produtoDoLancamento(p.produto)?.terapeutaPadrao
  if (p.terapeuta_nome && dono && dono !== chaveDoTerapeuta(p.terapeuta_nome)) {
    return { ok: false, erro: 'Esta Mentoria é de outro terapeuta. Lance pela tela dele.' }
  }
  const t = totalDeSessoes({ produto: p.produto, quantidade: p.total_sessoes })
  if (t.total === null) return { ok: false, erro: t.erro ?? 'Pedido inválido.' }
  return { ok: true, total_sessoes: t.total, oferta_nome: `${t.total} ${t.total === 1 ? 'sessão' : 'sessões'}` }
}
