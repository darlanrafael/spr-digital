import { moedaDaHubla, valoresInternacionaisDaHubla } from '@/lib/moeda-da-venda'
import { ofertaDoEventoHubla } from '@/lib/oferta-do-webhook'

const PROJECT_ID = 'proj_1'

export type SaleInsert = {
  id: string
  project_id: string
  plataforma: string
  status: string
  order_id: string | null
  data_hora: string
  nome: string
  email: string
  telefone: string
  produto: string
  oferta_nome: string | null
  preco_base: number
  valor_pago_cliente: number
  valor_com_juros: number
  valor_liquido: number
  moeda: string | null
  valores_originais: Record<string, unknown> | null
  utm_source: string
  utm_medium: string
  utm_campaign: string
  utm_content: string
  utm_term: string
}

/**
 * Monta o objeto de venda a partir do payload `event` de
 * `invoice.payment_succeeded` da Hubla. Pura: não faz dedup nem insert — isso
 * fica com quem chama (webhook e, futuramente, o reconciliador).
 *
 * Devolve `null` quando o evento é de uma fatura PAI com filhos: hoje o
 * webhook ignora esse caso sem inserir, aguardando os webhooks dos produtos
 * filhos.
 */
export function parseHublaSale(event: Record<string, unknown>): { sale: SaleInsert; isOfferFormat: boolean } | null {
  const invoice = event.invoice as Record<string, unknown>

  const hasParentInvoice = !!(invoice?.parentInvoiceId)
  const hasChildInvoices = ((invoice?.childInvoiceIds as unknown[]) ?? []).length > 0
  if (hasChildInvoices && !hasParentInvoice) {
    return null
  }

  const payer = invoice?.payer as Record<string, unknown>
  const product = event.product as Record<string, unknown>
  const amount = invoice?.amount as Record<string, unknown>
  const receivers = (invoice?.receivers as Record<string, unknown>[]) ?? []
  const paymentSession = invoice?.paymentSession as Record<string, unknown>
  const utm = (paymentSession?.utm as Record<string, unknown>) ?? {}

  const sellerReceiver = receivers.find((r) => r.role === 'seller')
  const sellerTotalCents = (sellerReceiver?.totalCents as number) ?? 0

  // Venda internacional. Ate 11/09/2026 a moeda chegava aqui e era jogada
  // fora: a venda da Rosana (05/09) entrou com tres campos em euro e um em
  // dolar, todos gravados como reais, e o fechamento contou R$ 278,73 onde
  // havia USD 278,73. Ver item 57 do spr-digital.md.
  const moeda = moedaDaHubla(invoice as Record<string, unknown>)
  const valoresEmMoeda = moeda ? valoresInternacionaisDaHubla(invoice as Record<string, unknown>) : null

  const invoiceId = (invoice?.id as string) ?? null

  // product.id identifica o produto-base do catálogo, mas o mesmo produto-base pode
  // ser vendido como dois "offers" diferentes na mesma fatura (ex: cohorts/datas
  // distintas do mesmo order bump). Nesse caso os dois webhooks trazem o mesmo
  // product.id, e usá-lo sozinho como chave faz a segunda compra colidir com a
  // primeira e sumir (é tratada como "correção de valor" da primeira em vez de item
  // novo). O offers[].id aninhado é mais específico e diferencia esse caso.
  const productsArr = (event.products as Record<string, unknown>[]) ?? []
  const offers = (productsArr[0]?.offers as Record<string, unknown>[]) ?? []
  const offerItemId = (offers[0]?.id as string) ?? null
  // Nome da oferta: e ele que diz a QUANTIDADE de sessoes do pacote
  // ("Formato - 4 Sessão"), sem depender de arredondamento de preco nem de
  // promocao. Ate 02/09/2026 chegava aqui e era descartado.
  const ofertaNome = ofertaDoEventoHubla(event)
  const productId = offerItemId ?? (product?.id as string) ?? null

  // Hubla dispara dois webhooks por produto em pedidos multi-produto (bundle):
  //   offer format:   invoice.id = "{parentId}-offer-N"  →  subtotalCents = preço individual ✅
  //   simples format: invoice.id = "{parentId}"           →  subtotalCents = soma inflada de todos ❌
  // Ambos carregam o mesmo productId. Remove "-offer-N" do invoiceId para obter o canonicalParentId,
  // fazendo offer e simples colidirem no mesmo orderId — permitindo dedup e correção de valor.
  // Produto único legítimo também tem invoice.id sem "-offer-N" mas com valor individual correto;
  // é indistinguível do simples no payload. Por isso usamos offer como autoritativo: se offer
  // chega e já existe uma linha (gravada pelo simples com valor somado/inflado), corrigimos o valor.
  const isOfferFormat = !!invoiceId && /-offer-\d+$/.test(invoiceId)
  const canonicalParentId = invoiceId?.replace(/-offer-\d+$/, '') ?? invoiceId
  const orderId = canonicalParentId && productId ? `${canonicalParentId}-${productId}` : canonicalParentId

  const sale: SaleInsert = {
    id:                 crypto.randomUUID(),
    project_id:         PROJECT_ID,
    plataforma:         'hubla',
    status:             'aprovada',
    order_id:           orderId,
    data_hora:          (invoice?.saleDate as string) ?? new Date().toISOString(),
    nome:               `${payer?.firstName ?? ''} ${payer?.lastName ?? ''}`.trim(),
    email:              (payer?.email as string) ?? '',
    telefone:           (payer?.phone as string) ?? '',
    produto:            ((product?.name as string) ?? '').trim(),
    oferta_nome:        ofertaNome,
    // Em venda internacional os quatro valores vem do bloco `settlement`,
    // que esta na MESMA moeda do repasse. O bloco `amount` esta na moeda do
    // cliente (euro, em Portugal): misturar os dois foi o defeito, e nenhum
    // cambio unico conserta uma linha mista.
    preco_base:         valoresEmMoeda?.preco_base         ?? ((amount?.subtotalCents as number) ?? 0) / 100,
    valor_pago_cliente: valoresEmMoeda?.valor_pago_cliente ?? ((amount?.subtotalCents as number) ?? 0) / 100,
    valor_com_juros:    valoresEmMoeda?.valor_com_juros    ?? ((amount?.totalCents as number) ?? 0) / 100,
    valor_liquido:      valoresEmMoeda?.valor_liquido      ?? Math.round(sellerTotalCents) / 100,
    // NULL = real. Enquanto preenchida, a venda nao entra em fechamento.
    //
    // MARCA SEMPRE QUE A MOEDA FOR DETECTADA, mesmo quando os valores nao
    // puderam ser normalizados. A primeira versao disto gravava
    // `valoresEmMoeda ? moeda : null`, e ai uma venda estrangeira com o
    // bloco `settlement` incompleto passava com os valores em euro
    // marcados como reais e SEM bandeira nenhuma - o defeito original, em
    // silencio, pelo caminho de excecao.
    //
    // `normalizado: false` diz que a linha pode estar em moedas MISTURADAS.
    // A rota de conversao recusa converter nesse estado: um cambio unico
    // numa linha mista produz numero errado, e errado com cara de certo e
    // pior que travado.
    moeda:              moeda,
    valores_originais:  moeda ? { moeda, normalizado: !!valoresEmMoeda, amount, receivers } : null,
    utm_source:         (utm?.source as string) ?? '',
    utm_medium:         (utm?.medium as string) ?? '',
    utm_campaign:       (utm?.campaign as string) ?? '',
    utm_content:        (utm?.content as string) ?? '',
    utm_term:           (utm?.term as string) ?? '',
  }

  return { sale, isOfferFormat }
}
