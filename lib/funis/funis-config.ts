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
   * produto_id da plataforma. A captura no webhook JA esta no ar (desde 05/10,
   * itens 104 e 114): venda nova grava o id. Serve de REFORCO ao nome - o
   * casamento tenta o id e, quando null (historico antigo), cai no nome. Nome e
   * id saem da mesma venda, entao se confirmam.
   */
  produto_id?: string
  /**
   * E o produto PRINCIPAL do funil (a "venda unica"), nao um agregado/order bump.
   * Usado pra separar, por criativo, as vendas do principal das vendas com
   * agregados. Um funil pode ter o principal em mais de uma plataforma.
   */
  principal?: boolean
  /**
   * Estagio da ESTEIRA (value ladder) a que este produto pertence - o rotulo da
   * linha no "funil de produtos" (dono 23/10/2026). Order bumps compartilham o
   * mesmo rotulo (viram UMA linha so). A ordem dos estagios, da boca pro fim, e
   * FunilConfig.esteira. Produto sem estagio nao aparece na esteira. Ver item 119.
   */
  estagio?: string
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
  /**
   * Estagios da ESTEIRA (value ladder), da BOCA (produto principal) pro fim, em
   * ordem. O "funil de produtos" (dentro da aba Vendas) renderiza SEMPRE todos os
   * estagios, com ou sem venda no periodo - zerado quando nao ha venda (dono
   * 23/10/2026). Cada produto aponta seu estagio em ProdutoDoFunil.estagio.
   */
  esteira: string[]
}

/**
 * Acrescimo sobre o investimento em trafego (IOF etc.), global. Dono (21/10/2026):
 * investir R$ 1.000 "custa" R$ 1.138,50. Aplicado como `trafego * (1 + ISTO)`.
 */
export const ACRESCIMO_TRAFEGO = 0.1385

/**
 * TRAVA de data (dono 23/10/2026): o funil so contabiliza a partir desta data.
 * Qualquer periodo selecionado e clampado pra comecar aqui; periodo todo antes
 * vem zerado. Formato 'YYYY-MM-DD' (BRT). Pra DESLIGAR a trava no futuro, trocar
 * por `null` (o dono pediu que fosse facil de remover). Ver item 120 do
 * spr-digital.md e lib/funis/corte-funil.ts.
 */
