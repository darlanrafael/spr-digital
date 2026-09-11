import type { Sale } from '@/types'
import { ehDiagnosticoGuiado } from './vendas-por-situacao'

// O formato vem da OFERTA da Hubla, nunca do preco nem do nome.
//
// Nome: identico nos tres formatos.
// Preco: nao serve de identificador. Conferido nas 7 vendas reais,
// valor_pago_cliente e preco_base sao iguais em todas do mesmo formato
// (4997 no F1), mas valor_com_juros e valor_liquido variam com parcelamento -
// Francisco fechou 6.201,72 com juros e Bruno 4.997,00 no mesmo Formato 1, e a
// Paula 5.813,20. Filtrar por qualquer campo de valor quebra: os de juros
// variam por venda, e preco_base quebra com cupom ou promocao.
// Oferta: estavel. Na Hubla o order_id e "{idDaFatura}-{idDaOferta}".
//
// Aceita varios IDs por formato de proposito: uma oferta nova (promocao, outra
// turma) nasce com ID diferente e precisa caber sem trocar codigo.
export const OFERTAS_DIAGNOSTICO: Record<string, 1 | 2 | 3> = {
  WXwmPZfJxGqeXerA6dkO: 1,
  H8DA8U21x7Lmv3NreVMs: 2,
  qVvads7GKaI7lN1Kctrr: 3,
}

// Vendas avulsas que sao Diagnostico apesar da oferta dizer outra coisa.
//
// A chave e a VENDA, nunca a oferta. Uma oferta e um link reutilizavel: quando
// o comercial fecha um Diagnostico por engano dentro de outro produto, mapear
// aquela oferta declararia que ela SIGNIFICA Diagnostico, e a proxima venda
// legitima feita pelo mesmo link viraria um pacote de 9 sessoes com a Denise,
// em silencio. A excecao morre com a venda que a originou.
//
// Cada entrada precisa de: quem, quando, por que, e quem confirmou.
export const EXCECOES_DIAGNOSTICO: Record<string, 1 | 2 | 3> = {
  // Paula Caroline, 28/08/2026, R$ 4.997. O Felipe criou uma oferta dentro do
  // produto "Mentoria Particular - Pedro Roncada" (4pv79AgzdiRoWeLm5gyT) e
  // fechou o Diagnostico por ela. Formato confirmado pelo usuario em
  // 02/09/2026 - a oferta nao diz nada aqui, e o preco nao serve de
  // identificador (ela tem valor_com_juros de R$ 5.813,20).
  '27a669a3-dad9-4c8f-ae93-bca82bb13e90': 1,
}

// A oferta "Padrao" (wd6AwMQIJGAekPCGCRsb, R$ 10,00) existe no mesmo produto e
// NAO e mapeada de proposito: nao corresponde a formato nenhum. Compra por ela
// cai no aviso de oferta desconhecida em vez de montar um pacote errado.

/** Regra do PRODUTO, nao da terapeuta: nos demais produtos a Denise segue com os 30%. */
export const PAGAMENTO_DENISE_POR_SESSAO = 95

/**
 * Quantas sessoes cada formato tem, e quantas sao do Pedro.
 *
 * Exportado desde 09/09/2026 porque o lancamento manual passou a perguntar o
 * FORMATO em vez da quantidade: a quantidade e a divisao entre os dois
 * terapeutas saem daqui, nao da escolha de quem lanca.
 */
export const SESSOES_POR_FORMATO_PUBLICO: Record<1 | 2 | 3, { totalSessoes: number; sessoesPedro: number }> = {
  1: { totalSessoes: 9, sessoesPedro: 2 },
  2: { totalSessoes: 4, sessoesPedro: 1 },
  3: { totalSessoes: 2, sessoesPedro: 1 },
}

const SESSOES_POR_FORMATO: Record<1 | 2 | 3, { totalSessoes: number; sessoesPedro: number }> = {
  1: { totalSessoes: 9, sessoesPedro: 2 },
  2: { totalSessoes: 4, sessoesPedro: 1 },
  3: { totalSessoes: 2, sessoesPedro: 1 },
}

export type FormatoDiagnostico = { formato: 1 | 2 | 3; totalSessoes: number; sessoesPedro: number }

