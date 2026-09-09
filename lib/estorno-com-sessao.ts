// Venda estornada NA PLATAFORMA que ainda tem sessão futura marcada.
//
// O buraco: quando o reembolso é pedido pela nossa tela e o CEO aprova, as
// sessões futuras são canceladas e os convites do Google retirados. Quando o
// estorno vem de fora - o cliente pede reembolso na Hubla/Kiwify, ou dá
// chargeback dias depois - o webhook só troca o `status` da venda. A sessão
// continua marcada, o convite continua ativo, o lembrete de WhatsApp continua
// saindo, e ninguém é avisado.
//
// Caso que motivou (09/09/2026): Cris Polonine, venda marcada como reembolsada
// desde 11/08, com sessão marcada para 15/09 e convite ativo.
//
// TRÊS FILTROS, e cada um existe por um caso real desta base:
//
//   1. LANÇAMENTO MANUAL nunca conta. Ele não vem de plataforma nenhuma, então
//      não existe estorno de verdade nele. Na base, um manual foi marcado como
//      "reembolsada" à mão só para sinalizar que não era venda real - alertar
//      ali seria alarme falso puro.
//
//   2. PACIENTE COM OUTRA VENDA APROVADA não gera alerta. A Cris pagou no
//      cartão, achou o juro alto, foi reembolsada e pagou por PIX 21 minutos
//      depois. As duas coisas são verdade ao mesmo tempo: tem estorno e tem
//      pagamento. Alertar aqui treinaria todo mundo a ignorar o alerta.
//
//   3. O CORTE do terapeuta não entra aqui. Uma venda anterior ao corte é
//      invisível em Pendentes de propósito, mas se ela tem sessão futura e foi
//      estornada, o problema é real e precisa aparecer.

export type VendaParaAlerta = {
  id: string
  nome: string
  email: string | null
  produto: string
  status: string | null
  valor_pago_cliente: number | null
  data_reembolso: string | null
}

export type SessaoParaAlerta = {
  id: string
  sale_id: string
  data_agendada: string | null
  status: string
}

export type AlertaEstorno = {
  saleId: string
  nome: string
  email: string | null
  produto: string
  status: string
  valor: number
  dataReembolso: string | null
  /** Sessões futuras ainda ativas, da mais próxima para a mais distante. */
  sessoes: { id: string; dataISO: string }[]
}

/** Estornos que vêm da plataforma. Cancelamento fica de fora: é correção de faturamento, não devolução. */
export const ESTORNOS_DE_PLATAFORMA = ['reembolsada', 'chargeback', 'em_protesto']

export function ehLancamentoManual(saleId: string): boolean {
  return saleId.startsWith('manual_')
}

/** A sessão ainda vai acontecer: está no futuro e não foi entregue nem cancelada. */
function aindaVaiAcontecer(s: SessaoParaAlerta, agoraISO: string): boolean {
  if (!s.data_agendada) return false
  if (!['agendada', 'pendente'].includes(s.status)) return false
  return s.data_agendada > agoraISO
}

export function alertasDeEstornoComSessao(params: {
  vendas: VendaParaAlerta[]
  sessoes: SessaoParaAlerta[]
  agoraISO: string
}): AlertaEstorno[] {
  const { vendas, sessoes, agoraISO } = params

  // Quem tem alguma venda aprovada. A chave é o e-mail: é o que identifica a
  // pessoa entre compras diferentes, e é o mesmo critério que o resto do
  // sistema usa para juntar vendas de um paciente.
  const comVendaAprovada = new Set(
    vendas
      .filter(v => (!v.status || v.status === 'aprovada') && !ehLancamentoManual(v.id))
      .map(v => (v.email ?? '').trim().toLowerCase())
      .filter(Boolean),
  )

  const porVenda = new Map<string, SessaoParaAlerta[]>()
  for (const s of sessoes) {
    if (!aindaVaiAcontecer(s, agoraISO)) continue
    const lista = porVenda.get(s.sale_id)
    if (lista) lista.push(s)
    else porVenda.set(s.sale_id, [s])
  }

  const achados: AlertaEstorno[] = []
  for (const v of vendas) {
    if (!ESTORNOS_DE_PLATAFORMA.includes(v.status ?? '')) continue
    if (ehLancamentoManual(v.id)) continue
    if (comVendaAprovada.has((v.email ?? '').trim().toLowerCase())) continue

    const futuras = porVenda.get(v.id)
    if (!futuras || futuras.length === 0) continue

    achados.push({
      saleId: v.id,
      nome: v.nome,
      email: v.email,
      produto: v.produto,
      status: v.status as string,
      valor: v.valor_pago_cliente ?? 0,
      dataReembolso: v.data_reembolso,
      sessoes: futuras
        .map(s => ({ id: s.id, dataISO: s.data_agendada as string }))
        .sort((a, b) => a.dataISO.localeCompare(b.dataISO)),
    })
  }

  // A sessão mais próxima primeiro: é a que precisa de decisão hoje.
  return achados.sort((a, b) => a.sessoes[0].dataISO.localeCompare(b.sessoes[0].dataISO))
}

/**
 * Os `sale_id` cujo lembrete de WhatsApp deve ser segurado.
 *
 * Mandar lembrete para quem pediu o dinheiro de volta é o pior dos dois erros
 * possíveis: deixar de mandar para alguém que vai comparecer é recuperável com
 * uma mensagem; mandar para quem estornou é constrangimento com o cliente e
 * com o terapeuta.
 */
export function vendasComLembreteSuspenso(params: {
  vendas: VendaParaAlerta[]
  sessoes: SessaoParaAlerta[]
  agoraISO: string
}): Set<string> {
  return new Set(alertasDeEstornoComSessao(params).map(a => a.saleId))
}
