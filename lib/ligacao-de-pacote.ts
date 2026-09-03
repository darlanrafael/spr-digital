import { JANELA_MESMO_PACOTE_HORAS } from './pacote-de-vendas'
// As travas de POST /api/terapeutas/vendas/pacote, fora da rota.
//
// A rota faz I/O (lê a venda, lê a irmã, conta filhas e sessões) e depois DECIDE.
// Só o I/O precisa de banco; a decisão é uma função de dados, e é nela que moram
// os erros caros: ligar duas vendas erradas dá ao paciente menos sessões do que
// ele pagou e some com a segunda compra de Pendentes, sem tela nenhuma que
// mostre o que aconteceu.
export type VendaParaLigar = {
  id: string
  email?: string | null
  produto: string
  status?: string | null
  pacote_pai_id?: string | null
  /** Instante da compra. Sem ele a janela de 24h não pode ser conferida. */
  data_hora?: string | null
}

export type PedidoDeLigacao = {
  tipo: 'mesmo_pacote' | 'compra_separada' | 'valor_divergente'
  irmaId: string | null
  /** A venda que vai carregar as sessões. */
  venda: VendaParaLigar
  /** A outra compra. `null` quando não foi encontrada no banco. */
  irma: VendaParaLigar | null
  /** A irmã já é o pacote principal de uma terceira compra. */
  irmaTemFilhas: boolean
  /** A irmã já tem sessões agendadas: é um pacote próprio. */
  irmaTemSessoes: boolean
}

export type Veredicto =
  | { acao: 'recusar'; status: number; erro: string }
  /** Gravar `pacote_pai_id` na irmã e registrar. */
  | { acao: 'ligar' }
  /** Já ligada numa tentativa anterior: só registrar. Idempotente de propósito. */
  | { acao: 'ja_ligada' }
  /** Nada a ligar: só registrar a resposta. */
  | { acao: 'so_registrar' }
  /**
   * A resposta mudou para "são compras separadas" e a ligação anterior precisa
   * cair.
   *
   * Sem esta ação o comercial podia juntar as compras, ver o agendamento
   * falhar (conflito de horário, timeout), reconsiderar, clicar em "É compra
   * separada" e seguir: a segunda ocorrência dizia o contrário da primeira, o
   * `pacote_pai_id` continuava gravado e o pacote de 8 era agendado com 4
   * sessões - a compra ligada sumindo de Pendentes, do dashboard e da tela do
   * terapeuta para sempre.
   */
  | { acao: 'desligar' }

/**
 * O que desfazer quando a auditoria (`ocorrencias_pacote`) falha DEPOIS do link.
 *
 * Sem auditoria o link não pode ficar de pé: o CEO não teria como saber que duas
 * compras foram juntadas. Mas desfazer um link que JÁ estava gravado e auditado
 * numa tentativa anterior destrói dado bom - a filha volta para Pendentes com
 * uma ocorrência de "compras juntadas" registrada para compras que não estão
 * juntadas, e nada no sistema detecta.
 */
export function desfazerLinkSeAuditoriaFalhar(v: Veredicto): boolean {
  return v.acao === 'ligar'
}

/**
 * O que refazer quando a auditoria falha DEPOIS de um desligamento.
 *
 * Simétrico ao de cima: o desligamento sem registro deixaria a compra de volta
 * em Pendentes sem nada dizendo por quê, e o CEO com uma ocorrência de
 * "compras juntadas" que já não vale.
 */
export function refazerLinkSeAuditoriaFalhar(v: Veredicto): boolean {
  return v.acao === 'desligar'
}