/** order_id da Hubla e "{uuidDaFatura}-{idDaOferta}". Devolve so a oferta. */
export function ofertaDoOrderId(orderId?: string | null): string | null {
  if (!orderId) return null
  const partes = String(orderId).split('-')
  return partes.length > 5 ? partes.slice(5).join('-') : null
}

/**
 * O formato lido do NOME da oferta.
 *
 * Existe por causa da Kiwify. O `order_id` dela e so o numero do pedido - a
 * oferta nao vai grudada nele como na Hubla, e nunca vai. `ofertaDoOrderId`
 * devolve null para toda venda da Kiwify, entao o caminho do ID nao tem como
 * funcionar ali.
 *
 * Caso real: Ibraim Djalma Melo Costa, 09/09/2026, primeira venda de
 * Diagnostico Guiado pela Kiwify. `oferta_nome` dizia "FORMATO 2" e a tela
 * mostrava "Oferta nao mapeada" - e mostraria em toda venda da Kiwify daqui
 * pra frente.
 *
 * A leitura e ESTRITA de proposito: so casa "formato" seguido de 1, 2 ou 3.
 * Um nome que nao diga o formato com essas letras devolve null e cai no aviso,
 * que e o comportamento certo - melhor recusar do que montar um pacote de 9
 * sessoes por causa de um numero solto no meio do texto.
 */
export function formatoDoNomeDaOferta(ofertaNome?: string | null): 1 | 2 | 3 | null {
  if (!ofertaNome) return null
  const m = ofertaNome.toLowerCase().match(/formato\s*0*([123])(?![0-9])/)
  if (!m) return null
  return Number(m[1]) as 1 | 2 | 3
}

export function formatoDaVenda(
  // `order_id` aceita null porque e o que o banco devolve em venda da Kiwify e
  // em lancamento manual. O tipo `Sale` declara so `string | undefined`, e por
  // causa disso as rotas chamavam esta funcao com `as` - cast que existia para
  // agradar o compilador e que escondia de quais campos a funcao depende.
  sale: Pick<Sale, 'id'> & { order_id?: string | null; oferta_nome?: string | null; produto?: string | null },
): FormatoDiagnostico | null {
  // Excecao por venda vem primeiro: e o unico caso em que a oferta esta errada
  // e nao ha o que consultar nela.
  const excecao = sale.id ? EXCECOES_DIAGNOSTICO[sale.id] : undefined
  if (excecao) return { formato: excecao, ...SESSOES_POR_FORMATO[excecao] }

  // O ID da oferta continua sendo o caminho principal: na Hubla ele e estavel
  // e nao depende de ninguem escrever o nome direito.
  const oferta = ofertaDoOrderId(sale.order_id)
  const porId = oferta ? OFERTAS_DIAGNOSTICO[oferta] : undefined
  if (porId) return { formato: porId, ...SESSOES_POR_FORMATO[porId] }

  // Sem ID que resolva, vale o NOME da oferta - mas SO no produto do
  // Diagnostico.
  //
  // A trava do produto foi acrescentada em 10/09/2026, depois de um defeito em
  // producao que eu mesmo causei em 09/09. Caso real: AMANDA ALVES MACHADO
  // CAVALLINI, produto "Mentoria Particular - Pedro | Denise", oferta
  // "Formato 2 - 4 Sessoes". A leitura pelo nome casou "Formato 2" e a tela
  // passou a chamar de Diagnostico uma Mentoria da Denise.
  //
  // O produto conjunto usa "Formato N" no nome da oferta com outro
  // significado: ali o N e o codigo do pacote e a QUANTIDADE vem escrita ao
  // lado ("Formato 2 - 2 Sessoes" sao DUAS). Sao dois vocabularios diferentes
  // que colidem na mesma palavra, e nenhum dos dois vai mudar.
  //
  // Sete vendas leram errado: 4x "Formato 2 - 4 Sessoes", 2x "Formato 2 -
  // 2 Sessoes" (que virariam 4 sessoes) e 1x "Formato 1 - Sessao Unica" (que
  // viraria NOVE). Nenhuma tinha sido agendada depois do defeito, entao nao
  // houve dano - o que existiu foi um dia de janela.
  //
  // Quem chama isto precisa trazer `produto` na consulta. Sem ele o caminho do
  // nome nao vale, e uma venda de Diagnostico da Kiwify volta a cair no aviso
  // de oferta desconhecida. O caminho do ID nao depende do produto e segue
  // valendo para toda venda da Hubla.
  const porNome = ehDiagnosticoGuiado(sale.produto ?? '') ? formatoDoNomeDaOferta(sale.oferta_nome) : null
  if (porNome) return { formato: porNome, ...SESSOES_POR_FORMATO[porNome] }

  return null
}

