// A decisão que o modal de agendamento toma antes de qualquer clique.
//
// Existe porque três defeitos desta feature moraram exatamente aqui - na fiação
// entre a rota e a tela - e nenhum teste os pegou: as funções puras
// (`candidataAoMesmoPacote`, `conferirQuantidade`) estavam certas e cobertas;
// quem as chamava é que passava a lista errada, na hora errada.
//
// Ao trazer a decisão inteira para cá, o `page.tsx` fica sem ramo nenhum: ele
// lê `numeroDeSessoes`, `travado` e `tipoAResponder` e desenha.
import { candidataAoMesmoPacote, type VendaCandidata } from './pacote-de-vendas'
import { conferirQuantidade, type ConfereQuantidade } from './sessoes-da-oferta'

export type VendaNaTela = {
  id: string
  email: string | null
  produto: string
  data_hora: string
  oferta_nome?: string | null
  preco_base?: number | null
  pacote_pai_id?: string | null
}

/**
 * Resposta do comercial, SEMPRE carimbada com a venda a que pertence.
 *
 * Guardar o `saleId` junto é o mesmo padrão de `agendarSessoesLidas`: torna
 * "esta resposta é desta venda?" derivável, em vez de depender de um
 * `useEffect` de limpeza que some se alguém mexer nas dependências.
 */
export type RespostaDoComercial = { saleId: string; valor: 'mesmo_pacote' | 'compra_separada' }

export type EstadoDoModal = {
  venda: VendaNaTela | null
  /** Diagnóstico Guiado: a quantidade vem do formato, a regra da oferta não se aplica. */
  totalDoDiagnostico: number | null
  /** Vendas sem nenhuma sessão. */
  pendentes: VendaNaTela[]
  /** Vendas com sessão. */
  ativos: VendaNaTela[]
  /** Vendas ligadas a outro pacote. Não estão em `pendentes` nem em `ativos`. */
  filhas: VendaNaTela[]
  entreguesPorVenda: Record<string, number>
  resposta: RespostaDoComercial | null
  /** Retry do MESMO agendamento (o comercial liberou o conflito de compromisso). */
  ehRetryDeCompromisso?: boolean
}

export type DecisaoDoAgendamento = {
  candidata: VendaCandidata | null
  confere: ConfereQuantidade | null
  /** `null` = caminho antigo (lançamento manual): a quantidade vem de quem lançou. */
  numeroDeSessoes: number | null
  travado: boolean
  /** A resposta que vale para ESTA venda. */
  respostaEfetiva: 'mesmo_pacote' | 'compra_separada' | null
  /** O que precisa ir para /vendas/pacote ANTES de agendar. */
  tipoAResponder: 'mesmo_pacote' | 'compra_separada' | 'valor_divergente' | null
}

/** Lançamento manual não vem de plataforma: não tem oferta e o preço costuma ser 0. */
export function ehLancamentoManual(id: string): boolean {
  return id.startsWith('manual_')
}

const NADA: DecisaoDoAgendamento = {
  candidata: null, confere: null, numeroDeSessoes: null,
  travado: false, respostaEfetiva: null, tipoAResponder: null,
}

