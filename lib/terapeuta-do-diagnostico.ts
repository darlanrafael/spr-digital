import { terapeutasDoProduto, type TerapeutaDaLista } from './terapeuta-da-venda'

/**
 * O terapeuta PRINCIPAL (nao-Pedro) de um Diagnostico Guiado, pelo NOME DO PRODUTO.
 *
 * O Diagnostico nasceu hardcoded na Denise, porque ela era a unica. Ao cadastrar
 * um segundo terapeuta (Leomir, 02/10/2026), o dono criou um produto espelho
 * "Diagnostico Guiado: ... - Leomir". Regra do dono:
 *   - produto SEM nome de terapeuta  -> Denise (o historico, default)
 *   - produto COM nome de terapeuta  -> esse terapeuta
 *
 * O Pedro sempre pega as PRIMEIRAS sessoes do pacote (ele comeca); ele nunca e o
 * principal aqui, mesmo que o nome dele aparecesse no produto - por isso e
 * filtrado. Reaproveita `terapeutasDoProduto` (match pelo primeiro nome dentro
 * do nome do produto), a mesma regra que o resto do sistema ja usa.
 *
 * Devolve `{ terapeuta, ambiguo }`:
 *   - `ambiguo: true` quando o produto nomeia MAIS de um terapeuta nao-Pedro;
 *     o chamador recusa (nao da pra adivinhar qual).
 *   - `terapeuta: null` (com `ambiguo: false`) quando nao ha nomeado no produto
 *     NEM uma Denise na lista pra servir de default; o chamador recusa.
 */
export function terapeutaPrincipalDoDiagnostico(
  produto: string,
  terapeutas: TerapeutaDaLista[],
): { terapeuta: TerapeutaDaLista | null; ambiguo: boolean } {
  const nomeados = terapeutasDoProduto(produto, terapeutas)
    .filter(t => !t.nome.toLowerCase().includes('pedro'))

  if (nomeados.length > 1) return { terapeuta: null, ambiguo: true }
  if (nomeados.length === 1) return { terapeuta: nomeados[0], ambiguo: false }

  // Nenhum terapeuta nomeado no produto -> o Diagnostico "original" da Denise.
  // Ambiguidade tambem recusa aqui: dois cadastros "Denise" ativos nao podem
  // ser desempatados por regra - preserva a guarda que existia antes.
  const denises = terapeutas.filter(t => t.nome.toLowerCase().includes('denise'))
  if (denises.length > 1) return { terapeuta: null, ambiguo: true }
  return { terapeuta: denises[0] ?? null, ambiguo: false }
}

/**
 * O PRIMEIRO NOME de quem da continuidade ao Diagnostico (Denise ou Leomir),
 * pra marcar na agenda/overview do Pedro de quem e a venda. `null` quando nao
 * da pra saber com certeza (produto ambiguo, ou nenhum terapeuta resolvido) -
 * nesse caso a tela nao marca nada, em vez de chutar.
 */
export function continuidadeDoDiagnostico(
  produto: string,
  terapeutas: TerapeutaDaLista[],
): string | null {
  const { terapeuta, ambiguo } = terapeutaPrincipalDoDiagnostico(produto, terapeutas)
  if (ambiguo || !terapeuta) return null
  return terapeuta.nome.trim().split(/\s+/)[0]
}