export type SessaoDoPacote = {
  numero_sessao: number
  terapeuta_id: string
  data_agendada: string
  comissao_valor: number
}

const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Monta o pacote inteiro a partir de UMA data. O Pedro sempre comeca; a Denise
 * pega o restante. Os 7 dias valem entre todas as sessoes, inclusive na virada
 * de um terapeuta para o outro.
 */
export function montarPacote(params: {
  formato: FormatoDiagnostico
  primeiraDataISO: string
  pedroId: string
  deniseId: string
  /**
   * Datas escolhidas a mao pelo comercial, uma por sessao, na ordem.
   *
   * A regua de 7 dias e o PADRAO, nao uma amarra: o comercial precisa poder
   * acomodar viagem, feriado e indisponibilidade do paciente (decisao do
   * usuario em 02/09/2026, depois de ver a tela funcionando). Quando vem
   * preenchido, manda; quando nao vem, o pacote sai na regua a partir da
   * primeira data.
   *
   * O que NAO e negociavel, e por isso nao entra aqui: a QUANTIDADE de sessoes
   * e QUEM atende cada uma. As duas sao derivadas do formato, e deixar o
   * comercial mexer nelas criaria pacote que o resto do sistema (comissao da
   * Denise, etiqueta de progresso, empurrar as seguintes) nao sabe interpretar.
   */
  datasISO?: string[] | null
}): SessaoDoPacote[] {
  const { formato, primeiraDataISO, pedroId, deniseId, datasISO } = params
  const inicio = new Date(primeiraDataISO).getTime()
  // So aceita a lista se ela cobrir o pacote inteiro. Lista parcial cairia em
  // `undefined` numa das sessoes e gravaria data invalida.
  const explicitas = datasISO && datasISO.length === formato.totalSessoes ? datasISO : null

  return Array.from({ length: formato.totalSessoes }, (_, i) => {
    const doPedro = i < formato.sessoesPedro
    return {
      numero_sessao: i + 1,
      terapeuta_id: doPedro ? pedroId : deniseId,
      data_agendada: explicitas ? explicitas[i] : new Date(inicio + i * SETE_DIAS_MS).toISOString(),
      comissao_valor: doPedro ? 0 : PAGAMENTO_DENISE_POR_SESSAO,
    }
  })
}

export type AvisosDasDatas = {
  /** Sessoes cujo intervalo em relacao a anterior nao e de 7 dias. */
  foraDaRegua: number[]
  /** Sessoes com data ANTERIOR a da sessao de numero menor. Quase sempre erro de digitacao. */
  foraDeOrdem: number[]
  /** Sessoes com data vazia ou impossivel de interpretar. */
  invalidas: number[]
  /**
   * Sessoes que caem em cima de outra do proprio pacote - mesmo horario ou
   * perto demais para caber uma consulta.
   */
  duplicadas: number[]
}

/**
 * Distancia minima entre duas sessoes do mesmo pacote para elas nao se
 * sobreporem, em minutos.
 *
 * A trava de conflito da agenda compara sobreposicao de intervalo, mas ignora
 * as sessoes da propria venda (`ignorarSaleId`), entao as datas de um pacote
 * novo nunca sao comparadas entre si. Comparar so igualdade exata deixava
 * passar o caso real: a Denise atende 60 minutos e nao tem grade de horarios,
 * entao marcar as sessoes 8 e 9 as 14:00 e 14:30 do mesmo dia empilha duas
 * consultas na agenda dela e manda dois convites sobrepostos ao paciente.
 *
 * 60 minutos e a duracao cadastrada da Denise, que e quem atende a maioria das
 * sessoes do pacote. E limite de AVISO, nao de agenda: a checagem real, com a
 * duracao de cada terapeuta, continua sendo a da rota.
 */
