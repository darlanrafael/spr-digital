import type { Sale } from '@/types'
import { formatoDaVenda, PAGAMENTO_DENISE_POR_SESSAO } from './diagnostico-guiado'

// O repasse da Denise no Diagnostico Guiado: por SESSAO, valor FIXO.
//
// O DEFEITO (levantado pelo usuario em 11/09/2026, antes de causar dano):
// o fechamento descobre a terapeuta procurando o primeiro nome dela DENTRO do
// nome do produto (`matchTerapeutaComissao`):
//
//   "Mentoria Particular - Denise Nascimento"              -> acha
//   "Diagnóstico Guiado: Programa de acompanhamento Ind."  -> NAO acha
//
// Resultado: repasse R$ 0,00 nas 17 vendas de Diagnostico, R$ 52.127,42 de
// liquido entrando inteiro como lucro dos socios. A Denise entrega as sessoes
// depois e a tela de pagamento cobra R$ 95 cada - dinheiro que os socios ja
// tiraram. Sao R$ 6.175,00.
//
// NENHUMA dessas vendas entrou em fechamento ainda (a mais antiga e de
// 28/08/2026), entao nao houve dano. Isto fecha o buraco antes.
//
// E O SEGUNDO DEFEITO, que so aparece depois de corrigir o primeiro: mesmo se a
// regra ACHASSE a Denise, ela calcularia 30% do liquido. No Diagnostico o
// pagamento e FIXO por sessao. Nas mesmas 17 vendas:
//
//   30% do liquido pos-imposto        R$ 13.628,71   <- o que sairia
//   65 sessoes da Denise x R$ 95      R$  6.175,00   <- o correto
//   diferenca                         R$  7.453,71
//
// Consertar so o primeiro tiraria R$ 7.453,71 a mais do que o devido.
//
// POR QUE CONTA AS SESSOES VENDIDAS E NAO AS ENTREGUES: e o mesmo critério do
// faturamento. Se o fechamento reconhece os R$ 2.369,91 da venda do Ibraim
// inteiros, ele reserva os R$ 285 da Denise inteiros junto. Provisionar so o
// entregue infla o lucro do mes da venda e faz o mes da entrega apanhar - e no
// Diagnostico isso e grave, porque o Formato 1 tem 9 sessoes de 7 em 7 dias,
// dois meses de entrega. A venda da Paula, de 28/08, tem sessao ate 04/11.
//
// O Pedro nao entra: e socio, comissao 0%. As sessoes dele no pacote custam
// R$ 0,00 - conferido no banco.

export type RepasseDeUmaVenda = {
  saleId: string
  nome: string
  formato: 1 | 2 | 3
  sessoesDenise: number
  valor: number
}

export type RepasseDoDiagnostico = {
  total: number
  porVenda: RepasseDeUmaVenda[]
  /**
   * Vendas de Diagnostico cujo formato o sistema NAO reconheceu.
   *
   * Precisa ser devolvido e mostrado, nao engolido: sem o formato nao ha como
   * saber quantas sessoes sao da Denise, e o repasse dessa venda sai de fora do
   * total. Um zero silencioso aqui e exatamente o defeito que este modulo
   * conserta, na outra roupa.
   */
  semFormato: { saleId: string; nome: string }[]
}

// `order_id` aceita null de proposito: e o que o banco devolve para venda da
// Kiwify e para lancamento manual, e o tipo `Sale` declara so `string |
// undefined`. Declarar estreito aqui obrigaria a tela a converter null em
// undefined antes de chamar - conversao que existe so para agradar o
// compilador e que alguem esquece.
type VendaMinima = Pick<Sale, 'id' | 'nome'> & {
  order_id?: string | null
  oferta_nome?: string | null
  produto?: string | null
}

/**
 * Quanto a Denise recebe pelas vendas de Diagnostico de um fechamento.
 *
 * Recebe SO as vendas de Diagnostico - quem filtra e a tela, que ja agrupa por
 * produto. A conta e: para cada venda, quantas sessoes sao dela pelo formato,
 * vezes o valor fixo.
 */
export function repasseDoDiagnostico(vendas: VendaMinima[]): RepasseDoDiagnostico {
  const porVenda: RepasseDeUmaVenda[] = []
  const semFormato: { saleId: string; nome: string }[] = []

  for (const v of vendas) {
    const f = formatoDaVenda(v)
    if (!f) { semFormato.push({ saleId: v.id, nome: v.nome }); continue }
    const sessoesDenise = f.totalSessoes - f.sessoesPedro
    porVenda.push({
      saleId: v.id,
      nome: v.nome,
      formato: f.formato,
      sessoesDenise,
      valor: sessoesDenise * PAGAMENTO_DENISE_POR_SESSAO,
    })
  }

  const total = Math.round(porVenda.reduce((a, v) => a + v.valor, 0) * 100) / 100
  return { total, porVenda, semFormato }
}
