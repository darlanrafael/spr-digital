import { moedaDaKiwify } from '@/lib/moeda-da-venda'
import { ofertaDoProdutoKiwify } from '@/lib/oferta-do-webhook'
import type { SaleInsert } from '@/lib/hubla-sale'

const PROJECT_ID = 'proj_1'

/**
 * Monta o objeto de venda a partir do payload `order` de `order_approved` da
 * Kiwify. Pura: nao faz dedup nem insert, nem os alertas de moeda/liquido -
 * isso fica com quem chama (webhook e, futuramente, o reconciliador).
 */
export function parseKiwifySale(order: Record<string, unknown>): SaleInsert {
  const product     = order.Product as Record<string, unknown>
  const customer    = order.Customer as Record<string, unknown>
  const commissions = order.Commissions as Record<string, unknown>

  // Venda internacional. `Commissions.currency` sempre chegou e nunca foi
  // lido: o detector era a RAZAO valor_pago/preco_base < 0.4, que e chute e
  // erra em cupom e promocao. Ver item 57 do spr-digital.md.
  const moeda = moedaDaKiwify(commissions)
  const tracking    = (order.TrackingParameters as Record<string, unknown>) ?? {}

  const orderId = (order.order_id as string) ?? null

  const sale: SaleInsert = {
    id:                 crypto.randomUUID(),
    project_id:         PROJECT_ID,
    plataforma:         'kiwify',
    status:             'aprovada',
    order_id:           orderId,
    data_hora:          (order.approved_date as string)
                          ? new Date(order.approved_date as string).toISOString()
                          : new Date().toISOString(),
    nome:               (customer?.full_name as string) ?? '',
    email:              (customer?.email as string) ?? '',
    telefone:           (customer?.mobile as string) ?? '',
    produto:            (product?.product_name as string) ?? '',
    // Mesma razao do Hubla: a quantidade de sessoes vem do nome da oferta,
    // nao do preco. Na Kiwify o campo e `Product.product_offer_name`.
    oferta_nome:        ofertaDoProdutoKiwify(product),
    // Em venda internacional `product_base_price` fica em real (o catalogo)
    // enquanto `charge_amount` e `my_commission` vem na moeda estrangeira.
    // A linha tem que sair homogenea, entao o preco base passa a ser o
    // cobrado; o catalogo em real fica guardado em `valores_originais`.
    preco_base:         ((moeda ? commissions?.charge_amount : commissions?.product_base_price) as number ?? 0) / 100,
    valor_pago_cliente: ((commissions?.charge_amount as number) ?? 0) / 100,
    valor_com_juros:    ((commissions?.charge_amount as number) ?? 0) / 100,
    valor_liquido:      ((commissions?.my_commission as number) ?? 0) / 100,
    // NULL = real. Enquanto preenchida, a venda nao entra em fechamento.
    moeda:              moeda,
    valores_originais:  moeda ? { moeda, commissions } : null,
    utm_source:         (tracking?.utm_source as string) ?? '',
    utm_medium:         (tracking?.utm_medium as string) ?? '',
    utm_campaign:       (tracking?.utm_campaign as string) ?? '',
    utm_content:        (tracking?.utm_content as string) ?? '',
    utm_term:           (tracking?.utm_term as string) ?? '',
  }

  return sale
}
