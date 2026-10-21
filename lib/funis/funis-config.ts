// Config dos FUNIS, no CODIGO (fonte da verdade). Decisao do dono (21/10/2026):
// nada de tela de cadastro nem tabela no banco - os funis, seus produtos, a
// nomenclatura das campanhas da Meta e a aliquota de imposto ficam aqui, e
// adicionar/mudar um funil e uma conversa com o dono + deploy. Igual o resto do
// sistema (readequacoes, ofertas do diagnostico, mentoria por sessao).
//
// So DOIS funis por enquanto (dono): "Como Ser Perdoado" e "Imersao a
// Reaproximacao". Os demais produtos nao entram em funil nenhum.

export type PlataformaFunil = 'hubla' | 'kiwify'

export type ProdutoDoFunil = {
  plataforma: PlataformaFunil
  /**
   * NOME exato do produto, como vem na venda (campo `produto` da tabela sales).
   * E por aqui que a venda casa com o funil - mesma fonte que o DRE usa. Os
   * nomes sao unicos por funil gracas a sigla ("- CSP"), entao nao ha conflito
   * com produtos de outro funil que tenham nome parecido.
   */
  nome: string
  /**
   * produto_id da plataforma, quando conhecido. Fica como reforco/futuro: a
   * captura do produto_id no webhook ainda nao esta no ar, entao venda nova vem
   * com id null - por isso o CASAMENTO e pelo NOME. Quando o id passar a vir,
   * ele confirma o nome.
   */
  produto_id?: string
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

export type FunilConfig = {
  id: string
  nome: string
  /** Label do produto principal, pro subtitulo do funil (ex.: "Como Ser Perdoado"). */
  produtoLabel: string
  /**
   * Nomenclatura das campanhas da Meta que trazem o investimento deste funil.
   * Uma campanha entra se o nome contiver QUALQUER um destes termos. A DEFINIR
   * com o dono (ele passa o padrao que usa no gerenciador).
   */
  termosCampanha: string[]
  /**
   * Produtos (por produto_id) cujas vendas contam como faturamento deste funil.
   * A DEFINIR: o dono passa os NOMES e o Claude resolve os produto_id no banco.
   */
  produtos: ProdutoDoFunil[]
  /**
   * Aliquota de imposto sobre o FATURAMENTO BRUTO deste funil (fracao). Por funil
   * (dono 21/10/2026): Como Ser Perdoado 12,85%; Imersao a Reaproximacao 3,85%.
   */
  impostoRate: number
}

/**
 * Acrescimo sobre o investimento em trafego (IOF etc.), global. Dono (21/10/2026):
 * investir R$ 1.000 "custa" R$ 1.138,50. Aplicado como `trafego * (1 + ISTO)`.
 */
export const ACRESCIMO_TRAFEGO = 0.1385

export const FUNIS: FunilConfig[] = [
  {
    id: 'como-ser-perdoado',
    nome: 'Como Ser Perdoado',
    produtoLabel: 'Como Ser Perdoado',
    // A sigla do funil (dono 21/10/2026): esta em todos os produtos e nas
    // campanhas da Meta. Campanha cujo nome contem "CSP" traz o investimento.
    termosCampanha: ['CSP'],
    // Produtos confirmados pelo dono (Hubla, 21/10/2026). Todos "- CSP".
    produtos: [
      { plataforma: 'hubla', produto_id: '1s8rVxvbITB2ejQHEHKx', nome: 'COMO SER PERDOADO' },
      { plataforma: 'hubla', produto_id: 'eNsZ824PsAgz2DrvKYxw', nome: 'ALIANÇA SAGRADA - CSP' },
      { plataforma: 'hubla', produto_id: 'OOKdn0lKVKGBBLhY78BY', nome: 'COMBO - OS PRIMEIROS PASSOS DA RESTAURAÇÃO - CSP' },
      { plataforma: 'hubla', produto_id: 'HYscfyfSoG2CrsS6JpSe', nome: 'ACESSO VITALÍCIO - CSP' },
      // produto_id CONFIRMADO no payload cru do webhook (compra de teste 21/10):
      // event.product.id = 4c7FpX4SdlqVQT0WJfOv (bate com o link hub.la/g/4c7F...).
      { plataforma: 'hubla', produto_id: '4c7FpX4SdlqVQT0WJfOv', nome: 'O RESGATE - CSP' },
    ],
    impostoRate: 0.1285,
  },
  {
    id: 'imersao-reaproximacao',
    nome: 'Imersão a Reaproximação',
    produtoLabel: 'Imersão a Reaproximação',
    termosCampanha: [], // A DEFINIR
    produtos: [],       // A DEFINIR
    impostoRate: 0.0385,
  },
]

/**
 * O funil de uma venda, ou null se ela nao e de funil nenhum.
 *
 * Casa pelo NOME do produto (mesma fonte que o DRE), e aceita o produto_id como
 * reforco quando ele vier. Plataforma tem que bater junto.
 */
export function funilDaVenda(venda: { plataforma: string; produto: string; produto_id?: string | null }): FunilConfig | null {
  const nome = norm(venda.produto)
  return FUNIS.find(f =>
    f.produtos.some(p =>
      p.plataforma === venda.plataforma
      && (norm(p.nome) === nome || (!!venda.produto_id && p.produto_id === venda.produto_id)),
    ),
  ) ?? null
}
