import { sessoesDoNomeDaOferta } from './sessoes-da-oferta'
import { normalizar } from './busca-de-produto'

// Mentorias Particulares cujo repasse e R$ X por SESSAO entregue, e NAO o % de
// comissao do terapeuta.
//
// DECISAO DO DONO (21/10/2026): a "Mentoria Particular - Pedro | Leomir" paga o
// Leomir R$ 90 por sessao (igual o diagnostico dele), no lugar dos 10% de
// comissao. So o Leomir por enquanto - a da Denise segue no %. O Leomir entrega
// TODAS as sessoes do produto (sem split com o Pedro, ao contrario do
// diagnostico), e a quantidade vem do nome da oferta ("Formato 2 - 2 Sessoes").
//
// Lista escrita a mao, como a de readequacoes e a de ofertas do diagnostico:
// mudanca de repasse e rara, manual e auditada. Adicionar um produto aqui e uma
// conversa + deploy, de proposito.
export const MENTORIA_POR_SESSAO: { produto: string; terapeuta: string; valorPorSessao: number }[] = [
  { produto: 'Mentoria Particular - Pedro | Leomir', terapeuta: 'Leomir Santos', valorPorSessao: 90 },
]

export type VendaMentoria = { nome?: string; oferta_nome?: string | null }

export type RepasseMentoria = {
  terapeuta: string
  valorPorSessao: number
  /** Total de sessoes lidas das ofertas (as que deram pra ler). */
  sessoes: number
  /** sessoes * valorPorSessao. */
  valor: number
  /**
   * Vendas cuja oferta nao diz a quantidade de sessoes. Contam 0 e ficam de
   * fora do repasse - mas sao DEVOLVIDAS para a tela avisar, em vez de
   * subtaxar o terapeuta em silencio (mesma defesa do diagnostico sem formato).
   */
  semSessao: { nome?: string; oferta_nome?: string | null }[]
}

/**
 * O repasse por sessao de uma Mentoria Particular configurada, ou null quando o
 * produto nao esta na lista (ai o fechamento segue pelo caminho do %).
 */
export function repasseMentoriaPorSessao(produto: string, vendas: VendaMentoria[]): RepasseMentoria | null {
  const cfg = MENTORIA_POR_SESSAO.find(m => normalizar(m.produto) === normalizar(produto))
  if (!cfg) return null

  let sessoes = 0
  const semSessao: { nome?: string; oferta_nome?: string | null }[] = []
  for (const v of vendas) {
    const n = sessoesDoNomeDaOferta(v.oferta_nome)
    if (n && n > 0) sessoes += n
    else semSessao.push({ nome: v.nome, oferta_nome: v.oferta_nome })
  }

  return {
    terapeuta: cfg.terapeuta,
    valorPorSessao: cfg.valorPorSessao,
    sessoes,
    valor: Math.round(sessoes * cfg.valorPorSessao * 100) / 100,
    semSessao,
  }
}