export function avaliarLigacao(p: PedidoDeLigacao): Veredicto {
  if (p.tipo !== 'mesmo_pacote') {
    // Responder "são compras separadas" sobre uma irmã que ESTÁ ligada a esta
    // venda é uma retratação, não uma resposta nova: a ligação tem de cair
    // junto. Ver o comentário de `desligar` acima para a sequência real que
    // isso destravava.
    if (p.irma && p.irma.pacote_pai_id === p.venda.id) return { acao: 'desligar' }
    return { acao: 'so_registrar' }
  }
  if (!p.irmaId) {
    return { acao: 'recusar', status: 400, erro: 'Para juntar as compras é preciso dizer qual é a outra venda.' }
  }
  if (p.irmaId === p.venda.id) {
    return { acao: 'recusar', status: 400, erro: 'Uma venda não pode ser parte dela mesma.' }
  }
  // Esta venda já é filha de outra: ligá-la como pai criaria corrente (ou ciclo,
  // com A->B e B->A) que nenhuma tela sabe mostrar.
  if (p.venda.pacote_pai_id) {
    return { acao: 'recusar', status: 409, erro: 'Esta venda já faz parte de outro pacote.' }
  }
  if (!p.irma) return { acao: 'recusar', status: 404, erro: 'A outra venda não foi encontrada' }

  const jaLigadaAqui = p.irma.pacote_pai_id === p.venda.id
  if (p.irma.pacote_pai_id && !jaLigadaAqui) {
    return { acao: 'recusar', status: 409, erro: 'Essa outra venda já faz parte de outro pacote.' }
  }
  // Corrente de 3: A->B ligado, o agendamento falha, e depois B->C deixaria
  // B->A->C com uma compra fora da soma.
  if (p.irmaTemFilhas) {
    return { acao: 'recusar', status: 409, erro: 'Essa outra venda já é o pacote principal de outra compra.' }
  }
  // Mesmo paciente, por E-MAIL. Cruzar por nome já produziu falso positivo neste
  // projeto.
  const emailA = (p.venda.email ?? '').trim().toLowerCase()
  const emailB = (p.irma.email ?? '').trim().toLowerCase()
  if (!emailA || !emailB || emailA !== emailB) {
    return { acao: 'recusar', status: 400, erro: 'As duas vendas precisam ser do mesmo paciente.' }
  }
  if (p.irma.produto !== p.venda.produto) {
    return { acao: 'recusar', status: 400, erro: 'As duas vendas precisam ser do mesmo produto.' }
  }
  if (p.irma.status !== 'aprovada') {
    return { acao: 'recusar', status: 400, erro: 'A outra venda não está aprovada.' }
  }
  // Irmã COM sessões já é um pacote agendado por conta própria: ligá-la aqui
  // esconderia as sessões dela de todas as telas, que passam a olhar só o pai.
  if (p.irmaTemSessoes) {
    return { acao: 'recusar', status: 409, erro: 'A outra venda já tem sessões agendadas: ela é um pacote próprio.' }
  }
  // A janela de 24h é a regra central do negócio e vivia SÓ no cliente: a rota
  // aceitava juntar duas compras separadas por meses, que é exatamente o caso
  // que a regra existe para não juntar (pacote consumido e recomprado depois).
  // Uma requisição forjada, ou um `candidataAoMesmoPacote` que mude sem que
  // esta rota mude junto, passava direto.
  const distancia = horasEntre(p.venda.data_hora, p.irma.data_hora)
  if (distancia === null) {
    return { acao: 'recusar', status: 400, erro: 'Sem a data das duas compras não dá para conferir se são o mesmo pacote.' }
  }
  if (distancia > JANELA_MESMO_PACOTE_HORAS) {
    return {
      acao: 'recusar', status: 409,
      erro: `As duas compras estão a ${Math.round(distancia)}h uma da outra, acima do limite de ${JANELA_MESMO_PACOTE_HORAS}h para o mesmo pacote.`,
    }
  }
  return jaLigadaAqui ? { acao: 'ja_ligada' } : { acao: 'ligar' }
}

/** Distância em horas entre duas compras. `null` se alguma data faltar ou for inválida. */
function horasEntre(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null
  const ta = new Date(a).getTime(), tb = new Date(b).getTime()
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null
  return Math.abs(ta - tb) / (60 * 60 * 1000)
}
