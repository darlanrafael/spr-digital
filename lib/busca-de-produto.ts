// Busca por nome na lista de produtos do fechamento.
//
// Pedido do usuario em 11/09/2026: *"nessa parte onde mostra os produtos
// incluidos eu gostaria de ter uma lupa para eu digitar o nome e mostrar
// somente os produtos com base no nome"*. Sao 31 produtos na tela.
//
// Mora num modulo proprio porque busca em portugues erra de um jeito chato: sem
// tirar acento, digitar "diagnostico" nao acha "Diagnóstico Guiado", e o
// usuario conclui que o produto sumiu do sistema.

/** Minusculas e sem acento, para "diagnostico" achar "Diagnóstico". */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Os produtos cujo nome contem TODOS os termos digitados, em qualquer ordem.
 *
 * Por termo e nao pela frase inteira: os nomes reais sao longos e cheios de
 * pontuacao ("Combo: Primeiros Passos da Restauração - OB - imersão"), entao
 * quem procura digita dois pedacos soltos - "combo imersao" - e nao a frase
 * exata. Busca por frase nao acharia isso.
 */
export function filtrarProdutos<T extends { nome: string }>(produtos: T[], busca: string): T[] {
  const termos = normalizar(busca).split(/\s+/).filter(Boolean)
  if (termos.length === 0) return produtos
  return produtos.filter(p => {
    const nome = normalizar(p.nome)
    return termos.every(t => nome.includes(t))
  })
}

/**
 * O que "Selecionar todos" faz quando ha busca ativa: ACRESCENTA os visiveis,
 * sem derrubar o que ja estava marcado e esta escondido pelo filtro.
 *
 * O contrario seria uma armadilha silenciosa: filtrar por "CSP", clicar em
 * selecionar todos, e perder os 25 produtos marcados antes sem nenhum aviso.
 */
export function comOsVisiveisMarcados(selecionados: string[], visiveis: string[]): string[] {
  return [...new Set([...selecionados, ...visiveis])]
}

/** E "Nenhum" com busca ativa desmarca so os visiveis, pelo mesmo motivo. */
export function semOsVisiveis(selecionados: string[], visiveis: string[]): string[] {
  const fora = new Set(visiveis)
  return selecionados.filter(id => !fora.has(id))
}