export const DATA_CORTE_FUNIS: string | null = '2026-10-23'

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
      { plataforma: 'hubla', produto_id: '1s8rVxvbITB2ejQHEHKx', nome: 'COMO SER PERDOADO', principal: true, estagio: 'Como Ser Perdoado' },
      { plataforma: 'hubla', produto_id: 'eNsZ824PsAgz2DrvKYxw', nome: 'ALIANÇA SAGRADA - CSP', estagio: 'Order bumps' },
      { plataforma: 'hubla', produto_id: 'OOKdn0lKVKGBBLhY78BY', nome: 'COMBO - OS PRIMEIROS PASSOS DA RESTAURAÇÃO - CSP', estagio: 'Order bumps' },
      { plataforma: 'hubla', produto_id: 'HYscfyfSoG2CrsS6JpSe', nome: 'ACESSO VITALÍCIO - CSP', estagio: 'Order bumps' },
      // produto_id CONFIRMADO no payload cru do webhook (compra de teste 21/10):
      // event.product.id = 4c7FpX4SdlqVQT0WJfOv (bate com o link hub.la/g/4c7F...).
      { plataforma: 'hubla', produto_id: '4c7FpX4SdlqVQT0WJfOv', nome: 'O RESGATE - CSP', estagio: 'O Resgate - CSP' },
      // Upsell/backend do funil CSP (dono 22/10/2026): nao e o principal, e um
      // agregado. Vende nas duas plataformas (nomes diferentes). So entra no
      // "com agregados", nao na "venda unica".
      { plataforma: 'hubla',  produto_id: 'FL2Rs2rICpeVMCW77j6n',                 nome: 'MENTORIA EM GRUPO - PEDRO RONCADA', estagio: 'Mentoria em grupo' },
      { plataforma: 'kiwify', produto_id: 'b7dee3f0-5b82-11f1-bec6-3d073756b1c6', nome: 'Mentoria em grupo- Pedro Roncada', estagio: 'Mentoria em grupo' },
    ],
    impostoRate: 0.1285,
    // Esteira (dono 23/10/2026): boca = principal; depois order bumps (unificados
    // numa linha), upsell (mentoria) e o resgate por ultimo.
    esteira: ['Como Ser Perdoado', 'Order bumps', 'Mentoria em grupo', 'O Resgate - CSP'],
  },
  {
    id: 'imersao-reaproximacao',
    nome: 'Imersão a Reaproximação',
    produtoLabel: 'Imersão a Reaproximação',
    // Dono (21/10/2026): campanhas da Imersao levam "IRM" no nome. Tambem "IAR"
    // (antecipacao/live da Imersao; o "CCC" no nome era so o nome da live "Como
    // Convencer seu Conjuge", nao outro funil). Provado: csp&iar = csp&irm = 0,
    // nao colide com o Como Ser Perdoado. Ver item 114.4d do spr-digital.md.
    termosCampanha: ['IRM', 'IAR'],
    // Produtos confirmados pelo dono (21/10/2026). Vende nas DUAS plataformas: cada
    // produto tem id DIFERENTE por plataforma e nome ligeiramente diferente (Kiwify
    // leva prefixo "🥝 "). Nome = exatamente o campo `produto` da tabela sales
    // (conferido no catalogo real de 14.019 vendas); venda nova casa por id, venda
    // antiga (< 05/10, sem id) casa por nome. Ver item 114.4 do spr-digital.md.
    produtos: [
      // Principal
      { plataforma: 'hubla',  produto_id: 'd7tvBd7toCPnVZnOWUaZ',                 nome: 'Imersão - A reaproximação', principal: true, estagio: 'Imersão - A reaproximação' },
      { plataforma: 'kiwify', produto_id: 'f34a2630-d9e0-11f0-ac73-b5cf3aba727f', nome: 'IImersão - A Reaproximação - Oficial', principal: true, estagio: 'Imersão - A reaproximação' },
      // Bump: Combo Primeiros Passos
      { plataforma: 'hubla',  produto_id: 'hQDdIiz1jjuM9jtWwMjk',                 nome: 'Combo: Primeiros Passos da Restauração - OB', estagio: 'Order bumps' },
      { plataforma: 'kiwify', produto_id: 'e6bd44b0-ee85-11f0-a468-3f63a07cd627', nome: '🥝 Combo: Primeiros Passos da Restauração - OB - imersão', estagio: 'Order bumps' },
      // Bump: Guia Anti-brigas
      { plataforma: 'hubla',  produto_id: '8C4fqbB8IdQXrydNNgmg',                 nome: 'Guia prático - Anti-brigas - OB', estagio: 'Order bumps' },
      { plataforma: 'kiwify', produto_id: '4eefa810-ee87-11f0-b4f2-9f6e27362ab7', nome: '🥝 Guia prático - Anti-brigas - OB Imersão', estagio: 'Order bumps' },
      // Bump: Gravação
      { plataforma: 'hubla',  produto_id: '0uQLyW37o3FYhr7tLPhd',                 nome: 'Gravação - Imersão A reaproximação', estagio: 'Order bumps' },
      { plataforma: 'kiwify', produto_id: '32e2ad30-ee86-11f0-8fbb-ab178724d381', nome: '🥝 Gravação da Imersão - A Reaproximação - OB Imersão', estagio: 'Order bumps' },
      // Bump: O Que fazer Após a traição (nome com DOIS espacos antes do "OB", como no banco)
      { plataforma: 'hubla',  produto_id: 'qSNHES80x9ut1fuo9qOv',                 nome: 'O Que fazer Após a traição?  OB', estagio: 'Order bumps' },
      { plataforma: 'kiwify', produto_id: '703507b0-ee85-11f0-8e0e-212248210abf', nome: '🥝 O Que fazer Após a traição?  OB - Imersão', estagio: 'Order bumps' },
    ],
    impostoRate: 0.0385,
    // Esteira PADRAO (dono nao definiu p/ a Imersao - 23/10/2026): principal ->
    // order bumps (os 4 bumps juntos). Ajustar quando o dono passar a esteira dela.
    esteira: ['Imersão - A reaproximação', 'Order bumps'],
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

/**
 * A venda é do produto PRINCIPAL do funil (a "venda única"), e não de um
 * agregado/order bump? Usa a mesma regra de casamento (nome ou produto_id +
 * plataforma), só que restrita aos produtos marcados `principal`.
 */
export function ehProdutoPrincipal(
  venda: { plataforma: string; produto: string; produto_id?: string | null },
  funilId: string,
): boolean {
  const f = FUNIS.find(x => x.id === funilId)
  if (!f) return false
  const nome = norm(venda.produto)
  return f.produtos.some(p =>
    p.principal === true
    && p.plataforma === venda.plataforma
    && (norm(p.nome) === nome || (!!venda.produto_id && p.produto_id === venda.produto_id)),
  )
}

/**
 * O produto do funil (entrada do config) que casa com a venda, ou null. Serve
 * pro "funil de produtos": agrupa as vendas pelo produto configurado (nome limpo
 * + se e principal), com a mesma regra de casamento (nome ou produto_id +
 * plataforma). Ver item 119 do spr-digital.md.
 */
export function produtoDoFunil(
  venda: { plataforma: string; produto: string; produto_id?: string | null },
  funilId: string,
): ProdutoDoFunil | null {
  const f = FUNIS.find(x => x.id === funilId)
  if (!f) return null
  const nome = norm(venda.produto)
  return f.produtos.find(p =>
    p.plataforma === venda.plataforma
    && (norm(p.nome) === nome || (!!venda.produto_id && p.produto_id === venda.produto_id)),
  ) ?? null
}
