// Quantas sessões um pacote tem, e se o valor recebido bate com ele.
//
// A quantidade de sessões é REGRA DO NEGÓCIO, não escolha de quem agenda
// (usuário, 03/09/2026: "o que o comercial não pode fazer é ele determinar a
// quantidade de sessão de uma venda que nós colocamos em pendente de
// agendamento"). O que o comercial decide é QUANDO cada sessão acontece,
// inclusive fora do intervalo de 7 dias.
//
// Até 02/09/2026 a quantidade vinha do `preco_base` contra uma tabela de
// preços, o campo era editável na tela e havia um aviso mandando conferir numa
// planilha. Medido nas 232 vendas de Mentoria aprovadas: 202 batiam exato, 30
// não, com diferenças de R$ 1 (arredondamento da plataforma) a R$ 1.140.
//
// Agora são DUAS fontes independentes conferindo uma à outra:
//   - o NOME DA OFERTA diz a quantidade ("Formato - 4 Sessão")
//   - o PREÇO confirma o pacote
// Quando discordam acima da tolerância, o sistema não escolhe: pergunta.

/** Preço de tabela por quantidade de sessões. Vocês não praticam desconto. */
export const PRECO_POR_SESSOES: Record<'pedro' | 'denise', Record<number, number>> = {
  pedro: { 1: 1300, 2: 1550, 4: 2860, 8: 5280 },
  denise: { 1: 550, 2: 790, 4: 1400, 8: 2640 },
}

/**
 * Diferença que o sistema ignora sem perguntar nada.
 *
 * Medido no banco: as diferenças de até R$ 5 são de R$ 1, R$ 2 e R$ 3, e vêm de
 * arredondamento da plataforma, não de decisão comercial. Perguntar nelas seria
 * ruído. Acima disso, das 232 vendas históricas, o comercial teria respondido
 * 20 vezes - menos de 9%.
 */
export const TOLERANCIA_REAIS = 5

/** Lê a quantidade de sessões do nome da oferta. `null` quando não dá pra saber. */
export function sessoesDoNomeDaOferta(oferta: string | null | undefined): number | null {
  if (!oferta) return null
  const texto = oferta.toLowerCase()
  // "Formato - 4 Sessão", "Formato 2 - 4 Sessões", "Formato - 1 Sessão denice".
  // O número que interessa é o que vem ANTES da palavra sessão - "Formato 2" é
  // o nome do plano, não a quantidade.
  const m = texto.match(/(\d+)\s*sess/)
  if (m) {
    const n = Number(m[1])
    if (Number.isFinite(n) && n > 0 && n <= 60) return n
  }
  // "Formato 1 - Sessão Única"
  // `\w` nao inclui "ã", entao o casamento precisa aceitar qualquer letra.
  if (/sess[a-zãáâ]*\s*[úu]nica/.test(texto)) return 1
  return null
}

export type ConfereQuantidade =
  /** As duas fontes concordam (ou a diferença cabe na tolerância). Segue direto. */
  | { situacao: 'ok'; sessoes: number }
  /**
   * As ofertas dizem a quantidade, mas o valor recebido não fecha com o pacote.
   * NÃO bloqueia: o comercial responde a pergunta e agenda normalmente.
   */
  | { situacao: 'valor_divergente'; sessoes: number; esperado: number; recebido: number; diferenca: number }
  /** Nem as ofertas nem o preço dizem a quantidade. Aí ninguém chuta. */
  | { situacao: 'indeterminado' }

export type VendaDoPacote = { ofertaNome?: string | null; precoBase?: number | null }

/**
 * Decide a quantidade de sessões de um PACOTE, e diz se algo precisa ser
 * perguntado antes de liberar o agendamento.
 *
 * Recebe uma LISTA de vendas porque um pacote pode ser pago em mais de uma
 * compra. O caso real que obrigou isso: a Amanda comprou duas ofertas de
 * "Formato - 4 Sessão" em 24 e 25/08, por R$ 2.600 e R$ 2.680. Isoladas, cada
 * uma parece um pacote de 4 pago a menos; somadas, são 8 sessões por R$ 5.280,
 * que é exatamente o preço de tabela do pacote de 8. Conferir venda a venda
 * daria divergência nas duas e esconderia que o pacote está correto.
 */
export function conferirQuantidade(params: {
  vendas: VendaDoPacote[]
  /** Qual tabela de preço usar. A Denise tem valores próprios. */
  tabela: 'pedro' | 'denise'
}): ConfereQuantidade {
  const { vendas, tabela } = params
  const precos = PRECO_POR_SESSOES[tabela]
  if (vendas.length === 0) return { situacao: 'indeterminado' }

  const porOferta = vendas.map(v => sessoesDoNomeDaOferta(v.ofertaNome))
  const recebido = Math.round(vendas.reduce((a, v) => a + (v.precoBase ?? 0), 0) * 100) / 100

  // Nenhuma venda do pacote tem oferta legível: cai na tabela de preço, que é o
  // que o sistema já fazia antes de a oferta ser guardada.
  if (porOferta.every(n => n === null)) {
    for (const [n, valor] of Object.entries(precos)) {
      if (Math.abs(valor - recebido) <= TOLERANCIA_REAIS) return { situacao: 'ok', sessoes: Number(n) }
    }
    return { situacao: 'indeterminado' }
  }

  // Venda sem oferta legível no meio de um pacote: a quantidade dela é
  // desconhecida, então o total também é. Melhor perguntar do que somar errado.
  const quantidades = porOferta.filter((n): n is number => n !== null)
  if (quantidades.length !== porOferta.length) return { situacao: 'indeterminado' }

  const sessoes = quantidades.reduce((a, n) => a + n, 0)
  const esperado = precos[sessoes]
  // Quantidade fora da tabela de preços: a quantidade vale, e não há com o que
  // conferir o valor.
  if (esperado === undefined) return { situacao: 'ok', sessoes }

  const diferenca = Math.round((esperado - recebido) * 100) / 100
  if (Math.abs(diferenca) <= TOLERANCIA_REAIS) return { situacao: 'ok', sessoes }
  return { situacao: 'valor_divergente', sessoes, esperado, recebido, diferenca }
}
