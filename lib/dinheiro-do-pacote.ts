// O dinheiro de um pacote pago em mais de uma compra.
//
// As MESMAS duas somas são feitas em três lugares - a comissão na rota de
// agendamento, o reembolso no prontuário do comercial e o faturamento por
// paciente na tela do terapeuta - e discordar entre eles é invisível: nenhuma
// das três telas mostra de onde o número veio. Em 03/09/2026 elas discordavam
// de fato: a tela do comercial oferecia R$ 3.980 de reembolso à Amanda e a do
// terapeuta oferecia R$ 1.380, para a mesma paciente, no mesmo dia. As duas
// gravam na mesma fila de aprovação.
import { entrouNoCaixa } from './vendas-por-situacao'

export type VendaComValor = {
  id: string
  status?: string | null
  valor_liquido?: number | null
  valor_pago_cliente?: number | null
  pacote_pai_id?: string | null
}

/**
 * As compras que somam neste pacote, além da venda-pai.
 *
 * Duas guardas que parecem redundantes e não são:
 *   - `f.id !== pai.id` porque trocar `.eq('pacote_pai_id', x)` por
 *     `.eq('id', x)` devolve a própria venda-pai dentro da lista de filhas, e
 *     a comissão sai em dobro sem erro em tela nenhuma;
 *   - o filtro de status porque uma filha reembolsada some da tela (a
 *     classificação exige aprovada) mas seguia somando na comissão - o
 *     terapeuta recebia sobre dinheiro que voltou para o cliente.
 */
export function filhasDoPacote<T extends VendaComValor>(pai: T, candidatas: T[]): T[] {
  return candidatas.filter(f => f.id !== pai.id && f.pacote_pai_id === pai.id && entrouNoCaixa(f.status))
}

function somar<T extends VendaComValor>(
  pai: T, candidatas: T[], campo: 'valor_liquido' | 'valor_pago_cliente',
): number {
  return filhasDoPacote(pai, candidatas).reduce((a, f) => a + (f[campo] ?? 0), pai[campo] ?? 0)
}

/** O líquido do PACOTE INTEIRO. É a base da comissão do terapeuta. */
export function liquidoDoPacote<T extends VendaComValor>(pai: T, candidatas: T[]): number {
  return somar(pai, candidatas, 'valor_liquido')
}

/** O que o paciente pagou pelo PACOTE INTEIRO. É a base do reembolso. */
export function brutoDoPacote<T extends VendaComValor>(pai: T, candidatas: T[]): number {
  return somar(pai, candidatas, 'valor_pago_cliente')
}

/**
 * Todos os `sale_id` do tratamento de um paciente na tela do terapeuta.
 *
 * A lista nasce das SESSÕES, e a venda-filha não tem sessão nenhuma - é a
 * venda-pai que carrega o pacote inteiro. Carregar a filha no mapa de vendas
 * não bastava: quem indexa a soma é o `saleIds`, não o mapa, então o bruto e o
 * líquido do paciente ficavam pela metade e o reembolso, que sai desse mesmo
 * número, oferecia metade do devido.
 *
 * Aqui a filha entra mesmo estornada: quem decide se ela vale dinheiro é
 * `filhasDoPacote`. Sumir com a linha esconderia do terapeuta que existe uma
 * segunda compra.
 */
export function saleIdsComAsFilhas(
  saleIdsComSessao: string[],
  vendas: { id: string; pacote_pai_id?: string | null }[],
): string[] {
  const ids = new Set(saleIdsComSessao)
  for (const v of vendas) {
    if (v.pacote_pai_id && ids.has(v.pacote_pai_id) && v.id !== v.pacote_pai_id) ids.add(v.id)
  }
  return [...ids]
}