export function decidirAgendamento(e: EstadoDoModal): DecisaoDoAgendamento {
  if (!e.venda) return NADA
  const venda = e.venda
  if (e.totalDoDiagnostico !== null) return { ...NADA, numeroDeSessoes: e.totalDoDiagnostico }

  const paraCandidata = (v: VendaNaTela): VendaCandidata => ({
    id: v.id, email: v.email, produto: v.produto, data_hora: v.data_hora,
    ofertaNome: v.oferta_nome, precoBase: v.preco_base,
    entregues: e.entreguesPorVenda[v.id] ?? 0,
    pacotePaiId: v.pacote_pai_id,
  })
  // Lançamento manual fica FORA da regra da oferta - e por isso também fora da
  // proposta de juntar. Oferecer o "é o mesmo pacote" aqui ligava as duas
  // vendas de verdade, mas a quantidade enviada continuava a do palpite por
  // preço, IGNORANDO a irmã: o mesmo C1 de antes, vivo pelo caminho manual.
  const candidata = ehLancamentoManual(venda.id) ? null : candidataAoMesmoPacote({
    venda: paraCandidata(venda),
    outras: [...e.pendentes, ...e.ativos].map(paraCandidata),
  })

  // A resposta só vale para a venda em que foi dada. Sem o carimbo, ela vazava
  // para a próxima venda agendada na mesma sessão de página.
  const respostaEfetiva = e.resposta && e.resposta.saleId === venda.id ? e.resposta.valor : null

  // Lançamento manual fica de fora da regra da oferta: são 34 nos últimos 90
  // dias, e aplicá-la ali deixaria essas vendas impossíveis de agendar.
  if (ehLancamentoManual(venda.id)) {
    return { candidata, confere: null, numeroDeSessoes: null, travado: false, respostaEfetiva, tipoAResponder: null }
  }

  // As irmãs saem de `filhas`, a ÚNICA lista que contém venda ligada a outro
  // pacote: ela sai de Pendentes por definição e não entra em Ativos.
  const irmas = e.filhas.filter(v => v.pacote_pai_id === venda.id)
  // A candidata que o comercial ACABOU de confirmar entra na conta agora: o
  // link e o agendamento acontecem no mesmo clique, e esperar o recarregamento
  // fazia o pacote de 8 ser agendado com 4.
  //
  // `jaEstaNasIrmas` evita contar a mesma compra duas vezes. Quando o
  // agendamento falha depois de a resposta ter sido gravada, a tela recarrega
  // (a ligação já existe no banco) e a candidata passa a chegar TAMBÉM por
  // `filhas`. Sem esta guarda, a segunda tentativa somava 4 + 4 + 4 e pedia 12
  // sessões num pacote de 8.
  const jaEstaNasIrmas = !!candidata && irmas.some(v => v.id === candidata.id)
  const confirmada = respostaEfetiva === 'mesmo_pacote' && candidata && !jaEstaNasIrmas
    ? [{ ofertaNome: candidata.ofertaNome, precoBase: candidata.precoBase }]
    : []
  const tabela: 'pedro' | 'denise' = venda.produto.toLowerCase().includes('denise') ? 'denise' : 'pedro'
  const confere = conferirQuantidade({
    vendas: [
      ...[venda, ...irmas].map(v => ({ ofertaNome: v.oferta_nome, precoBase: v.preco_base })),
      ...confirmada,
    ],
    tabela,
  })

  // `indeterminado` NÃO vira 1: o palpite antigo daria ao paciente uma sessão
  // onde ele comprou quatro ou oito. 0 é sinal, e o botão fica travado.
  const numeroDeSessoes = confere.situacao === 'indeterminado' ? 0 : confere.sessoes
  const travado = confere.situacao === 'indeterminado'

  // "É o mesmo pacote" sem candidata não tem o que gravar: não há ligação nova
  // a criar. É o estado da SEGUNDA tentativa - a primeira gravou o link, a
  // irmã saiu de Pendentes e entrou em `filhas`, e por isso
  // `candidataAoMesmoPacote` já não a encontra. Antes, um agendamento que
  // falhava e era repetido gravava uma segunda `ocorrencias_pacote`, uma
  // segunda nota de prontuário e uma segunda linha de log dizendo a mesma
  // coisa: o CEO via a mesma junção duas vezes na conferência e não tinha como
  // saber se foram dois eventos ou um repetido.
  const nadaNovoALigar = respostaEfetiva === 'mesmo_pacote' && !candidata
  const tipoAResponder = e.ehRetryDeCompromisso || nadaNovoALigar
    ? null
    : respostaEfetiva ?? (confere.situacao === 'valor_divergente' ? 'valor_divergente' as const : null)

  return { candidata, confere, numeroDeSessoes, travado, respostaEfetiva, tipoAResponder }
}
