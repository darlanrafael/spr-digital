export type UserRole = 'admin' | 'gestor' | 'financeiro' | 'socio'
export type Platform = 'kiwify' | 'hubla'

export interface User {
  email: string
  name: string
  role: UserRole
  projetoId?: string
}

export interface Project {
  id: string
  nome: string
  descricao: string
  ativo: boolean
  gestorId: string
  cor: string
}

export interface Product {
  id: string
  nome: string
  plataforma: Platform
  projetoId: string
  preco: number
}

export type SaleStatus = 'aprovada' | 'reembolsada' | 'chargeback' | 'cancelada' | 'em_protesto'

export interface Sale {
  id: string
  nome: string
  email: string
  telefone: string
  cpf?: string
  produto: string
  plataforma: Platform
  plataforma_sale_id?: string
  /** "{idDaFatura}-{idDoProduto}" — duas linhas da mesma fatura compartilham
   *  o prefixo do UUID. Usado pela conferência do fechamento. */
  order_id?: string
  /**
   * Nome da oferta na plataforma ("Formato - 4 Sessão"). Fonte da QUANTIDADE de
   * sessões do pacote - regra do negócio, não escolha de quem agenda.
   */
  oferta_nome?: string | null
  /**
   * Venda que carrega as sessões deste pacote. Preenchido quando o paciente
   * pagou o mesmo pacote em mais de uma compra; venda com este campo não entra
   * em Pendentes de Agendamento.
   */
  pacote_pai_id?: string | null
  preco_base: number
  valor_pago_cliente: number
  valor_com_juros?: number
  valor_liquido: number
  data_hora: string
  utm_source: string
  utm_medium: string
  utm_campaign: string
  utm_content: string
  utm_term: string
  status: SaleStatus
  projetoId: string
  data_reembolso?: string
}

export interface FixedCost {
  id: string
  descricao: string
  valor: number
  data: string
  fechamentoId: string | null
}

export interface VariableCost {
  id: string
  descricao: string
  valor: number
  data: string
  projetoId: string | null
  fechamentoId: string | null
}

export interface MetaAdsEntry {
  mes: string
  valor: number
  projetoId: string
}

export interface CostsData {
  fixos: FixedCost[]
  variaveis: VariableCost[]
  metaAds: MetaAdsEntry[]
}

export interface ClosingBuyer {
  id: string
  nome: string
  email: string
  cpf: string
  telefone?: string
  produto: string
  plataforma?: string
  valor: number
  valor_bruto?: number
  valor_liquido?: number
  data_hora?: string
  status: 'ok' | 'reembolso' | 'chargeback'
  dataReembolso?: string
}

export interface ClosingAlert {
  /** id da venda em `sales` — usado para não deduzir o mesmo estorno duas vezes */
  saleId?: string
  /**
   * id em `solicitacoes_reembolso`, presente só no reembolso PARCIAL aprovado.
   * É ele, e não o saleId, que identifica esse alerta: a mesma venda pode ter
   * um reembolso parcial hoje e ser estornada por inteiro depois, e os dois
   * precisam poder ser deduzidos, cada um uma vez só.
   */
  solicitacaoId?: string
  compradorId?: string
  nome: string
  telefone?: string
  email?: string
  produto: string
  valor: number
  tipo?: 'reembolso' | 'chargeback' | 'reembolso_parcial'
  data: string
}

export interface Socio {
  nome: string
  percentual: number
  valor: number
  repasse_original?: number
  deducoes?: number
  repasse_final?: number
}

export interface ClosingProductRow {
  nome: string
  plataforma: string
  qtd: number
  bruto: number
  taxas: number
  aliquota: number
  imposto: number
  liquido: number
  terapeuta_nome?: string
  repasse_terapeuta?: number
}

export interface Closing {
  id: string
  /** Nome curto dado pelo usuário ao fechar. Ex: "IAR Julho" */
  etiqueta?: string
  /** Chave da paleta em lib/etiqueta-fechamento.ts */
  etiqueta_cor?: string
  data: string
  data_confirmacao?: string
  periodo: { inicio: string; fim: string }
  produtos_incluidos?: string[]
  faturamentoBruto: number
  impostos: number
  taxasPlataforma: number
  faturamentoLiquido: number
  custosTotais: number
  custos_fixos_total?: number
  custos_variaveis_total?: number
  lucroBruto: number
  reservaCaixa: number
  lucroReal: number
  socios: Socio[]
  compradores: ClosingBuyer[]
  alertas: ClosingAlert[]
  byProduct?: ClosingProductRow[]
  custos_trafego_total?: number
  custos_trafego_periodo?: { inicio: string; fim: string }
  custos_trafego_termos?: string[]
  custos_trafego_campanhas?: { name: string; spend: number; accountId: string }[]
  produtos_periodos?: { inicio: string; fim: string; produtos: string[] }[]
  custos_funil_total?: number
  custos_funil_itens?: { descricao: string; valor: number }[]
  repasseTerapeutasTotal?: number
}

export type CashflowType = 'entrada_manual' | 'entrada_automatica' | 'saida_reembolso' | 'saida_manual'

export interface CashflowEntry {
  id: string
  data: string
  descricao: string
  origem: string
  tipo: CashflowType
  valor: number
  saldoAcumulado: number
}