export const MINUTOS_MINIMOS_ENTRE_SESSOES = 60

/**
 * Avisos sobre as datas escolhidas a mao. Serve para a tela AVISAR, nunca para
 * bloquear: fora da regua e escolha legitima do comercial (decisao do usuario
 * em 02/09/2026). Os numeros devolvidos sao o `numero_sessao`, para a mensagem
 * poder dizer "a sessao 3".
 *
 * Recebe as datas como o campo `datetime-local` as entrega ("2026-09-02T14:20")
 * ou em ISO. Nao lanca em nenhuma entrada: campo vazio e string invalida saem
 * em `invalidas`. Isso e requisito, nao detalhe - esta funcao roda a cada
 * render do modal, e uma excecao aqui derruba a tela inteira e apaga tudo que o
 * comercial ja tinha digitado nas outras sessoes.
 */
export function avisosDasDatas(datas: (string | null | undefined)[]): AvisosDasDatas {
  const ms = datas.map(d => {
    if (!d) return NaN
    const t = new Date(d).getTime()
    return Number.isNaN(t) ? NaN : t
  })

  const invalidas: number[] = []
  const foraDaRegua: number[] = []
  const foraDeOrdem: number[] = []
  const duplicadas: number[] = []

  ms.forEach((t, i) => { if (Number.isNaN(t)) invalidas.push(i + 1) })

  for (let i = 1; i < ms.length; i++) {
    const a = ms[i - 1]
    const b = ms[i]
    if (Number.isNaN(a) || Number.isNaN(b)) continue
    if (b < a) { foraDeOrdem.push(i + 1); continue }
    // Compara por DIA e nao por milissegundo: mudar so o horario de uma sessao
    // ("essa fica 15h em vez de 14h") e o ajuste mais comum e nao deveria
    // disparar o alerta de intervalo, que existe para sinalizar mudanca de
    // DIAS. Comparacao exata fazia 7d+1h virar aviso.
    if (Math.round((b - a) / (24 * 60 * 60 * 1000)) !== 7) foraDaRegua.push(i + 1)
  }

  // Mesmo horario dentro do proprio pacote. A trava de conflito da rota olha so
  // o banco e ignora as sessoes desta venda, entao duas datas iguais do pacote
  // novo passariam batido: o paciente receberia dois convites para o mesmo
  // horario e a terapeuta veria duas consultas empilhadas.
  const minimoMs = MINUTOS_MINIMOS_ENTRE_SESSOES * 60 * 1000
  const validas = ms.map((t, i) => ({ t, numero: i + 1 })).filter(x => !Number.isNaN(x.t))
  for (const x of validas) {
    const colide = validas.some(y => y.numero < x.numero && Math.abs(x.t - y.t) < minimoMs)
    if (colide) duplicadas.push(x.numero)
  }

  return { foraDaRegua, foraDeOrdem, invalidas, duplicadas }
}

/**
 * Diz se mover uma sessao para `novaDataISO` deixa menos de 7 dias entre ela e
 * a sessao anterior ou a seguinte do mesmo pacote. Nao decide nada: quem decide
 * e o comercial, na tela.
 */
export function quebraIntervalo(params: {
  novaDataISO: string
  anteriorISO?: string
  seguinteISO?: string
}): boolean {
  const nova = new Date(params.novaDataISO).getTime()
  if (params.anteriorISO) {
    if (nova - new Date(params.anteriorISO).getTime() < SETE_DIAS_MS) return true
  }
  if (params.seguinteISO) {
    if (new Date(params.seguinteISO).getTime() - nova < SETE_DIAS_MS) return true
  }
  return false
}

/**
 * Datas das sessoes seguintes quando o comercial escolhe empurrar a cadeia.
 * A base e a data NOVA da sessao remarcada, que ja foi salva: por isso ela
 * nunca aparece no resultado.
 */
export function novasDatasSeguintes(params: { baseISO: string; quantidade: number }): string[] {
  const base = new Date(params.baseISO).getTime()
  return Array.from({ length: Math.max(0, params.quantidade) }, (_, i) =>
    new Date(base + (i + 1) * SETE_DIAS_MS).toISOString())
}
