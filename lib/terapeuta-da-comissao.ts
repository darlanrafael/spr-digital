export type TerapeutaComissao = { nome: string; percentual_comissao: number }

/**
 * O terapeuta que RECEBE a comissao de um produto, pelo NOME DO PRODUTO.
 *
 * Substitui o `find` ingenuo que pegava o PRIMEIRO terapeuta nomeado na ordem
 * da lista. Isso quebrava nos produtos de dois nomes "Pedro | X": o Pedro e
 * socio (comissao 0%) e sempre comeca o nome, entao se X vinha depois dele na
 * lista (caso do Leomir), a comissao ia parar no Pedro (0%) e X ficava sem
 * repasse. Funcionava com a Denise so por sorte de ela vir antes do Pedro.
 *
 * Regra: entre os terapeutas NOMEADOS no produto, prefere quem tem comissao
 * > 0 (quem de fato recebe). Se so terapeutas de 0% forem nomeados (ex.: o
 * produto so cita o Pedro), devolve o primeiro deles - e o chamador, que ja
 * checa `percentual_comissao > 0`, nao gera repasse. Independe da ordem da lista.
 */
export function terapeutaDaComissao(
  produto: string,
  terapeutas: TerapeutaComissao[],
): TerapeutaComissao | null {
  const lower = produto.toLowerCase()
  const nomeados = terapeutas.filter(t => lower.includes(t.nome.trim().split(' ')[0].toLowerCase()))
  if (nomeados.length === 0) return null
  const pagos = nomeados.filter(t => t.percentual_comissao > 0)
  return pagos[0] ?? nomeados[0]
}
