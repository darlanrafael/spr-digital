'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  CheckCircle, RefreshCw, ArrowLeft, X, AlertTriangle,
  Users, Clock, TrendingUp, Award, Calendar, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Download,
  DollarSign, Receipt, Percent, Copy, Check, Play, Ban, ClipboardList,
} from 'lucide-react'
import Link from 'next/link'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import SenhaModal from '@/components/SenhaModal'
import Pagination from '@/components/Pagination'
import AgendaDiaTerapeuta, {
  SessaoDia, CompromissoDia, Ocupado,
  contarSlotsLivres, calcularIntervalosLivres, fmtDuracao, minutosDoDia,
  JANELA_INICIO_MIN, JANELA_FIM_MIN,
} from '@/components/terapeutas/AgendaDiaTerapeuta'
import { fimEfetivoSessao } from '@/lib/agenda-horarios'
import { getSupabaseClient } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { formatoDaVenda } from '@/lib/diagnostico-guiado'
import { rotuloDiagnostico } from '@/lib/etiqueta-diagnostico'
import { ehPendenteDeAgendamento } from '@/lib/vendas-por-situacao'

// Dados ao vivo — sem isso a Vercel cacheia a página como estática e serve
// versões antigas do CDN mesmo depois de um deploy novo.
export const dynamic = 'force-dynamic'

type Terapeuta = {
  id: string
  nome: string
  email: string
  percentual_comissao: number
  vendas_a_partir_de: string | null
  duracao_sessao_minutos: number
  horarios_fixos: string[]
}

type Sessao = {
  id: string
  sale_id: string
  numero_sessao: number
  total_sessoes: number
  status: string
  status_consulta: string | null
  data_agendada: string | null
  data_entrega: string | null
  link_meet: string | null
  comissao_valor: number
  comissao_paga: boolean
  paciente_nome: string
  paciente_email: string
  entregue_confirmado_por: string | null
  iniciado_em: string | null
  concluido_em: string | null
  vendedor_nome: string | null
  agendado_por: string | null
}

type SaleInfo = {
  id: string
  nome: string
  email: string
  telefone: string | null
  produto: string
  plataforma: string | null
  valor_pago_cliente: number
  valor_liquido: number
  data_hora: string
  status: string | null
  // Precisa vir em toda consulta que popular SaleInfo - sem order_id,
  // formatoDaVenda() nunca reconhece um pacote do Diagnóstico Guiado e a
  // etiqueta simplesmente nunca aparece, sem erro nenhum. Tipo igual ao de
  // Sale ('@/types'): opcional sem null, pra formatoDaVenda() aceitar direto.
  order_id?: string
  /** Venda que carrega as sessões deste pacote, quando pago em mais de uma compra. */
  pacote_pai_id?: string | null
}

type Ocorrencia = {
  id: string
  sale_id: string
  sessao_id: string | null
  tipo: string
  titulo: string
  descricao: string
  criado_por_nome: string
  criado_por_tipo: string
  created_at: string
}

type Remarcacao = {
  id: string
  sessao_id: string
  sale_id: string
  paciente_nome: string
  remarcado_por_nome: string
  remarcado_por_tipo: string
  solicitado_por: string
  motivo: string
  data_anterior: string
  data_nova: string
  created_at: string
}

type FechamentoSessao = {
  id: string
  sale_id: string
  numero_sessao: number
  total_sessoes: number
  comissao_valor: number
  data_entrega: string | null
  paciente_nome: string
}

type FechamentoHistorico = {
  id: string
  terapeuta_id: string
  terapeuta_nome: string
  data_confirmacao: string
  valor_total: number
  quantidade_sessoes: number
  sessoes: FechamentoSessao[]
}

type PacienteAgrupado = {
  email: string
  nome: string
  saleIds: string[]
  sessoes: Sessao[]
  entregues: number
  total: number
  ativo: boolean
  bruto: number
  liquido: number
  vendedor: string
  dataCompraMaisRecente: string
}

type Preset = 'all' | 'today' | 'last_7d' | 'custom'

type Metricas = {
  sessoes_vendidas: number
  sessoes_entregues: number
  sessoes_futuras: number
  comissao_gerada: number
  comissao_total_vendida: number
  // Só usados na visão de terapeutas sem divisão de comissão (0%, ex: Pedro)
  faturamento_bruto: number
  faturamento_liquido_total: number
  total_impostos: number
  ticket_medio: number
  ticket_medio_sessao_entregue: number
}

const METRICAS_VAZIA: Metricas = {
  sessoes_vendidas: 0, sessoes_entregues: 0, sessoes_futuras: 0,
  comissao_gerada: 0, comissao_total_vendida: 0,
  faturamento_bruto: 0, faturamento_liquido_total: 0, total_impostos: 0,
  ticket_medio: 0, ticket_medio_sessao_entregue: 0,
}

type ConsultaHoje = {
  id: string
  horario: string
  data?: string
  paciente_nome: string
  paciente_email: string
  numero_sessao: number
  total_sessoes: number
  link_meet: string | null
  status: string
  status_consulta: string
  iniciado_em: string | null
  // Preenchido só quando a sessão faz parte de um pacote do Diagnóstico
  // Guiado; null pra sessão avulsa.
  rotulo_diagnostico?: string | null
  // Só preenchidos no quadrante "Consultas Entregues (hoje)" — os outros
  // dois quadrantes usam o mesmo tipo e nunca trazem sessão entregue.
  data_entrega?: string | null
  entregue_as?: string
  entregue_confirmado_por?: string | null
  duracao?: string
  dias_em_atraso?: number
}

const PRESET_LABELS: Record<Preset, string> = {
  all: 'Todo período',
  today: 'Hoje',
  last_7d: '7 dias',
  custom: 'Personalizado',
}

const STATUS_CONSULTA_BADGE: Record<string, { label: string; cls: string }> = {
  aguardando:     { label: 'Aguardando',    cls: 'text-amber-400 bg-amber-400/10' },
  em_atendimento: { label: 'Em atendimento', cls: 'text-blue-400 bg-blue-400/10 animate-pulse' },
  concluida:      { label: 'Concluída',     cls: 'text-green-500 bg-green-500/10' },
  cancelada:      { label: 'Cancelada',     cls: 'text-red-400 bg-red-400/10' },
  remarcada:      { label: 'Remarcada',     cls: 'text-purple-400 bg-purple-400/10' },
  nao_compareceu: { label: 'Não compareceu', cls: 'text-orange-400 bg-orange-400/10' },
}

function CronometroSessao({ iniciadoEm }: { iniciadoEm: string | null }) {
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    if (!iniciadoEm) return
    const interval = setInterval(() => setAgora(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [iniciadoEm])
  if (!iniciadoEm) return null
  const decorridoSeg = Math.max(0, Math.floor((agora - new Date(iniciadoEm).getTime()) / 1000))
  const h = Math.floor(decorridoSeg / 3600)
  const m = Math.floor((decorridoSeg % 3600) / 60)
  const s = decorridoSeg % 60
  const texto = h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return <span className="text-[10px] text-blue-300 font-mono tabular-nums">⏱ {texto}</span>
}

function LinkMeetCell({ id, link, copiadoId, onCopy }: { id: string; link: string | null; copiadoId: string | null; onCopy: (id: string, link: string) => void }) {
  if (!link) return <span className="text-gray-600">—</span>
  return (
    <div className="flex items-center gap-2">
      <a href={link} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">Abrir</a>
      <button onClick={() => onCopy(id, link)} className="text-gray-500 hover:text-white transition-colors" title="Copiar link">
        {copiadoId === id ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  )
}

function fmtBRL(n: number) {
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
// Valor em reais no formato BR ("2.500,00") tem ponto de milhar E vírgula
// decimal — trocar só a vírgula por ponto deixa "2.500.00", que o
// parseFloat lê até o segundo ponto e vira 2.5 (silencioso, sem erro, foi
// assim que "2500" lançado manualmente virava R$2,50 no prontuário).
function parseValorBR(val: string): number {
  return parseFloat(val.replace(/\./g, '').replace(',', '.')) || 0
}
function fmtDt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}
// Progresso e etiqueta do Diagnóstico Guiado pra uma linha que representa o
// PACIENTE inteiro (aba Vendas: Pendentes/Ativos/Concluídos/Reembolsados).
//
// O total vem SEMPRE do formato (2, 4 ou 9) e as entregues SEMPRE das sessões
// daquele sale_id no pacote inteiro - nunca do agregado por e-mail. O agregado
// soma todas as vendas do paciente com ESTE terapeuta, e as sessões carregadas
// nesta tela são só as dele: quando o Pedro entregava as 2 sessões dele de um
// Formato 1, a linha mostrava "sessão 2 de 2", barra em 100% e "Concluído",
// com 7 sessões ainda por fazer com a Denise. O mesmo agregado também errava
// quando o paciente tinha dois pacotes ao mesmo tempo.
function progressoDiagnostico(
  sale: SaleInfo | undefined,
  sessoesDoPacote: { status: string }[] | undefined,
): { formato: 1 | 2 | 3; entregues: number; total: number; rotulo: string } | null {
  if (!sale) return null
  const formato = formatoDaVenda(sale)
  if (!formato) return null
  const total = formato.totalSessoes
  const entregues = (sessoesDoPacote ?? []).filter(s => s.status === 'entregue').length
  const numeroSessao = Math.min(entregues + 1, total)
  return {
    formato: formato.formato,
    entregues,
    total,
    rotulo: rotuloDiagnostico({ formato: formato.formato, numeroSessao, totalSessoes: total }),
  }
}

// Venda do produto Diagnóstico Guiado cuja OFERTA não está mapeada em
// OFERTAS_DIAGNOSTICO (oferta nova, promoção, ou a oferta "Padrão" de R$ 10,00
// que existe no mesmo produto de propósito). A spec manda deixá-la pendente com
// um aviso pedindo a associação - antes ela era descartada em silêncio e
// simplesmente sumia da tela, sem ninguém saber que existia.
function ofertaDiagnosticoNaoMapeada(sale: SaleInfo | undefined): boolean {
  if (!sale) return false
  return sale.produto.toLowerCase().includes('diagnóstico guiado') && !formatoDaVenda(sale)
}
const FECHAMENTO_SESSOES_PAGE_SIZE = 12
function exportFechamentoCSV(f: FechamentoHistorico) {
  const header = 'Paciente,Sessão,Total sessões,Data entrega,Comissão'
  const rows = f.sessoes.map(s =>
    `"${s.paciente_nome}",${s.numero_sessao},${s.total_sessoes},"${s.data_entrega ?? ''}",${s.comissao_valor}`
  )
  const csv = '﻿' + [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `fechamento-${f.data_confirmacao.slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
function nowForDatetimeLocal(): string {
  return dateToDatetimeLocal(new Date())
}
function agendaDiaParam(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function parseAgendaDiaParam(v: string | null): Date | null {
  if (!v) return null
  const d = new Date(v + 'T00:00:00')
  return isNaN(d.getTime()) ? null : d
}
function dateToDatetimeLocal(date: Date): string {
  const d = new Date(date)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

// data_agendada vem do banco em UTC. Pra pré-preencher um <input
// type="datetime-local"> mostrando o horário real de Brasília, precisa
// converter (UTC-3, sem horário de verão) — só cortar a string UTC mostra a
// hora errada no formulário de remarcar.
function isoToDatetimeLocalBRT(iso: string): string {
  const brt = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000)
  return brt.toISOString().slice(0, 16)
}

function noPeriodo(dataIso: string, preset: Preset, dateStart: string, dateEnd: string): boolean {
  if (preset === 'custom') {
    if (!dateStart || !dateEnd) return true
    const d = dataIso.slice(0, 10)
    return d >= dateStart && d <= dateEnd
  }
  const now = new Date()
  const d = new Date(dataIso)
  switch (preset) {
    case 'today': return d.toDateString() === now.toDateString()
    case 'last_7d': { const diffDays = (now.getTime() - d.getTime()) / 86400000; return diffDays >= 0 && diffDays <= 7 }
    case 'all': return true
    default: return true
  }
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pendente: { label: 'Pendente', color: 'text-amber-400 bg-amber-400/10' },
  agendada: { label: 'Agendada', color: 'text-blue-400 bg-blue-400/10' },
  entregue: { label: 'Entregue', color: 'text-green-500 bg-green-500/10' },
  cancelada: { label: 'Cancelada', color: 'text-red-400 bg-red-400/10' },
  remarcada: { label: 'Remarcada', color: 'text-purple-400 bg-purple-400/10' },
}

const STATUS_REEMBOLSO = ['reembolsada', 'chargeback', 'cancelada', 'em_protesto']

const OCORRENCIA_META: Record<string, { icon: string; label: string; cls: string }> = {
  nota:                  { icon: '📝', label: 'Nota',                    cls: 'text-gray-400 bg-gray-400/10 border-gray-400/20' },
  remarcacao:            { icon: '📅', label: 'Remarcação',              cls: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20' },
  confirmacao_entrega:   { icon: '✅', label: 'Sessão Entregue',         cls: 'text-green-500 bg-green-500/10 border-green-500/20' },
  solicitacao_reembolso: { icon: '💰', label: 'Solicitação de Reembolso', cls: 'text-orange-400 bg-orange-400/10 border-orange-400/20' },
  reembolso_aprovado:    { icon: '✅', label: 'Reembolso Aprovado',      cls: 'text-green-500 bg-green-500/10 border-green-500/20' },
  reembolso_rejeitado:   { icon: '❌', label: 'Reembolso Rejeitado',     cls: 'text-red-400 bg-red-400/10 border-red-400/20' },
  orientacao_sessao:     { icon: '📣', label: 'Orientação da Sessão',    cls: 'text-blue-400 bg-blue-400/10 border-blue-400/20' },
  nao_compareceu:        { icon: '🚫', label: 'Não Compareceu',         cls: 'text-orange-400 bg-orange-400/10 border-orange-400/20' },
}

function calcularReembolsoLocal(params: {
  terapeuta_nome: string
  sessoes_total: number
  sessoes_feitas: number
  valor_pago: number
}): { valor_reembolso: number; explicacao: string } {
  const tabelaPedro: Record<number, number> = { 1: 1300, 2: 1550, 4: 2860, 8: 5280 }
  const tabelaDenise: Record<number, number> = { 1: 550, 2: 790, 4: 1400, 8: 2640 }
  const isPedro = params.terapeuta_nome.toLowerCase().includes('pedro')
  const tabela = isPedro ? tabelaPedro : tabelaDenise
  const planos = Object.keys(tabela).map(Number).sort((a, b) => a - b)
  if (params.sessoes_feitas === 0) {
    return { valor_reembolso: params.valor_pago, explicacao: `Nenhuma sessão realizada — reembolso integral de ${fmtBRL(params.valor_pago)}` }
  }
  if (params.sessoes_feitas >= params.sessoes_total) {
    return { valor_reembolso: 0, explicacao: 'Todas as sessões foram realizadas — sem reembolso' }
  }
  let plano_eq = 0, valor_eq = 0
  for (const p of planos) { if (p <= params.sessoes_feitas) { plano_eq = p; valor_eq = tabela[p] } }
  const valor_reembolso = Math.max(0, params.valor_pago - valor_eq)
  return {
    valor_reembolso,
    explicacao: `Comprou ${params.sessoes_total} sessão(ões) (${fmtBRL(params.valor_pago)}), realizou ${params.sessoes_feitas} sessão(ões) → equivale ao plano de ${plano_eq} sessão(ões) = ${fmtBRL(valor_eq)} → Reembolso: ${fmtBRL(valor_reembolso)}`,
  }
}

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MESES_NOME = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

type TerapeutaSession = {
  id: string
  nome: string
  email: string
  tipo: string
  terapeuta_id: string | null
  // Emitidos pelo login desde 06/08/2026. Sessões antigas guardadas no
  // navegador não têm — daí opcionais, e o comportamento nesse caso é o de
  // sempre (pede senha).
  token?: string
  dispensa_senha_nas_acoes?: boolean
}

// Próximas Consultas pagina de 8 em 8. O Pedro tem mais de 100 sessões
// futuras — a lista inteira virava um scroll sem fim no meio do Overview.
const PROXIMAS_POR_PAGINA = 8

const TERAPEUTA_TABS = ['overview', 'vendas', 'agenda', 'fechamentos'] as const
type TerapeutaTabType = typeof TERAPEUTA_TABS[number]
const VENDAS_SUBTABS = ['pendentes', 'ativos', 'concluidos', 'reembolsados'] as const
type VendasSubTabType = typeof VENDAS_SUBTABS[number]

export default function PainelTerapeuta() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const id = params.id as string

  const [terapeuta, setTerapeuta] = useState<Terapeuta | null>(null)
  const [outrasTerapeutas, setOutrasTerapeutas] = useState<{ id: string; nome: string }[]>([])
  const [sessoes, setSessoes] = useState<Sessao[]>([])
  const [vendas, setVendas] = useState<Record<string, SaleInfo>>({})
  // Sessões do PACOTE inteiro das vendas do Diagnóstico, de todos os
  // terapeutas. `sessoes` acima é filtrado por terapeuta_id, então sozinho ele
  // nunca enxerga o pacote completo (o Pedro só vê as dele, a Denise só as
  // dela) - e é disso que o progresso do Diagnóstico precisa.
  const [sessoesPacoteDiag, setSessoesPacoteDiag] = useState<Record<string, { numero_sessao: number; status: string }[]>>({})
  const [ocorrencias, setOcorrencias] = useState<Record<string, Ocorrencia[]>>({})
  const [remarcacoes, setRemarcacoes] = useState<Record<string, Remarcacao[]>>({})
  const [loading, setLoading] = useState(true)
  const [adminEmail, setAdminEmail] = useState('')
  const [isTerapeutaSession, setIsTerapeutaSession] = useState(false)
  const [sessionNome, setSessionNome] = useState('')
  const [sessionToken, setSessionToken] = useState('')
  // Só o login do módulo de terapeutas emite token. Quem cai aqui pelo
  // dashboard principal (spr_session) continua digitando senha — aquele
  // login é outro sistema de auth, contra outra tabela.
  const [dispensaSenha, setDispensaSenha] = useState(false)
  const [linkCopiadoId, setLinkCopiadoId] = useState<string | null>(null)

  async function copiarLinkMeet(id: string, link: string) {
    await navigator.clipboard.writeText(link)
    setLinkCopiadoId(id)
    setTimeout(() => setLinkCopiadoId(prev => prev === id ? null : prev), 1500)
  }

  // Modal status_consulta (iniciar / concluir / anular) — usado tanto na visão admin quanto na do terapeuta
  const [statusSessaoId, setStatusSessaoId] = useState<string | null>(null)
  const [statusAcao, setStatusAcao] = useState<'iniciar' | 'concluir' | 'anular' | 'nao_compareceu'>('iniciar')
  const [statusErro, setStatusErro] = useState('')
  const [statusLoading, setStatusLoading] = useState(false)
  const [anularMotivo, setAnularMotivo] = useState('')
  const [concluirData, setConcluirData] = useState('')

  // Modal remarcar — visão admin
  const [remarcarSessaoId, setRemarcarSessaoId] = useState<string | null>(null)
  const [remarcarData, setRemarcarData] = useState('')
  const [remarcarMotivo, setRemarcarMotivo] = useState('')
  const [remarcarSenhaModal, setRemarcarSenhaModal] = useState(false)
  const [remarcarErro, setRemarcarErro] = useState('')
  const [remarcarLoading, setRemarcarLoading] = useState(false)

  // Aviso de intervalo quebrado (Diagnóstico Guiado) - populado pelas duas
  // rotas de remarcar (modal rápido da Agenda e formulário de Ocorrências do
  // prontuário) quando a API acusa menos de 7 dias entre sessões do mesmo
  // pacote. Guarda o nome do paciente pra deixar claro no modal de quem se
  // trata; a decisão (manter ou empurrar as seguintes) é do comercial.
  const [avisoRemarcacao, setAvisoRemarcacao] = useState<{
    sessaoId: string
    paciente: string
    mensagem: string
    /**
     * Datas atuais das sessões que o empurrar vai reescrever. Desde que as
     * datas do pacote passaram a ser editáveis (02/09/2026), "empurrar" deixou
     * de apenas restaurar uma régua que já era verdade: ele pode APAGAR datas
     * combinadas com o paciente. Esta tela oferece o mesmo botão que a de
     * Vendas e precisa da mesma lista - corrigir só uma das duas foi o defeito
     * que a revisão adversarial pegou.
     */
    seguintes: { numero: number; dataAtual: string }[]
  } | null>(null)
  const [avisoEmpurrarSenhaOpen, setAvisoEmpurrarSenhaOpen] = useState(false)
  // Sessões do mesmo pacote que vêm depois da remarcada e ainda podem ser
  // movidas. Mesmo filtro que `empurrar-seguintes` usa no banco, para o modal
  // listar exatamente o que a rota vai reescrever.
  function seguintesDoPacote(sessaoId: string) {
    const base = sessoes.find(x => x.id === sessaoId)
    if (!base) return []
    return sessoes
      .filter(x => x.sale_id === base.sale_id
        && x.numero_sessao > base.numero_sessao
        && x.status !== 'entregue' && x.status !== 'cancelada')
      .sort((a, b) => a.numero_sessao - b.numero_sessao)
      .map(x => ({ numero: x.numero_sessao, dataAtual: x.data_agendada ? fmtDt(x.data_agendada) : 'sem data' }))
  }
  const [avisoEmpurrarErro, setAvisoEmpurrarErro] = useState('')
  const [avisoEmpurrarLoading, setAvisoEmpurrarLoading] = useState(false)
  const [avisoEmpurrarSucesso, setAvisoEmpurrarSucesso] = useState<number | null>(null)
  // Aviso separado do "deu certo": as datas podem ter sido salvas e ainda
  // assim o convite do Google não ter sido refeito em alguma sessão. Antes a
  // tela dizia só "N sessões remarcadas" e o paciente ficava com o convite no
  // horário velho sem ninguém saber.
  const [avisoEmpurrarCalendario, setAvisoEmpurrarCalendario] = useState<string | null>(null)

  // Visão terapeuta — tabs de página. Fica na URL (?tab=) pra sobreviver a
  // um refresh da página em vez de sempre voltar pra "overview".
  const [terapeutaTab, setTerapeutaTabState] = useState<TerapeutaTabType>(() => {
    const t = searchParams.get('tab')
    return (TERAPEUTA_TABS as readonly string[]).includes(t ?? '') ? (t as TerapeutaTabType) : 'overview'
  })
  function setTerapeutaTab(tab: TerapeutaTabType) {
    setTerapeutaTabState(tab)
    const next = new URLSearchParams(searchParams.toString())
    next.set('tab', tab)
    router.replace(`/terapeutas/${id}?${next.toString()}`, { scroll: false })
  }

  // Agenda — calendário do mês. Mês/ano e o dia aberto (drill-down) ficam
  // na URL (?mes=&ano=&dia=) — sem isso um refresh na visão do dia sempre
  // voltava pro grid do mês atual.
  const hoje = new Date()
  const [agendaMes, setAgendaMes] = useState(() => {
    const diaParam = parseAgendaDiaParam(searchParams.get('dia'))
    if (diaParam) return diaParam.getMonth()
    const m = Number(searchParams.get('mes'))
    return searchParams.get('mes') !== null && !isNaN(m) ? m : hoje.getMonth()
  })
  const [agendaAno, setAgendaAno] = useState(() => {
    const diaParam = parseAgendaDiaParam(searchParams.get('dia'))
    if (diaParam) return diaParam.getFullYear()
    const a = Number(searchParams.get('ano'))
    return searchParams.get('ano') !== null && !isNaN(a) ? a : hoje.getFullYear()
  })
  const [agendaDetalhe, setAgendaDetalhe] = useState<Sessao | null>(null)
  const [agendaDiaSelecionado, setAgendaDiaSelecionadoState] = useState<Date | null>(
    () => parseAgendaDiaParam(searchParams.get('dia'))
  )
  function syncAgendaUrl(params: { dia?: string | null; mes?: number; ano?: number }) {
    const next = new URLSearchParams(searchParams.toString())
    if ('dia' in params) {
      if (params.dia) next.set('dia', params.dia)
      else next.delete('dia')
    }
    if (params.mes !== undefined) next.set('mes', String(params.mes))
    if (params.ano !== undefined) next.set('ano', String(params.ano))
    router.replace(`/terapeutas/${id}?${next.toString()}`, { scroll: false })
  }
  function setAgendaDiaSelecionado(value: Date | null | ((prev: Date | null) => Date | null)) {
    setAgendaDiaSelecionadoState(prev => {
      const next = typeof value === 'function' ? (value as (p: Date | null) => Date | null)(prev) : value
      syncAgendaUrl({ dia: next ? agendaDiaParam(next) : null, mes: agendaMes, ano: agendaAno })
      return next
    })
  }
  const [compromissos, setCompromissos] = useState<CompromissoDia[]>([])

  // Lançar compromisso pessoal — a partir de um clique em horário livre na Agenda do Dia
  const [compromissoNovoOpen, setCompromissoNovoOpen] = useState(false)
  const [compromissoNovoTitulo, setCompromissoNovoTitulo] = useState('')
  const [compromissoNovoCategoria, setCompromissoNovoCategoria] = useState<'sessao' | 'compromisso'>('compromisso')
  const [compromissoNovoInicio, setCompromissoNovoInicio] = useState('')
  const [compromissoNovoFim, setCompromissoNovoFim] = useState('')
  const [compromissoNovoErro, setCompromissoNovoErro] = useState('')
  const [compromissoNovoLoading, setCompromissoNovoLoading] = useState(false)
  const [compromissoNovoSenhaOpen, setCompromissoNovoSenhaOpen] = useState(false)
  const [compromissoNovoRepetir, setCompromissoNovoRepetir] = useState(false)
  const [compromissoNovoFrequencia, setCompromissoNovoFrequencia] = useState<'semanal' | 'diaria'>('semanal')
  const [compromissoNovoSemanas, setCompromissoNovoSemanas] = useState('8')
  const [compromissoNovoSucesso, setCompromissoNovoSucesso] = useState<number | null>(null)

  // Apagar compromisso — a partir de um clique num bloco de compromisso na Agenda do Dia
  const [compromissoApagar, setCompromissoApagar] = useState<CompromissoDia | null>(null)
  const [compromissoApagarErro, setCompromissoApagarErro] = useState('')
  const [compromissoApagarLoading, setCompromissoApagarLoading] = useState(false)
  const [compromissoApagarSenhaOpen, setCompromissoApagarSenhaOpen] = useState(false)

  // Fechamentos de comissão (histórico, somente leitura)
  const [fechamentos, setFechamentos] = useState<FechamentoHistorico[]>([])
  const [fechamentosLoading, setFechamentosLoading] = useState(false)
  const [fechamentoExpandido, setFechamentoExpandido] = useState<string | null>(null)
  const [fechamentoSessoesPage, setFechamentoSessoesPage] = useState(1)

  // Overview
  const [ovPreset, setOvPreset] = useState<Preset>('all')
  const [ovDateStart, setOvDateStart] = useState('')
  const [ovDateEnd, setOvDateEnd] = useState('')
  const [ovMetricas, setOvMetricas] = useState<Metricas>(METRICAS_VAZIA)
  const [ovConsultasHoje, setOvConsultasHoje] = useState<ConsultaHoje[]>([])
  const [ovConsultasEntreguesHoje, setOvConsultasEntreguesHoje] = useState<ConsultaHoje[]>([])
  const [ovPendentesConclusao, setOvPendentesConclusao] = useState<ConsultaHoje[]>([])
  const [ovProximasConsultas, setOvProximasConsultas] = useState<ConsultaHoje[]>([])
  const [ovProximasPagina, setOvProximasPagina] = useState(1)
  const [ovLoading, setOvLoading] = useState(false)

  // Vendas — sub-aba também fica na URL (?subtab=), mesma regra do
  // terapeutaTab acima.
  const [vendasSubTab, setVendasSubTabState] = useState<VendasSubTabType>(() => {
    const st = searchParams.get('subtab')
    return (VENDAS_SUBTABS as readonly string[]).includes(st ?? '') ? (st as VendasSubTabType) : 'pendentes'
  })
  function setVendasSubTab(sub: VendasSubTabType) {
    setVendasSubTabState(sub)
    const next = new URLSearchParams(searchParams.toString())
    next.set('subtab', sub)
    router.replace(`/terapeutas/${id}?${next.toString()}`, { scroll: false })
  }
  const [vBusca, setVBusca] = useState('')
  const [vFormato, setVFormato] = useState('all')
  const [vPreset, setVPreset] = useState<Preset>('all')
  const [vDateStart, setVDateStart] = useState('')
  const [vDateEnd, setVDateEnd] = useState('')
  const [vendasPendentes, setVendasPendentes] = useState<SaleInfo[]>([])

  // Lançamento manual — paciente já em atendimento fora do sistema (venda +
  // sessões numa tacada só), pra quando o histórico é grande demais pra
  // reconciliar contra uma venda antiga importada (ver vendas_a_partir_de).
  const [manualOpen, setManualOpen] = useState(false)
  const [manualNome, setManualNome] = useState('')
  const [manualEmail, setManualEmail] = useState('')
  const [manualTelefone, setManualTelefone] = useState('')
  const [manualProduto, setManualProduto] = useState('')
  const [manualPlataforma, setManualPlataforma] = useState('hubla')
  const [manualValorBruto, setManualValorBruto] = useState('')
  const [manualValorLiquido, setManualValorLiquido] = useState('')
  const [manualDataCompra, setManualDataCompra] = useState('')
  const [manualTotalSessoes, setManualTotalSessoes] = useState('')
  const [manualEntreguesNumero, setManualEntreguesNumero] = useState('')
  const [manualProximaSessaoData, setManualProximaSessaoData] = useState('')
  const [manualDatasEditadas, setManualDatasEditadas] = useState<string[]>([])
  const [manualErro, setManualErro] = useState('')
  const [manualLoading, setManualLoading] = useState(false)
  const [manualSenhaOpen, setManualSenhaOpen] = useState(false)
  const [manualSucesso, setManualSucesso] = useState<{ nome: string; criadas: number; puladas: number } | null>(null)

  // Pacientes e prontuário — Ocorrências (Nota / Remarcar / Reembolso), igual
  // ao módulo original em vendas/page.tsx
  const [prontuarioEmail, setProntuarioEmail] = useState<string | null>(null)
  const [ocorrenciaTipo, setOcorrenciaTipo] = useState<'select' | 'nota' | 'remarcacao' | 'reembolso' | 'orientacao' | null>(null)
  // Nota
  const [notaTitulo, setNotaTitulo] = useState('')
  const [notaDesc, setNotaDesc] = useState('')
  const [notaErro, setNotaErro] = useState('')
  const [notaLoading, setNotaLoading] = useState(false)
  const [notaSenhaOpen, setNotaSenhaOpen] = useState(false)
  const [notaSessaoId, setNotaSessaoId] = useState('')
  // Remarcar consulta (form do prontuário — distinto do modal rápido da Agenda)
  const [remSessaoId, setRemSessaoId] = useState('')
  const [remNovaData, setRemNovaData] = useState('')
  const [remSolicitadoPor, setRemSolicitadoPor] = useState('')
  const [remMotivo, setRemMotivo] = useState('')
  const [remErro, setRemErro] = useState('')
  const [remLoading, setRemLoading] = useState(false)
  const [remSenhaOpen, setRemSenhaOpen] = useState(false)
  // Solicitação de reembolso parcial
  const [reeSessoes, setReeSessoes] = useState<string[]>([])
  const [reeMotivo, setReeMotivo] = useState('')
  const [reeErro, setReeErro] = useState('')
  const [reeLoading, setReeLoading] = useState(false)
  const [reeSenhaOpen, setReeSenhaOpen] = useState(false)

  // Editar dados do paciente (nome/e-mail/telefone) no cabeçalho do prontuário
  const [editandoPaciente, setEditandoPaciente] = useState(false)
  const [editNome, setEditNome] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editTelefone, setEditTelefone] = useState('')
  const [editErro, setEditErro] = useState('')
  const [editLoading, setEditLoading] = useState(false)
  const [editSenhaOpen, setEditSenhaOpen] = useState(false)

  const [orientSessaoId, setOrientSessaoId] = useState('')
  const [orientDesc, setOrientDesc] = useState('')
  const [orientEditandoId, setOrientEditandoId] = useState<string | null>(null)
  const [orientErro, setOrientErro] = useState('')
  const [orientLoading, setOrientLoading] = useState(false)
  const [orientSenhaOpen, setOrientSenhaOpen] = useState(false)

  async function loadData() {
    const client = getSupabaseClient()
    if (!client) return
    setLoading(true)
    const [tResp, sResp, todasResp] = await Promise.all([
      client.from('terapeutas').select('id,nome,email,percentual_comissao,vendas_a_partir_de,duracao_sessao_minutos,horarios_fixos').eq('id', id).single(),
      client.from('sessoes').select('id,sale_id,numero_sessao,total_sessoes,status,status_consulta,data_agendada,data_entrega,link_meet,comissao_valor,comissao_paga,paciente_nome,paciente_email,entregue_confirmado_por,iniciado_em,concluido_em,vendedor_nome,agendado_por')
        .eq('terapeuta_id', id).order('sale_id').order('numero_sessao', { ascending: true }),
      client.from('terapeutas').select('id,nome').eq('ativo', true).order('nome'),
    ])
    if (tResp.data) setTerapeuta(tResp.data as unknown as Terapeuta)
    setOutrasTerapeutas((todasResp.data ?? []) as { id: string; nome: string }[])
    const terapeutaResp = tResp.data as unknown as Terapeuta | null
    const corte = terapeutaResp?.vendas_a_partir_de ?? null
    const sessoesTodas = (sResp.data ?? []) as Sessao[]

    const saleIds = [...new Set(sessoesTodas.map(s => s.sale_id))]
    const vendasMap: Record<string, SaleInfo> = {}
    if (saleIds.length > 0) {
      // order_id entra no select por causa da etiqueta do Diagnostico Guiado:
      // sem ele, formatoDaVenda() (usado no prontuário e na aba Vendas) nunca
      // reconhece o pacote e a etiqueta nunca aparece, sem erro nenhum.
      const { data: vendasData } = await client
        .from('sales').select('id,nome,email,telefone,produto,plataforma,valor_pago_cliente,valor_liquido,data_hora,status,order_id,pacote_pai_id').in('id', saleIds)
      for (const v of (vendasData ?? []) as SaleInfo[]) vendasMap[v.id] = v

      // Vendas LIGADAS a estas: o paciente pagou o mesmo pacote em mais de uma
      // compra, e as sessoes ficaram todas na venda-pai. Sem carrega-las aqui,
      // o bruto e o liquido do paciente perdem a segunda compra - o card
      // mostraria R$ 700 onde ele pagou R$ 1.400 - e o reembolso, que sai desse
      // mesmo numero, devolveria metade do devido.
      const { data: filhasData } = await client
        .from('sales').select('id,nome,email,telefone,produto,plataforma,valor_pago_cliente,valor_liquido,data_hora,status,order_id,pacote_pai_id')
        .in('pacote_pai_id', saleIds)
      for (const v of (filhasData ?? []) as SaleInfo[]) vendasMap[v.id] = v
    }
    setVendas(vendasMap)

    // Consulta extra só pras vendas do Diagnóstico: sem filtro de terapeuta,
    // porque o pacote é dividido entre dois e o progresso real depende dos
    // dois. São no máximo algumas dezenas de sale_ids, e a consulta nem roda
    // quando não há nenhum Diagnóstico na tela.
    const saleIdsDiag = Object.values(vendasMap).filter(v => formatoDaVenda(v)).map(v => v.id)
    const pacoteDiagMap: Record<string, { numero_sessao: number; status: string }[]> = {}
    if (saleIdsDiag.length > 0) {
      const { data: sessoesPacote } = await client
        .from('sessoes').select('sale_id,numero_sessao,status').in('sale_id', saleIdsDiag)
      for (const s of (sessoesPacote ?? []) as { sale_id: string; numero_sessao: number; status: string }[]) {
        if (!pacoteDiagMap[s.sale_id]) pacoteDiagMap[s.sale_id] = []
        pacoteDiagMap[s.sale_id].push({ numero_sessao: s.numero_sessao, status: s.status })
      }
    }
    setSessoesPacoteDiag(pacoteDiagMap)

    // Terapeuta em modo "começar do zero" (vendas_a_partir_de configurado):
    // sessão só conta se a venda que a originou é depois do corte — histórico
    // real continua no banco, só some da tela (Overview/Ativos/Agenda) até o
    // paciente ser relançado manualmente com uma sessão futura de verdade.
    const sessoesData = corte
      ? sessoesTodas.filter(s => {
          const venda = vendasMap[s.sale_id]
          return venda ? new Date(venda.data_hora).getTime() >= new Date(corte).getTime() : false
        })
      : sessoesTodas
    setSessoes(sessoesData)

    const { data: compromissosData } = await client
      .from('compromissos_terapeuta').select('id,titulo,inicio,fim,categoria').eq('terapeuta_id', id).order('inicio')
    setCompromissos((compromissosData ?? []) as CompromissoDia[])

    const saleIdsVisiveis = [...new Set(sessoesData.map(s => s.sale_id))]
    const sessaoIds = sessoesData.map(s => s.id)
    if (saleIdsVisiveis.length > 0) {
      const [ocResp, remResp] = await Promise.all([
        client.from('ocorrencias_prontuario').select('id,sale_id,sessao_id,tipo,titulo,descricao,criado_por_nome,criado_por_tipo,created_at').in('sale_id', saleIdsVisiveis).order('created_at', { ascending: false }),
        sessaoIds.length > 0
          ? client.from('remarcacoes_historico').select('*').in('sessao_id', sessaoIds).order('created_at', { ascending: true })
          : Promise.resolve({ data: [] as Remarcacao[] }),
      ])

      const ocMap: Record<string, Ocorrencia[]> = {}
      for (const o of (ocResp.data ?? []) as Ocorrencia[]) {
        if (!ocMap[o.sale_id]) ocMap[o.sale_id] = []
        ocMap[o.sale_id].push(o)
      }
      setOcorrencias(ocMap)

      const remMap: Record<string, Remarcacao[]> = {}
      for (const r of (remResp.data ?? []) as Remarcacao[]) {
        if (!remMap[r.sessao_id]) remMap[r.sessao_id] = []
        remMap[r.sessao_id].push(r)
      }
      setRemarcacoes(remMap)
    }

    // Vendas aprovadas do terapeuta que AINDA não têm sessão nenhuma criada —
    // sem isso ficam invisíveis pro terapeuta e pro admin, mesmo já tendo
    // sido corretamente atribuídas a ele/ela pelo nome do produto.
    const nomeTerapeuta = terapeutaResp?.nome
    if (nomeTerapeuta) {
      const primeiroNome = nomeTerapeuta.split(' ')[0]
      let candidatasQuery = client
        .from('sales')
        .select('id,nome,email,telefone,produto,plataforma,valor_pago_cliente,valor_liquido,data_hora,status,pacote_pai_id')
        .ilike('produto', `%${primeiroNome}%`)
        // Mentoria em Grupo não é agendamento individual — não deve cair em
        // Pendentes de Agendamento junto com a Mentoria Particular.
        .not('produto', 'ilike', '%grupo%')
        .eq('status', 'aprovada')
      // vendas_a_partir_de: corte de data — vendas anteriores não aparecem
      // mais em Pendentes de Agendamento (paciente lançado manualmente em
      // vez de reconciliar contra a venda antiga importada).
      if (terapeutaResp?.vendas_a_partir_de) {
        candidatasQuery = candidatasQuery.gte('data_hora', terapeutaResp.vendas_a_partir_de)
      }
      const { data: candidatas } = await candidatasQuery
      // Venda ligada a outro pacote sai daqui tambem: ela ja foi agendada com
      // a venda-pai, e o botao "Agendar" mandaria para /terapeutas/vendas, onde
      // ela foi filtrada - devolvendo erro sem explicacao nenhuma. Mesma regra
      // das outras duas telas, em lib/vendas-por-situacao.ts.
      let pendentes = ((candidatas ?? []) as SaleInfo[])
        .filter(v => ehPendenteDeAgendamento(v, { temSessao: x => saleIds.includes(x.id) }))
      // Terapeuta em modo "começar do zero" só reconhece produto exclusivo
      // dele — nunca um produto conjunto (ex: "Mentoria Particular - Pedro |
      // Denise") que bate com o nome de outro terapeuta ativo também. Esse
      // produto conjunto sempre foi na prática de outro terapeuta.
      if (terapeutaResp?.vendas_a_partir_de) {
        const outrosNomes = ((todasResp.data ?? []) as { id: string; nome: string }[])
          .filter(t => t.id !== id)
          .map(t => t.nome.trim().split(' ')[0].toLowerCase())
        pendentes = pendentes.filter(v => !outrosNomes.some(n => v.produto.toLowerCase().includes(n)))
      }

      // O Diagnostico Guiado nao tem nome de terapeuta no produto, entao a busca
      // por nome nunca o encontra. Ele aparece so na tela do Pedro, que sempre
      // comeca o pacote; agendar dali cria as sessoes dos dois.
      if (primeiroNome.toLowerCase() === 'pedro') {
        // O filtro por nome do produto aqui e so pre-filtro de desempenho e
        // para escapar do corte de 1000 linhas do PostgREST (a tabela sales
        // tem quase 10 mil vendas aprovadas nao-manuais; sem esse filtro a
        // consulta vinha truncada e podia nao trazer nenhuma venda do
        // Diagnostico). Quem decide o formato de verdade e o formatoDaVenda,
        // pela oferta, porque os tres formatos do Diagnostico tem produto com
        // nome identico.
        let diagQuery = client
          .from('sales')
          .select('id,nome,email,telefone,produto,plataforma,valor_pago_cliente,valor_liquido,data_hora,status,order_id')
          .ilike('produto', '%Diagnóstico Guiado%')
          .eq('status', 'aprovada')
          .not('id', 'like', 'manual_%')
        // Mesmo corte de vendas_a_partir_de da consulta de cima. Sem isso,
        // se o corte do Pedro for reajustado, uma venda do Diagnostico ja
        // encerrada volta a aparecer como pendente.
        if (terapeutaResp?.vendas_a_partir_de) {
          diagQuery = diagQuery.gte('data_hora', terapeutaResp.vendas_a_partir_de)
        }
        const { data: diag } = await diagQuery
        for (const v of (diag ?? []) as (SaleInfo & { order_id?: string })[]) {
          // Oferta desconhecida NÃO é descartada aqui. Antes um `continue`
          // fazia a venda sumir da tela sem aviso nenhum - ninguém ficava
          // sabendo que existia uma compra esperando agendamento. A spec pede
          // o contrário: ela fica pendente, com aviso pedindo a associação da
          // oferta. Quem mostra o aviso e bloqueia o botão "Agendar" é a
          // tabela de Pendentes, via ofertaDiagnosticoNaoMapeada().
          if (saleIds.includes(v.id)) continue
          if (pendentes.some(p => p.id === v.id)) continue
          pendentes.push(v)
        }
      }

      setVendasPendentes(pendentes)
    }

    setLoading(false)
  }

  useEffect(() => {
    // terapeutas_session tem prioridade sobre o login do dashboard principal
    // — a senha de ações aqui (agendar, remarcar, nota, reembolso etc.) é
    // validada contra usuarios_sistema (tabela do módulo de terapeutas), uma
    // tabela separada de usuarios_dashboard. Se o navegador também tiver um
    // spr_session guardado (login do dashboard principal, de outra conta ou
    // de um teste anterior) e ele for usado no lugar do login real da
    // pessoa no módulo, a senha nunca bate — foi o bug do Felipe (comercial).
    const raw = localStorage.getItem('terapeutas_session')
    if (raw) {
      try {
        const session = JSON.parse(raw) as TerapeutaSession
        setAdminEmail(session.email)
        setSessionNome(session.nome)
        setSessionToken(session.token ?? '')
        setDispensaSenha(!!session.token && !!session.dispensa_senha_nas_acoes)
        if (session.tipo === 'terapeuta') {
          setIsTerapeutaSession(true)
          if (session.terapeuta_id && session.terapeuta_id !== id) {
            router.replace(`/terapeutas/${session.terapeuta_id}`)
            return
          }
        }
        if (id) loadData()
        return
      } catch { /* ignore, cai pro fallback abaixo */ }
    }

    const adminSession = getSession()
    if (adminSession) {
      setAdminEmail(adminSession.email)
      setSessionNome(adminSession.name)
    }
    if (id) loadData()
  }, [id])

  // ── Overview: cards + consultas de hoje via /api/terapeutas/dashboard ──
  async function loadOverview() {
    if (ovPreset === 'custom' && (!ovDateStart || !ovDateEnd)) return
    setOvLoading(true)
    try {
      const params = new URLSearchParams({ datePreset: ovPreset, terapeutaId: id })
      if (ovPreset === 'custom') {
        if (ovDateStart) params.set('dateStart', ovDateStart + 'T03:00:00.000Z')
        if (ovDateEnd) {
          // Fim do dia em Brasília (23:59:59 BRT) convertido pra UTC = 02:59:59 do dia seguinte
          const fimBrt = new Date(ovDateEnd + 'T00:00:00Z')
          fimBrt.setUTCDate(fimBrt.getUTCDate() + 1)
          fimBrt.setUTCHours(2, 59, 59, 999)
          params.set('dateEnd', fimBrt.toISOString())
        }
      }
      const res = await fetch('/api/terapeutas/dashboard?' + params.toString())
      const json = await res.json()
      setOvMetricas(json.metricas ?? METRICAS_VAZIA)
      setOvConsultasHoje(json.consultas_hoje ?? [])
      setOvConsultasEntreguesHoje(json.consultas_entregues_hoje ?? [])
      setOvPendentesConclusao(json.consultas_pendentes_conclusao ?? [])
      setOvProximasConsultas(json.proximas_consultas ?? [])
    } finally {
      setOvLoading(false)
    }
  }

  useEffect(() => {
    if (!id) return
    loadOverview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, ovPreset, ovDateStart, ovDateEnd])

  // Auto-refresh consultas de hoje a cada 60s
  useEffect(() => {
    if (!id) return
    const interval = setInterval(() => {
      fetch(`/api/terapeutas/dashboard?datePreset=${ovPreset}&terapeutaId=${id}`)
        .then(r => r.ok ? r.json() : null)
        .then(json => {
          if (json?.consultas_hoje) setOvConsultasHoje(json.consultas_hoje)
          if (json?.consultas_entregues_hoje) setOvConsultasEntreguesHoje(json.consultas_entregues_hoje)
          if (json?.consultas_pendentes_conclusao) setOvPendentesConclusao(json.consultas_pendentes_conclusao)
          if (json?.proximas_consultas) setOvProximasConsultas(json.proximas_consultas)
        })
        .catch(() => {})
    }, 60000)
    return () => clearInterval(interval)
  }, [id, ovPreset])

  // Reset das ocorrências quando o prontuário abre/fecha
  useEffect(() => {
    setOcorrenciaTipo(null)
    setNotaTitulo(''); setNotaDesc(''); setNotaErro('')
    setRemSessaoId(''); setRemNovaData(''); setRemSolicitadoPor(''); setRemMotivo(''); setRemErro('')
    setReeSessoes([]); setReeMotivo(''); setReeErro('')
  }, [prontuarioEmail])

  // Histórico de fechamentos de comissão (somente leitura)
  useEffect(() => {
    if (!id || terapeutaTab !== 'fechamentos') return
    const client = getSupabaseClient()
    if (!client) return
    async function loadFechamentos() {
      setFechamentosLoading(true)
      const { data } = await client!.from('fechamentos_terapeutas').select('*').eq('terapeuta_id', id).order('data_confirmacao', { ascending: false })
      setFechamentos((data ?? []) as FechamentoHistorico[])
      setFechamentosLoading(false)
    }
    loadFechamentos()
  }, [id, terapeutaTab])

  // ── Agenda: grid do mês ──
  function navMesAgenda(dir: -1 | 1) {
    const d = new Date(agendaAno, agendaMes + dir, 1)
    setAgendaAno(d.getFullYear())
    setAgendaMes(d.getMonth())
    syncAgendaUrl({ mes: d.getMonth(), ano: d.getFullYear() })
  }
  const agendaCells = useMemo(() => {
    const primeiroDia = new Date(agendaAno, agendaMes, 1).getDay()
    const diasNoMes = new Date(agendaAno, agendaMes + 1, 0).getDate()
    const cells: (number | null)[] = [
      ...Array(primeiroDia).fill(null),
      ...Array.from({ length: diasNoMes }, (_, i) => i + 1),
    ]
    while (cells.length % 7 !== 0) cells.push(null)
    return cells
  }, [agendaAno, agendaMes])
  function sessoesNoDiaAgenda(dia: number): Sessao[] {
    return sessoes.filter(s => {
      if (!s.data_agendada) return false
      // Sessão já entregue não é mais um compromisso futuro — some da
      // agenda pra não confundir com o que ainda precisa acontecer.
      if (s.status === 'entregue') return false
      const d = new Date(s.data_agendada)
      return d.getFullYear() === agendaAno && d.getMonth() === agendaMes && d.getDate() === dia
    }).sort((a, b) => (a.data_agendada ?? '') < (b.data_agendada ?? '') ? -1 : 1)
  }
  const agendaHojeCell = hoje.getFullYear() === agendaAno && hoje.getMonth() === agendaMes ? hoje.getDate() : null

  function ocupadosNoDia(dia: number): Ocupado[] {
    const inicioDia = new Date(agendaAno, agendaMes, dia)
    const sessoesDoDia = sessoes.filter(s => {
      if (!s.data_agendada || s.status === 'cancelada') return false
      return new Date(s.data_agendada).toDateString() === inicioDia.toDateString()
    })
    const compromissosDoDia = compromissos.filter(c =>
      new Date(c.inicio).toDateString() === inicioDia.toDateString())
    return [
      ...sessoesDoDia.map(s => ({
        inicio: minutosDoDia(s.data_agendada as string),
        fim: minutosDoDia(s.data_agendada as string) + (terapeuta?.duracao_sessao_minutos ?? 60),
      })),
      ...compromissosDoDia.map(c => ({ inicio: minutosDoDia(c.inicio), fim: minutosDoDia(c.fim) })),
    ]
  }

  function previewVagosNoDia(dia: number): string {
    const ocupados = ocupadosNoDia(dia)
    if ((terapeuta?.horarios_fixos ?? []).length > 0) {
      const livres = contarSlotsLivres(terapeuta!.horarios_fixos, ocupados, terapeuta?.duracao_sessao_minutos ?? 60)
      return `${livres} vago${livres === 1 ? '' : 's'} de ${terapeuta!.horarios_fixos.length}`
    }
    const minutosLivres = calcularIntervalosLivres(ocupados, JANELA_INICIO_MIN, JANELA_FIM_MIN)
      .reduce((total, l) => total + (l.fim - l.inicio), 0)
    return minutosLivres > 0 ? `${fmtDuracao(minutosLivres)} livre` : 'sem vaga'
  }

  // ── Agrupamento por paciente (visão terapeuta) ──
  const pacientes = useMemo(() => {
    const map: Record<string, PacienteAgrupado> = {}
    for (const s of sessoes) {
      const key = s.paciente_email
      if (!map[key]) {
        map[key] = { email: key, nome: s.paciente_nome, saleIds: [], sessoes: [], entregues: 0, total: 0, ativo: false, bruto: 0, liquido: 0, vendedor: '—', dataCompraMaisRecente: '' }
      }
      const p = map[key]
      if (!p.saleIds.includes(s.sale_id)) p.saleIds.push(s.sale_id)
      p.sessoes.push(s)
      p.total++
      if (s.status === 'entregue') p.entregues++
      if (s.status === 'pendente' || s.status === 'agendada') p.ativo = true
      if (p.vendedor === '—' && (s.vendedor_nome || s.agendado_por)) p.vendedor = s.vendedor_nome ?? s.agendado_por ?? '—'
    }
    for (const p of Object.values(map)) {
      const vendasDoPaciente = p.saleIds.map(sid => vendas[sid]).filter((v): v is SaleInfo => !!v)
      // O manual conta a SESSÃO, nunca o DINHEIRO — mesma regra do item 26 do
      // spr-digital.md, aplicada em 10/08 no /api/terapeutas/dashboard e que
      // tinha ficado de fora desta tela. Lançamento manual do módulo de
      // terapeutas registra um atendimento de paciente que já tem a venda real
      // gravada em outro lugar; somar os dois inflava o bruto por paciente
      // (R$ 86.310 espalhados por 29 pacientes, medidos em 01/09/2026).
      //
      // As sessões continuam vindo de `p.sessoes`, que não é filtrado: o
      // paciente lançado à mão segue aparecendo na agenda e no prontuário.
      const vendasFaturamento = vendasDoPaciente.filter(v => !v.id.startsWith('manual_'))
      p.bruto = vendasFaturamento.reduce((a, v) => a + (v.valor_pago_cliente || 0), 0)
      p.liquido = vendasFaturamento.reduce((a, v) => a + (v.valor_liquido || 0), 0)
      p.dataCompraMaisRecente = vendasDoPaciente.length > 0
        ? [...vendasDoPaciente].sort((a, b) => b.data_hora.localeCompare(a.data_hora))[0].data_hora
        : ''
    }
    return Object.values(map).sort((a, b) => a.nome.localeCompare(b.nome))
  }, [sessoes, vendas])

  const formatosDisponiveis = useMemo(() => {
    return Array.from(new Set(Object.values(vendas).map(v => v.produto))).sort()
  }, [vendas])

  function filtraPacientes(lista: PacienteAgrupado[], aplicarPeriodo = true): PacienteAgrupado[] {
    const buscaLower = vBusca.toLowerCase()
    return lista.filter(p => {
      const matchBusca = !vBusca || p.nome.toLowerCase().includes(buscaLower) || p.email.toLowerCase().includes(buscaLower)
      const matchFormato = vFormato === 'all' || p.saleIds.some(sid => vendas[sid]?.produto === vFormato)
      const matchPeriodo = !aplicarPeriodo || !p.dataCompraMaisRecente || noPeriodo(p.dataCompraMaisRecente, vPreset, vDateStart, vDateEnd)
      return matchBusca && matchFormato && matchPeriodo
    })
  }

  // Pacientes ativos (tratamento em andamento) sempre aparecem, independente
  // do período selecionado — senão o filtro de data esconde gente que ainda
  // não terminou as sessões, e a pessoa fica "perdida" sem ninguém ver.
  const pacientesAtivos = useMemo(() => filtraPacientes(pacientes.filter(p => p.ativo), false), [pacientes, vBusca, vFormato])
  // Concluídos também ignora o período pelo mesmo motivo dos Ativos — só
  // Reembolsados continua filtrado por período (faz sentido como relatório
  // histórico: "quem reembolsou nesse mês").
  const pacientesConcluidos = useMemo(() => filtraPacientes(pacientes.filter(p => !p.ativo), false), [pacientes, vBusca, vFormato])

  // Agrupa vendas pendentes por paciente (email) — um paciente pode ter mais
  // de uma venda (ex.: parcelamento em cartão gera 2 vendas separadas), mas
  // conta como 1 paciente pendente de agendamento.
  const pacientesPendentesAgrupados = useMemo(() => {
    const map = new Map<string, {
      email: string; nome: string; produtos: string[]; qtdVendas: number
      bruto: number; liquido: number; dataCompraMaisRecente: string; saleIds: string[]
    }>()
    for (const v of vendasPendentes) {
      const existente = map.get(v.email)
      if (existente) {
        existente.produtos.push(v.produto)
        existente.qtdVendas += 1
        existente.bruto += v.valor_pago_cliente
        existente.liquido += v.valor_liquido
        existente.saleIds.push(v.id)
        if (new Date(v.data_hora) < new Date(existente.dataCompraMaisRecente)) existente.dataCompraMaisRecente = v.data_hora
      } else {
        map.set(v.email, {
          email: v.email, nome: v.nome, produtos: [v.produto], qtdVendas: 1,
          bruto: v.valor_pago_cliente, liquido: v.valor_liquido,
          dataCompraMaisRecente: v.data_hora, saleIds: [v.id],
        })
      }
    }
    return Array.from(map.values())
  }, [vendasPendentes])

  const vendasReembolsadas = useMemo(() => {
    const buscaLower = vBusca.toLowerCase()
    return Object.values(vendas)
      .filter(v => STATUS_REEMBOLSO.includes(v.status ?? ''))
      .filter(v => !vBusca || v.nome.toLowerCase().includes(buscaLower) || v.email.toLowerCase().includes(buscaLower))
      .filter(v => vFormato === 'all' || v.produto === vFormato)
      .filter(v => noPeriodo(v.data_hora, vPreset, vDateStart, vDateEnd))
      .sort((a, b) => b.data_hora.localeCompare(a.data_hora))
  }, [vendas, vBusca, vFormato, vPreset, vDateStart, vDateEnd])

  const prontuarioPaciente = prontuarioEmail ? pacientes.find(p => p.email === prontuarioEmail) ?? null : null
  const prontuarioSessoesOrdenadas = useMemo(() => {
    if (!prontuarioPaciente) return []
    return [...prontuarioPaciente.sessoes].sort((a, b) => {
      const dA = vendas[a.sale_id]?.data_hora ?? ''
      const dB = vendas[b.sale_id]?.data_hora ?? ''
      if (dA !== dB) return dA.localeCompare(dB)
      return a.numero_sessao - b.numero_sessao
    })
  }, [prontuarioPaciente, vendas])
  const prontuarioSaleMaisRecente = useMemo(() => {
    if (!prontuarioPaciente) return null
    const vendasDoPaciente = prontuarioPaciente.saleIds.map(sid => vendas[sid]).filter((v): v is SaleInfo => !!v)
    if (vendasDoPaciente.length === 0) return null
    return [...vendasDoPaciente].sort((a, b) => b.data_hora.localeCompare(a.data_hora))[0]
  }, [prontuarioPaciente, vendas])
  const prontuarioOcorrencias = useMemo(() => {
    if (!prontuarioPaciente) return []
    return prontuarioPaciente.saleIds
      .flatMap(sid => ocorrencias[sid] ?? [])
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [prontuarioPaciente, ocorrencias])
  const orientacaoExistentePorSessao = useMemo(() => {
    const map: Record<string, Ocorrencia> = {}
    for (const o of prontuarioOcorrencias) {
      if (o.tipo === 'orientacao_sessao' && o.sessao_id) map[o.sessao_id] = o
    }
    return map
  }, [prontuarioOcorrencias])
  const ocorrenciasAgrupadasPorSessao = useMemo(() => {
    const porSessao: { sessao: Sessao; ocorrencias: Ocorrencia[] }[] = []
    for (const s of prontuarioSessoesOrdenadas) {
      const lista = prontuarioOcorrencias.filter(o => o.sessao_id === s.id)
      if (lista.length > 0) porSessao.push({ sessao: s, ocorrencias: lista })
    }
    // Mais recente primeiro — mesma sessão pode ter data_agendada antiga
    // se foi remarcada, então ordena pela sessão (numero_sessao desc), não
    // por data_agendada.
    porSessao.sort((a, b) => b.sessao.numero_sessao - a.sessao.numero_sessao)
    const geral = prontuarioOcorrencias.filter(o => !o.sessao_id)
    return { porSessao, geral }
  }, [prontuarioSessoesOrdenadas, prontuarioOcorrencias])

  const sessoesPendentesProntuario = prontuarioSessoesOrdenadas.filter(s => s.status === 'agendada' || s.status === 'pendente')
  const entreguesProntuario = prontuarioPaciente?.entregues ?? 0
  const totalProntuario = prontuarioPaciente?.total ?? 0
  // Reembolso calculado por tabela de preços — usa o terapeuta desta própria página
  const reembolsoCalc = prontuarioPaciente && terapeuta
    ? calcularReembolsoLocal({
        terapeuta_nome: terapeuta.nome,
        sessoes_total: totalProntuario,
        sessoes_feitas: entreguesProntuario,
        valor_pago: prontuarioPaciente.bruto,
      })
    : null

  const remValido = remSessaoId && remNovaData && new Date(remNovaData) > new Date() && remSolicitadoPor && remMotivo.length >= 10
  const reeValido = reeSessoes.length > 0 && reeMotivo.length >= 20
  const editValido = editNome.trim().length > 0 && editEmail.trim().length > 0

  const orientSessaoEscolhida = prontuarioSessoesOrdenadas.find(s => s.id === orientSessaoId)
  const orientFaltamMs = orientSessaoEscolhida?.data_agendada
    ? new Date(orientSessaoEscolhida.data_agendada).getTime() - Date.now()
    : null
  const orientBloqueadaPorPrazo = orientFaltamMs !== null && orientFaltamMs < 40 * 60 * 1000
  const orientValida = orientSessaoId.length > 0 && orientDesc.trim().length >= 10 && !orientBloqueadaPorPrazo

  async function handleStatusAcao(senha: string) {
    if (!statusSessaoId) return
    setStatusLoading(true)
    setStatusErro('')
    if (statusAcao === 'anular' && anularMotivo.trim().length < 10) {
      setStatusErro('Informe o motivo (mínimo 10 caracteres)'); setStatusLoading(false); return
    }
    if (statusAcao === 'concluir' && !concluirData) {
      setStatusErro('Informe a data de entrega'); setStatusLoading(false); return
    }
    const res = await fetch('/api/terapeutas/sessoes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessao_id: statusSessaoId,
        acao: statusAcao,
        motivo: statusAcao === 'anular' ? anularMotivo : undefined,
        data_entrega: statusAcao === 'concluir' ? concluirData : undefined,
        usuario_nome: sessionNome || adminEmail.split('@')[0],
        usuario_tipo: isTerapeutaSession ? 'terapeuta' : 'admin',
        usuario_email: adminEmail,
        senha,
        token: sessionToken,
      }),
    })
    const json = await res.json()
    setStatusLoading(false)
    if (!res.ok) { setStatusErro(json.error ?? 'Erro'); return }
    setStatusSessaoId(null); setAnularMotivo(''); setConcluirData('')
    loadData()
    loadOverview()
  }

  async function handleRemarcar(senha: string) {
    if (!remarcarSessaoId || !remarcarData) return
    setRemarcarLoading(true)
    setRemarcarErro('')
    const res = await fetch('/api/terapeutas/sessoes/remarcar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessao_id: remarcarSessaoId, nova_data: remarcarData, motivo: remarcarMotivo, usuario_email: adminEmail, senha, token: sessionToken }),
    })
    const json = await res.json()
    setRemarcarLoading(false)
    if (!res.ok) { setRemarcarErro(json.error ?? 'Erro'); return }
    // Guarda o aviso de intervalo (se vier) antes de zerar remarcarSessaoId -
    // é a chance de oferecer as duas saídas ao comercial. `sessoes` ainda tem
    // a lista antiga (loadData é assíncrono e roda depois), então o paciente
    // certo ainda está lá pelo id.
    if (json.avisoIntervalo) {
      const paciente = sessoes.find(s => s.id === remarcarSessaoId)?.paciente_nome ?? ''
      setAvisoRemarcacao({ sessaoId: remarcarSessaoId, paciente, mensagem: json.avisoIntervalo, seguintes: seguintesDoPacote(remarcarSessaoId) })
    }
    setRemarcarSenhaModal(false)
    setRemarcarSessaoId(null)
    loadData()
  }

  async function handleNota(senha: string) {
    if (!prontuarioSaleMaisRecente) return
    setNotaLoading(true)
    setNotaErro('')
    const res = await fetch('/api/terapeutas/vendas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sale_id: prontuarioSaleMaisRecente.id,
        sessao_id: notaSessaoId || undefined,
        tipo: 'nota',
        titulo: notaTitulo,
        descricao: notaDesc,
        senha,
        token: sessionToken,
        usuario_nome: sessionNome || adminEmail.split('@')[0],
        usuario_tipo: isTerapeutaSession ? 'terapeuta' : 'admin',
        usuario_email: adminEmail,
      }),
    })
    const json = await res.json()
    setNotaLoading(false)
    if (!res.ok) { setNotaErro(json.error ?? 'Erro'); return }
    setNotaSenhaOpen(false); setOcorrenciaTipo(null)
    setNotaTitulo(''); setNotaDesc(''); setNotaSessaoId('')
    loadData()
  }

  const notaValida = notaTitulo.trim().length > 0 && notaDesc.trim().length >= 10

  // Remarcar consulta a partir do card de Ocorrências do prontuário — chama o
  // mesmo endpoint que de fato atualiza data_agendada (distinto do modal
  // rápido da Agenda, que usa handleRemarcar acima).
  async function handleRemarcarOcorrencia(senha: string) {
    if (!remSessaoId || !remNovaData) return
    setRemLoading(true); setRemErro('')
    const res = await fetch('/api/terapeutas/sessoes/remarcar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessao_id: remSessaoId,
        nova_data: remNovaData,
        motivo: remMotivo,
        solicitado_por: remSolicitadoPor,
        usuario_email: adminEmail,
        senha,
        token: sessionToken,
      }),
    })
    const json = await res.json()
    setRemLoading(false)
    if (!res.ok) { setRemErro(json.error ?? 'Erro'); return }
    // Mesmo aviso de intervalo do handleRemarcar acima - aqui o paciente é
    // sempre o do prontuário aberto, então não precisa buscar em lista nenhuma.
    if (json.avisoIntervalo) {
      setAvisoRemarcacao({ sessaoId: remSessaoId, paciente: prontuarioSaleMaisRecente?.nome ?? '', mensagem: json.avisoIntervalo, seguintes: seguintesDoPacote(remSessaoId) })
    }
    setRemSenhaOpen(false); setOcorrenciaTipo(null)
    setRemSessaoId(''); setRemNovaData(''); setRemSolicitadoPor(''); setRemMotivo('')
    loadData()
  }

  // Segunda decisão do fluxo de remarcação do Diagnóstico Guiado: o comercial
  // escolheu empurrar as sessões seguintes do pacote pra manter os 7 dias
  // entre elas (rota da Task 9). Pede senha de novo porque é uma ação de
  // agendamento própria - a senha digitada na remarcação não sobrevive ao
  // fechamento daquele modal, e o token sozinho só autentica quem tem
  // dispensa_senha_nas_acoes ligado (hoje, só o Pedro).
  async function handleEmpurrarSeguintes(senha: string) {
    if (!avisoRemarcacao) return
    setAvisoEmpurrarLoading(true)
    setAvisoEmpurrarErro('')
    const res = await fetch('/api/terapeutas/sessoes/empurrar-seguintes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessao_id: avisoRemarcacao.sessaoId, usuario_email: adminEmail, senha, token: sessionToken }),
    })
    const json = await res.json()
    setAvisoEmpurrarLoading(false)
    // Conflito (409) chega com mensagem pronta dizendo qual data bateu em
    // qual paciente. Nada foi alterado nesse caso - o comercial pode fechar
    // e escolher manter como está.
    if (!res.ok) { setAvisoEmpurrarErro(json.error ?? 'Não foi possível empurrar as seguintes.'); return }
    setAvisoEmpurrarSenhaOpen(false)
    setAvisoRemarcacao(null)
    setAvisoEmpurrarSucesso(json.movidas)
    setAvisoEmpurrarCalendario(json.aviso ?? null)
    loadData()
  }

  async function handleReembolso(senha: string) {
    if (!prontuarioSaleMaisRecente) return
    setReeLoading(true); setReeErro('')
    const sessoesSel = prontuarioSessoesOrdenadas.filter(s => reeSessoes.includes(s.id))
    const valorFinal = reembolsoCalc?.valor_reembolso ?? 0
    const res = await fetch('/api/terapeutas/vendas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sale_id: prontuarioSaleMaisRecente.id,
        tipo: 'solicitacao_reembolso',
        titulo: `Solicitação de reembolso parcial — ${entreguesProntuario} sessão(ões) realizadas`,
        descricao: `${reembolsoCalc?.explicacao ?? ''}. Sessões a cancelar: ${sessoesSel.map(s => s.numero_sessao).join(', ')}. Motivo: ${reeMotivo}`,
        dados_extras: {
          sessoes_ids: reeSessoes,
          sessoes_numeros: sessoesSel.map(s => s.numero_sessao),
          valor_reembolso: valorFinal,
          motivo: reeMotivo,
          paciente_nome: prontuarioSaleMaisRecente.nome,
          paciente_email: prontuarioSaleMaisRecente.email,
        },
        senha,
        token: sessionToken,
        usuario_nome: sessionNome || adminEmail.split('@')[0],
        usuario_tipo: isTerapeutaSession ? 'terapeuta' : 'admin',
        usuario_email: adminEmail,
      }),
    })
    const json = await res.json()
    setReeLoading(false)
    if (!res.ok) { setReeErro(json.error ?? 'Erro'); return }
    setReeSenhaOpen(false); setOcorrenciaTipo(null)
    setReeSessoes([]); setReeMotivo('')
    loadData()
  }

  async function handleEditarPaciente(senha: string) {
    if (!prontuarioSaleMaisRecente) return
    setEditLoading(true); setEditErro('')
    const res = await fetch('/api/terapeutas/vendas/editar-paciente', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sale_id: prontuarioSaleMaisRecente.id,
        nome: editNome,
        email: editEmail,
        telefone: editTelefone,
        senha,
        token: sessionToken,
        usuario_nome: sessionNome || adminEmail.split('@')[0],
        usuario_tipo: isTerapeutaSession ? 'terapeuta' : 'admin',
        usuario_email: adminEmail,
      }),
    })
    const json = await res.json()
    setEditLoading(false)
    if (!res.ok) { setEditErro(json.error ?? 'Erro'); return }
    setEditSenhaOpen(false); setEditandoPaciente(false)
    loadData()
  }

  async function handleOrientacao(senha: string) {
    if (!orientValida) return
    setOrientLoading(true); setOrientErro('')

    if (orientEditandoId) {
      const res = await fetch('/api/terapeutas/vendas', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: orientEditandoId,
          descricao: orientDesc,
          senha,
          token: sessionToken,
          usuario_nome: sessionNome || adminEmail.split('@')[0],
          usuario_tipo: isTerapeutaSession ? 'terapeuta' : 'admin',
          usuario_email: adminEmail,
        }),
      })
      const json = await res.json()
      setOrientLoading(false)
      if (!res.ok) { setOrientErro(json.error ?? 'Erro'); return }
    } else {
      if (!prontuarioSaleMaisRecente) { setOrientLoading(false); return }
      const res = await fetch('/api/terapeutas/vendas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sale_id: prontuarioSaleMaisRecente.id,
          sessao_id: orientSessaoId,
          tipo: 'orientacao_sessao',
          titulo: 'ORIENTAÇÃO DA SESSÃO:',
          descricao: orientDesc,
          senha,
          token: sessionToken,
          usuario_nome: sessionNome || adminEmail.split('@')[0],
          usuario_tipo: isTerapeutaSession ? 'terapeuta' : 'admin',
          usuario_email: adminEmail,
        }),
      })
      const json = await res.json()
      setOrientLoading(false)
      if (!res.ok) { setOrientErro(json.error ?? 'Erro'); return }
    }

    setOrientSenhaOpen(false); setOcorrenciaTipo(null)
    setOrientSessaoId(''); setOrientDesc(''); setOrientEditandoId(null)
    loadData()
  }

  // Não exigimos mais nenhum campo pra lançar — o essencial (nome, valores,
  // etc.) pode ser completado depois pelo prontuário. A única coisa que
  // trava é a senha, pedida no SenhaModal na hora de confirmar.
  const manualTotalNum = parseInt(manualTotalSessoes, 10) || 1
  const manualEntreguesNum = Math.min(Math.max(parseInt(manualEntreguesNumero, 10) || 0, 0), manualTotalNum)
  const manualFuturasNum = manualTotalNum - manualEntreguesNum

  useEffect(() => {
    if (!manualProximaSessaoData || manualFuturasNum <= 0) { setManualDatasEditadas([]); return }
    setManualDatasEditadas(Array.from({ length: manualFuturasNum }, (_, i) => {
      const d = new Date(manualProximaSessaoData)
      d.setDate(d.getDate() + i * 7)
      return dateToDatetimeLocal(d)
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualProximaSessaoData, manualFuturasNum])

  async function handleLancamentoManual(senha: string) {
    setManualLoading(true); setManualErro('')
    const res = await fetch('/api/terapeutas/vendas/lancamento-manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        terapeuta_id: id,
        nome: manualNome, email: manualEmail, telefone: manualTelefone || undefined,
        produto: manualProduto, plataforma: manualPlataforma,
        valor_pago_cliente: parseValorBR(manualValorBruto),
        valor_liquido: parseValorBR(manualValorLiquido),
        data_hora: manualDataCompra || undefined,
        total_sessoes: manualTotalNum,
        sessoes_entregues: manualEntreguesNum,
        proxima_sessao_data: manualProximaSessaoData || undefined,
        datas_futuras: manualDatasEditadas.length === manualFuturasNum ? manualDatasEditadas : undefined,
        usuario_email: adminEmail, senha,
      }),
    })
    const json = await res.json()
    setManualLoading(false)
    if (!res.ok) { setManualErro(json.error ?? 'Erro'); return }
    setManualSenhaOpen(false); setManualOpen(false)
    setManualSucesso({ nome: manualNome || 'Paciente', criadas: json.sessoes_criadas, puladas: json.sessoes_puladas })
    setManualNome(''); setManualEmail(''); setManualTelefone(''); setManualProduto('')
    setManualValorBruto(''); setManualValorLiquido(''); setManualDataCompra('')
    setManualTotalSessoes(''); setManualEntreguesNumero(''); setManualProximaSessaoData('')
    loadData()
  }

  // Checa se [inicio, fim] esbarra numa sessão real ou noutro compromisso já
  // lançado — não bloqueia (o usuário pode ter um motivo legítimo pra
  // sobrepor), só avisa antes de deixar prosseguir pra senha.
  function haConflitoDeHorario(inicio: Date, fim: Date): boolean {
    const iMs = inicio.getTime()
    const fMs = fim.getTime()
    const duracaoMin = terapeuta?.duracao_sessao_minutos ?? 60
    const horariosFixos = terapeuta?.horarios_fixos ?? null
    const conflitaSessao = sessoes.some(s => {
      if (!s.data_agendada || s.status === 'cancelada') return false
      const sIni = new Date(s.data_agendada).getTime()
      // Ocupa até o próximo horário da grade, no máximo a duração cadastrada.
      // Somar a duração cega fazia a consulta das 13:30 (sessão de 50min)
      // "terminar" 14:20 e avisar conflito ao clicar no Livre das 14:10 —
      // horário que a própria grade do terapeuta oferece como atendível.
      const sIniMin = minutosDoDia(s.data_agendada)
      const sFim = sIni + (fimEfetivoSessao(sIniMin, duracaoMin, horariosFixos) - sIniMin) * 60000
      return iMs < sFim && fMs > sIni
    })
    if (conflitaSessao) return true
    return compromissos.some(c => {
      const cIni = new Date(c.inicio).getTime()
      const cFim = new Date(c.fim).getTime()
      return iMs < cFim && fMs > cIni
    })
  }

  function abrirLancarCompromisso(inicio: Date, fim: Date) {
    setCompromissoNovoTitulo('')
    setCompromissoNovoCategoria('compromisso')
    setCompromissoNovoRepetir(false)
    setCompromissoNovoFrequencia('semanal')
    setCompromissoNovoSemanas('8')
    setCompromissoNovoInicio(dateToDatetimeLocal(inicio))
    // Default de 1h em vez do buraco livre inteiro — evita forçar o usuário a
    // encurtar manualmente o campo "Fim" toda vez que clica num vão grande
    // (ex.: um dia vazio de 13h). Se o buraco for menor que 1h, respeita o fim real.
    const fimPadrao = new Date(Math.min(inicio.getTime() + 60 * 60 * 1000, fim.getTime()))
    setCompromissoNovoFim(dateToDatetimeLocal(fimPadrao))
    setCompromissoNovoErro('')
    setCompromissoNovoOpen(true)
  }

  async function handleLancarCompromisso(senha: string) {
    setCompromissoNovoLoading(true); setCompromissoNovoErro('')
    const res = await fetch('/api/terapeutas/compromissos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        terapeuta_id: id,
        titulo: compromissoNovoTitulo,
        categoria: compromissoNovoCategoria,
        inicio: compromissoNovoInicio,
        fim: compromissoNovoFim,
        repetir_frequencia: compromissoNovoFrequencia,
        repetir_vezes: compromissoNovoRepetir ? (parseInt(compromissoNovoSemanas, 10) || 1) : undefined,
        usuario_nome: sessionNome || adminEmail.split('@')[0],
        usuario_tipo: isTerapeutaSession ? 'terapeuta' : 'admin',
        usuario_email: adminEmail,
        senha,
        token: sessionToken,
      }),
    })
    const json = await res.json()
    setCompromissoNovoLoading(false)
    if (!res.ok) { setCompromissoNovoErro(json.error ?? 'Erro'); return }
    setCompromissoNovoSenhaOpen(false); setCompromissoNovoOpen(false)
    setCompromissoNovoTitulo(''); setCompromissoNovoCategoria('compromisso')
    setCompromissoNovoInicio(''); setCompromissoNovoFim('')
    const criados = (json.ids as string[])?.length ?? 1
    if (compromissoNovoRepetir && criados > 1) setCompromissoNovoSucesso(criados)
    setCompromissoNovoRepetir(false); setCompromissoNovoFrequencia('semanal'); setCompromissoNovoSemanas('8')
    loadData()
  }

  async function handleApagarCompromisso(senha: string) {
    if (!compromissoApagar) return
    setCompromissoApagarLoading(true); setCompromissoApagarErro('')
    const res = await fetch('/api/terapeutas/compromissos', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: compromissoApagar.id,
        usuario_nome: sessionNome || adminEmail.split('@')[0],
        usuario_tipo: isTerapeutaSession ? 'terapeuta' : 'admin',
        usuario_email: adminEmail,
        senha,
        token: sessionToken,
      }),
    })
    const json = await res.json()
    setCompromissoApagarLoading(false)
    if (!res.ok) { setCompromissoApagarErro(json.error ?? 'Erro'); return }
    setCompromissoApagarSenhaOpen(false); setCompromissoApagar(null)
    loadData()
  }

  const ovProximasTotalPaginas = Math.max(1, Math.ceil(ovProximasConsultas.length / PROXIMAS_POR_PAGINA))
  // Clamp contra o total: o auto-refresh de 60s pode encurtar a lista (uma
  // consulta vira entregue e sai daqui) sem passar por nenhum reset de
  // página, o que deixaria a tela numa página que não existe mais.
  const ovProximasPaginaAtual = Math.min(ovProximasPagina, ovProximasTotalPaginas)
  const ovProximasVisiveis = useMemo(
    () => ovProximasConsultas.slice(
      (ovProximasPaginaAtual - 1) * PROXIMAS_POR_PAGINA,
      ovProximasPaginaAtual * PROXIMAS_POR_PAGINA),
    [ovProximasConsultas, ovProximasPaginaAtual]
  )

  const compromissoNovoValido = compromissoNovoTitulo.trim().length > 0
    && compromissoNovoInicio && compromissoNovoFim
    && new Date(compromissoNovoFim) > new Date(compromissoNovoInicio)

  function renderPresetFiltro(preset: Preset, setPreset: (p: Preset) => void, dateStart: string, setDateStart: (v: string) => void, dateEnd: string, setDateEnd: (v: string) => void) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          {(Object.keys(PRESET_LABELS) as Preset[]).map(p => (
            <button key={p} onClick={() => setPreset(p)}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                preset === p ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white border border-white/10'
              }`}>{PRESET_LABELS[p]}</button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={dateStart} onChange={e => setDateStart(e.target.value)}
              className="bg-gray-800 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none" />
            <span className="text-xs text-gray-500">até</span>
            <input type="date" value={dateEnd} onChange={e => setDateEnd(e.target.value)}
              className="bg-gray-800 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none" />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-24 md:pb-8">
      <Header />
      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-6">
          {!isTerapeutaSession && (
            <Link href="/terapeutas/lista" className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 mb-4 transition-colors">
              <ArrowLeft className="w-3 h-3" /> Voltar para lista
            </Link>
          )}
          {terapeuta && (
            <div>
              <h1 className="text-xl font-semibold text-white">{terapeuta.nome}</h1>
              <p className="text-sm text-gray-400 mt-0.5">{terapeuta.email} · Comissão {terapeuta.percentual_comissao}%</p>
            </div>
          )}

          {/* Trocar de terapeuta sem sair da tela — só pra quem gerencia mais
              de uma (admin/comercial); a própria terapeuta não vê isso. */}
          {!isTerapeutaSession && outrasTerapeutas.length > 1 && (
            <div className="flex items-center gap-1.5 flex-wrap mt-4">
              {outrasTerapeutas.map(t => (
                <button
                  key={t.id}
                  onClick={() => router.push(`/terapeutas/${t.id}`)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    t.id === id ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white border border-white/10'
                  }`}
                >
                  {t.nome}
                </button>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Tabs de página — Fechamentos (comissão a pagar) não faz sentido pra
                quem tem 0% (ex: Pedro, sócio): sempre mostraria R$0,00. O
                repasse dele passa pela Divisão entre Sócios do /fechamentos
                da empresa, não por aqui. */}
            <div className="flex items-center gap-1 bg-gray-900 border border-white/10 rounded-xl p-1 mb-6 w-fit">
              {([
                { key: 'overview', label: 'Overview' },
                { key: 'vendas', label: 'Vendas' },
                { key: 'agenda', label: 'Agenda' },
                ...(terapeuta?.percentual_comissao === 0 ? [] : [{ key: 'fechamentos', label: 'Fechamentos' }] as const),
              ] as const).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setTerapeutaTab(tab.key)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    terapeutaTab === tab.key ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* ══════════════ OVERVIEW ══════════════ */}
            {terapeutaTab === 'overview' && (
              <>
                <div className="mb-4">
                  {renderPresetFiltro(ovPreset, setOvPreset, ovDateStart, setOvDateStart, ovDateEnd, setOvDateEnd)}
                </div>

                {ovLoading ? (
                  <div className="flex items-center justify-center h-40">
                    <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : (
                  <>
                    {/* Cards — terapeutas com comissão (%) veem o resumo de comissão;
                        terapeutas sem divisão (0%, ex: Pedro) veem faturamento e ticket médio direto. */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                      {(terapeuta?.percentual_comissao === 0 ? [
                        { label: 'Sessões vendidas', sub: 'Total de sessões vendidas', value: ovMetricas.sessoes_vendidas, icon: Users, color: 'text-white' },
                        { label: 'Sessões entregues', sub: 'Confirmadas', value: ovMetricas.sessoes_entregues, icon: CheckCircle, color: 'text-green-500' },
                        { label: 'Sessões futuras', sub: 'Serão entregues', value: ovMetricas.sessoes_futuras, icon: Clock, color: 'text-yellow-400' },
                        { label: 'Faturamento bruto', sub: 'Total de vendas no período', value: fmtBRL(ovMetricas.faturamento_bruto), icon: DollarSign, color: 'text-white' },
                        { label: 'Líquido (100%)', sub: 'Faturamento líquido total, sem divisão de comissão', value: fmtBRL(ovMetricas.faturamento_liquido_total), icon: TrendingUp, color: 'text-blue-400' },
                        { label: 'Total de impostos', sub: 'Impostos sobre as vendas do período', value: fmtBRL(ovMetricas.total_impostos), icon: Receipt, color: 'text-red-400' },
                        { label: 'Ticket médio por venda', sub: 'Faturamento bruto ÷ número de vendas', value: fmtBRL(ovMetricas.ticket_medio), icon: Percent, color: 'text-yellow-400' },
                        { label: 'Ticket médio por sessão entregue', sub: '65% do líquido da venda ÷ sessões do pacote', value: fmtBRL(ovMetricas.ticket_medio_sessao_entregue), icon: Award, color: 'text-green-500' },
                      ] : [
                        { label: 'Sessões vendidas', sub: 'Total de sessões vendidas para o terapeuta', value: ovMetricas.sessoes_vendidas, icon: Users, color: 'text-white' },
                        { label: 'Sessões entregues', sub: 'Confirmadas pelo terapeuta', value: ovMetricas.sessoes_entregues, icon: CheckCircle, color: 'text-green-500' },
                        { label: 'Sessões futuras', sub: 'Serão entregues', value: ovMetricas.sessoes_futuras, icon: Clock, color: 'text-yellow-400' },
                        { label: 'Faturamento líquido', sub: 'Total de sessões vendidas × comissão do terapeuta', value: fmtBRL(ovMetricas.comissao_total_vendida), icon: TrendingUp, color: 'text-blue-400' },
                        { label: 'Comissão gerada', sub: 'Sessões entregues — a pagar', value: fmtBRL(ovMetricas.comissao_gerada), icon: Award, color: 'text-yellow-400' },
                      ]).map(({ label, sub, value, icon: Icon, color }) => (
                        <div key={label} className="bg-gray-900 border border-white/10 rounded-xl p-4">
                          <div className="flex items-center gap-2 mb-1">
                            <Icon className={`w-4 h-4 ${color} shrink-0`} />
                            <span className="text-xs text-gray-400 leading-tight">{label}</span>
                          </div>
                          <p className={`text-lg font-bold ${color} mt-1`}>{value}</p>
                          <p className="text-[10px] text-gray-600 mt-0.5 leading-tight">{sub}</p>
                        </div>
                      ))}
                    </div>

                    {/* Pendentes de conclusão — consultas cujo horário já
                        terminou e que ninguém fechou. Fica no TOPO e só
                        aparece quando existe alguma: é o único lugar onde
                        elas são visíveis (nem "Hoje" nem "Próximas" pegam
                        consulta passada), e foi assim que 96 se acumularam
                        sem ninguém ver. */}
                    {ovPendentesConclusao.length > 0 && (
                      <div className="bg-amber-500/[0.06] border border-amber-500/30 rounded-xl mb-4">
                        <div className="p-4 border-b border-amber-500/20">
                          <h2 className="text-sm font-semibold text-amber-300 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4" />
                            Pendentes de conclusão ({ovPendentesConclusao.length})
                          </h2>
                          <p className="text-[11px] text-amber-200/60 mt-1">
                            O horário já passou e ninguém marcou como concluída ou anulada. Enquanto ficar assim, o pacote do paciente não avança e a comissão não é gerada.
                          </p>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-amber-500/15">
                                {['Data', 'Horário', 'Paciente', 'Em atraso', 'Ações'].map(h => (
                                  <th key={h} className="px-4 py-3 text-left text-xs text-amber-200/50 font-medium">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {ovPendentesConclusao.map(s => (
                                <tr key={s.id} className="border-b border-amber-500/10 hover:bg-amber-500/[0.04]">
                                  <td className="px-4 py-3 text-gray-300 text-xs whitespace-nowrap">{s.data}</td>
                                  <td className="px-4 py-3 text-amber-300 font-medium">{s.horario}</td>
                                  <td className="px-4 py-3 text-white">
                                    <button onClick={() => setProntuarioEmail(s.paciente_email)}
                                      className="text-left hover:text-indigo-300 transition-colors">
                                      {s.paciente_nome}
                                    </button>
                                    <p className="text-[10px] text-gray-500">Sessão {s.numero_sessao}/{s.total_sessoes}</p>
                                    {s.rotulo_diagnostico && (
                                      <span className="inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-semibold border bg-violet-500/20 text-violet-300 border-violet-500/40">
                                        {s.rotulo_diagnostico}
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-4 py-3">
                                    <span className="text-xs px-2 py-0.5 rounded-full text-amber-300 bg-amber-500/15">
                                      {(s.dias_em_atraso ?? 0) === 0 ? 'hoje' : `${s.dias_em_atraso} ${s.dias_em_atraso === 1 ? 'dia' : 'dias'}`}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3">
                                    <div className="flex items-center gap-1">
                                      <button onClick={() => setProntuarioEmail(s.paciente_email)} title="Ver prontuário"
                                        className="w-7 h-7 shrink-0 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
                                        <ClipboardList className="w-3.5 h-3.5" />
                                      </button>
                                      <button onClick={() => { setStatusSessaoId(s.id); setStatusAcao('concluir'); setConcluirData(nowForDatetimeLocal()); setStatusErro('') }} title="Concluir consulta"
                                        className="w-7 h-7 shrink-0 flex items-center justify-center rounded-lg text-green-500 hover:bg-green-500/10 transition-colors">
                                        <CheckCircle className="w-3.5 h-3.5" />
                                      </button>
                                      <button onClick={() => { setStatusSessaoId(s.id); setStatusAcao('nao_compareceu'); setStatusErro('') }} title="Paciente não compareceu"
                                        className="w-7 h-7 shrink-0 flex items-center justify-center rounded-lg text-orange-400 hover:bg-orange-500/10 transition-colors">
                                        <Ban className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Consultas de hoje */}
                    <div className="bg-gray-900 border border-white/10 rounded-xl">
                      <div className="p-4 border-b border-white/10 flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-indigo-400" />
                          Consultas de Hoje ({ovConsultasHoje.length})
                        </h2>
                        <span className="text-[10px] text-gray-600">Atualiza a cada 60s</span>
                      </div>
                      {ovConsultasHoje.length === 0 ? (
                        <p className="px-4 py-6 text-center text-gray-600 text-xs">Nenhuma consulta agendada para hoje</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-white/5">
                                {['Horário', 'Paciente', 'Link Meet', 'Status Consulta', 'Ações'].map(h => (
                                  <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-medium">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {ovConsultasHoje.map(s => {
                                const scBadge = STATUS_CONSULTA_BADGE[s.status_consulta] ?? STATUS_CONSULTA_BADGE.aguardando
                                return (
                                  <tr key={s.id} className="border-b border-white/5 hover:bg-white/2">
                                    <td className="px-4 py-3 text-indigo-400 font-medium">{s.horario}</td>
                                    <td className="px-4 py-3 text-white">
                                      {s.paciente_nome}
                                      <p className="text-[10px] text-gray-500">Sessão {s.numero_sessao}/{s.total_sessoes}</p>
                                      {s.rotulo_diagnostico && (
                                        <span className="inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-semibold border bg-violet-500/20 text-violet-300 border-violet-500/40">
                                          {s.rotulo_diagnostico}
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-4 py-3">
                                      <LinkMeetCell id={s.id} link={s.link_meet} copiadoId={linkCopiadoId} onCopy={copiarLinkMeet} />
                                    </td>
                                    <td className="px-4 py-3">
                                      <span className={`text-xs px-2 py-0.5 rounded-full ${scBadge.cls}`}>{scBadge.label}</span>
                                      {s.status_consulta === 'em_atendimento' && (
                                        <div className="mt-1"><CronometroSessao iniciadoEm={s.iniciado_em} /></div>
                                      )}
                                    </td>
                                    <td className="px-4 py-3">
                                      <div className="flex items-center gap-1">
                                        <button onClick={() => setProntuarioEmail(s.paciente_email)} title="Ver prontuário"
                                          className="w-7 h-7 shrink-0 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
                                          <ClipboardList className="w-3.5 h-3.5" />
                                        </button>
                                        {(s.status === 'agendada' || s.status === 'pendente') && (s.status_consulta ?? 'aguardando') === 'aguardando' && (
                                          <button onClick={() => { setStatusSessaoId(s.id); setStatusAcao('iniciar'); setStatusErro('') }} title="Iniciar consulta"
                                            className="w-7 h-7 shrink-0 flex items-center justify-center rounded-lg text-blue-400 hover:bg-blue-500/10 transition-colors">
                                            <Play className="w-3.5 h-3.5" />
                                          </button>
                                        )}
                                        {(s.status === 'agendada' || s.status === 'pendente') && (
                                          <button onClick={() => { setStatusSessaoId(s.id); setStatusAcao('concluir'); setConcluirData(nowForDatetimeLocal()); setStatusErro('') }} title="Concluir consulta"
                                            className="w-7 h-7 shrink-0 flex items-center justify-center rounded-lg text-green-500 hover:bg-green-500/10 transition-colors">
                                            <CheckCircle className="w-3.5 h-3.5" />
                                          </button>
                                        )}
                                        {(s.status === 'agendada' || s.status === 'pendente') && (
                                          <button onClick={() => { setStatusSessaoId(s.id); setStatusAcao('nao_compareceu'); setStatusErro('') }} title="Paciente não compareceu"
                                            className="w-7 h-7 shrink-0 flex items-center justify-center rounded-lg text-orange-400 hover:bg-orange-500/10 transition-colors">
                                            <Ban className="w-3.5 h-3.5" />
                                          </button>
                                        )}
                                        {s.status === 'entregue' && (
                                          <button onClick={() => { setStatusSessaoId(s.id); setStatusAcao('anular'); setAnularMotivo(''); setStatusErro('') }} title="Anular sessão"
                                            className="w-7 h-7 shrink-0 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-500/10 transition-colors">
                                            <X className="w-3.5 h-3.5" />
                                          </button>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Consultas entregues hoje — o outro lado de "Consultas de
                        Hoje": assim que a consulta é concluída ela some de lá e
                        cai aqui, senão o dia terminava com o quadro vazio. */}
                    <div className="bg-gray-900 border border-white/10 rounded-xl mt-4">
                      <div className="p-4 border-b border-white/10 flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                          <CheckCircle className="w-4 h-4 text-green-500" />
                          Consultas Entregues — hoje ({ovConsultasEntreguesHoje.length})
                        </h2>
                      </div>
                      {ovConsultasEntreguesHoje.length === 0 ? (
                        <p className="px-4 py-6 text-center text-gray-600 text-xs">Nenhuma consulta entregue hoje</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-white/5">
                                {['Horário', 'Paciente', 'Entregue às', 'Duração', 'Confirmado por', 'Ações'].map(h => (
                                  <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-medium">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {ovConsultasEntreguesHoje.map(s => (
                                <tr key={s.id} className="border-b border-white/5 hover:bg-white/2">
                                  <td className="px-4 py-3 text-gray-400 font-medium">{s.horario}</td>
                                  <td className="px-4 py-3 text-white">
                                    <button onClick={() => setProntuarioEmail(s.paciente_email)}
                                      className="text-left hover:text-indigo-300 transition-colors">
                                      {s.paciente_nome}
                                    </button>
                                    <p className="text-[10px] text-gray-500">Sessão {s.numero_sessao}/{s.total_sessoes}</p>
                                    {s.rotulo_diagnostico && (
                                      <span className="inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-semibold border bg-violet-500/20 text-violet-300 border-violet-500/40">
                                        {s.rotulo_diagnostico}
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-4 py-3">
                                    <span className="text-xs px-2 py-0.5 rounded-full text-green-500 bg-green-500/10">
                                      {s.entregue_as ?? '—'}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-gray-400 text-xs">{s.duracao ?? '—'}</td>
                                  <td className="px-4 py-3 text-gray-400 text-xs">{s.entregue_confirmado_por ?? '—'}</td>
                                  <td className="px-4 py-3">
                                    <div className="flex items-center gap-1">
                                      <button onClick={() => setProntuarioEmail(s.paciente_email)} title="Ver prontuário"
                                        className="w-7 h-7 shrink-0 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors">
                                        <ClipboardList className="w-3.5 h-3.5" />
                                      </button>
                                      <button onClick={() => { setStatusSessaoId(s.id); setStatusAcao('anular'); setAnularMotivo(''); setStatusErro('') }} title="Anular sessão"
                                        className="w-7 h-7 shrink-0 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-500/10 transition-colors">
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Próximas consultas */}
                    <div className="bg-gray-900 border border-white/10 rounded-xl mt-4">
                      <div className="p-4 border-b border-white/10 flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-purple-400" />
                          Próximas Consultas ({ovProximasConsultas.length})
                        </h2>
                      </div>
                      {ovProximasConsultas.length === 0 ? (
                        <p className="px-4 py-6 text-center text-gray-600 text-xs">Nenhuma consulta agendada depois de hoje</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-white/5">
                                {['Data', 'Horário', 'Paciente', 'Link Meet', 'Status Consulta'].map(h => (
                                  <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-medium">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {ovProximasVisiveis.map(s => {
                                const scBadge = STATUS_CONSULTA_BADGE[s.status_consulta] ?? STATUS_CONSULTA_BADGE.aguardando
                                return (
                                  <tr key={s.id} className="border-b border-white/5 hover:bg-white/2">
                                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{s.data}</td>
                                    <td className="px-4 py-3 text-purple-400 font-medium">{s.horario}</td>
                                    <td className="px-4 py-3 text-white">
                                      <button onClick={() => setProntuarioEmail(s.paciente_email)}
                                        className="text-left hover:text-indigo-300 transition-colors">
                                        {s.paciente_nome}
                                      </button>
                                      <p className="text-[10px] text-gray-500">Sessão {s.numero_sessao}/{s.total_sessoes}</p>
                                      {s.rotulo_diagnostico && (
                                        <span className="inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-semibold border bg-violet-500/20 text-violet-300 border-violet-500/40">
                                          {s.rotulo_diagnostico}
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-4 py-3">
                                      <LinkMeetCell id={s.id} link={s.link_meet} copiadoId={linkCopiadoId} onCopy={copiarLinkMeet} />
                                    </td>
                                    <td className="px-4 py-3">
                                      <span className={`text-xs px-2 py-0.5 rounded-full ${scBadge.cls}`}>{scBadge.label}</span>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                          {ovProximasTotalPaginas > 1 && (
                            <Pagination
                              currentPage={ovProximasPaginaAtual}
                              totalPages={ovProximasTotalPaginas}
                              onPrevious={() => setOvProximasPagina(p => Math.max(1, p - 1))}
                              onNext={() => setOvProximasPagina(p => Math.min(ovProximasTotalPaginas, p + 1))}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </>
            )}

            {/* ══════════════ VENDAS ══════════════ */}
            {terapeutaTab === 'vendas' && (
              <>
                <div className="mb-4 flex items-center gap-2">
                  <span className="text-xs text-gray-500">Autenticando como:</span>
                  <span className="text-xs text-gray-300 font-medium">{adminEmail}</span>
                </div>

                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <input type="text" placeholder="Buscar paciente..." value={vBusca} onChange={e => setVBusca(e.target.value)}
                    className="bg-gray-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500/50 w-44" />
                  <select value={vFormato} onChange={e => setVFormato(e.target.value)}
                    className="bg-gray-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500/50">
                    <option value="all">Todos os formatos</option>
                    {formatosDisponiveis.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                  {renderPresetFiltro(vPreset, setVPreset, vDateStart, setVDateStart, vDateEnd, setVDateEnd)}
                </div>

                <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    {[
                      { key: 'pendentes', label: `Pendentes de Agendamento [${pacientesPendentesAgrupados.length}]`, cls: 'bg-amber-600/80' },
                      { key: 'ativos', label: `Pacientes Ativos [${pacientesAtivos.length}]`, cls: 'bg-blue-600/80' },
                      { key: 'concluidos', label: `Concluídos [${pacientesConcluidos.length}]`, cls: 'bg-green-600/80' },
                      { key: 'reembolsados', label: `Reembolsados [${vendasReembolsadas.length}]`, cls: 'bg-gray-600' },
                    ].map(tab => (
                      <button key={tab.key} onClick={() => setVendasSubTab(tab.key as typeof vendasSubTab)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                          vendasSubTab === tab.key ? `${tab.cls} text-white` : 'text-gray-400 hover:text-white border border-white/10'
                        }`}>
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  {!isTerapeutaSession && (
                    <button onClick={() => { setManualErro(''); setManualProduto(`Mentoria Particular - ${terapeuta?.nome ?? ''}`); setManualOpen(true) }}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors">
                      + Lançar paciente manualmente
                    </button>
                  )}
                </div>

                {vendasSubTab === 'pendentes' && (
                  <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-white/10 bg-amber-500/5">
                      <p className="text-xs text-amber-400">
                        {isTerapeutaSession
                          ? 'Vendas aprovadas que ainda não têm nenhuma sessão agendada. O agendamento é feito pelo comercial/CEO — assim que agendarem, a sessão aparece na sua Agenda.'
                          : 'Vendas aprovadas que ainda não têm nenhuma sessão agendada. Clique em "Agendar" pra abrir a venda direto na tela de Agendamentos Pendentes.'}
                      </p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-white/10">
                            {['Data da compra', 'Paciente', 'Produto', 'Vendas', 'Fat. Bruto', 'Líquido', ...(isTerapeutaSession ? [] : ['Ações'])].map(h => (
                              <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-medium whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {pacientesPendentesAgrupados.length === 0 ? (
                            <tr><td colSpan={isTerapeutaSession ? 6 : 7} className="px-4 py-10 text-center text-gray-600 text-xs">Nenhuma venda pendente de agendamento</td></tr>
                          ) : pacientesPendentesAgrupados.map(p => {
                            // Pacote ainda não agendado: nenhuma sessão entregue,
                            // então a etiqueta mostra sempre "sessão 1 de N".
                            const saleDiag = vendasPendentes.find(v => p.saleIds.includes(v.id) && formatoDaVenda(v))
                            const rotulo = progressoDiagnostico(saleDiag, [])?.rotulo ?? null
                            // Vendas do Diagnóstico com oferta fora da tabela: aparecem
                            // com aviso, e o botão "Agendar" delas fica bloqueado - montar
                            // o pacote exige saber o formato, que só a oferta diz.
                            const naoMapeadas = vendasPendentes.filter(v => p.saleIds.includes(v.id) && ofertaDiagnosticoNaoMapeada(v))
                            return (
                            <tr key={p.email} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                              <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDt(p.dataCompraMaisRecente)}</td>
                              <td className="px-4 py-3">
                                <p className="text-white font-medium">{p.nome}</p>
                                <p className="text-xs text-gray-500">{p.email}</p>
                                {rotulo && (
                                  <span className="inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full font-semibold border bg-violet-500/20 text-violet-300 border-violet-500/40">
                                    {rotulo}
                                  </span>
                                )}
                                {naoMapeadas.length > 0 && (
                                  <p className="mt-1 text-[10px] text-amber-400 max-w-[260px]">
                                    Oferta do Diagnóstico Guiado não mapeada{naoMapeadas.length > 1 ? ` (${naoMapeadas.length} vendas)` : ''}: o pacote não pode
                                    ser montado até alguém associar essa oferta a um formato. Avise o time técnico.
                                  </p>
                                )}
                              </td>
                              <td className="px-4 py-3 text-gray-300 text-xs max-w-[200px] truncate">{p.produtos.join(' + ')}</td>
                              <td className="px-4 py-3 text-gray-300 text-xs whitespace-nowrap">{p.qtdVendas > 1 ? `${p.qtdVendas} vendas` : '1 venda'}</td>
                              <td className="px-4 py-3 text-white whitespace-nowrap">{fmtBRL(p.bruto)}</td>
                              <td className="px-4 py-3 text-green-500 whitespace-nowrap">{fmtBRL(p.liquido)}</td>
                              {!isTerapeutaSession && (
                                <td className="px-4 py-3">
                                  <div className="flex flex-wrap gap-1.5">
                                    {p.saleIds.map((sid, i) => (
                                      naoMapeadas.some(v => v.id === sid) ? (
                                        <span key={sid} title="Oferta não mapeada: o formato do pacote é desconhecido."
                                          className="px-2.5 py-1 text-xs font-medium rounded-lg bg-gray-800 text-gray-500 border border-white/10 whitespace-nowrap cursor-not-allowed">
                                          {p.saleIds.length > 1 ? `Venda ${i + 1}: oferta não mapeada` : 'Oferta não mapeada'}
                                        </span>
                                      ) : (
                                      <Link key={sid} href={`/terapeutas/vendas?agendar=${sid}&terapeuta=${id}`}
                                        className="px-2.5 py-1 text-xs font-medium rounded-lg bg-amber-600/80 text-white hover:bg-amber-600 transition-colors whitespace-nowrap">
                                        {p.saleIds.length > 1 ? `Agendar venda ${i + 1}` : 'Agendar'}
                                      </Link>
                                      )
                                    ))}
                                  </div>
                                </td>
                              )}
                            </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {(vendasSubTab === 'ativos' || vendasSubTab === 'concluidos') && (
                  <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-white/10">
                            {['Data da compra', 'Paciente', 'Qtd. Sessões', 'Sessões Feitas', 'Fat. Bruto', 'Líquido', 'Vendedor', 'Progresso', 'Ações'].map(h => (
                              <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-medium whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(vendasSubTab === 'ativos' ? pacientesAtivos : pacientesConcluidos).length === 0 ? (
                            <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-600 text-xs">Nenhum paciente encontrado</td></tr>
                          ) : (vendasSubTab === 'ativos' ? pacientesAtivos : pacientesConcluidos).map(p => {
                            const saleDiag = p.saleIds.map(sid => vendas[sid]).find(v => v && formatoDaVenda(v))
                            const diag = progressoDiagnostico(saleDiag, saleDiag ? sessoesPacoteDiag[saleDiag.id] : undefined)
                            const rotulo = diag?.rotulo ?? null
                            // Quando a linha é UM pacote do Diagnóstico e nada mais, a
                            // barra e o texto passam a contar o pacote inteiro (as duas
                            // agendas), não só as sessões deste terapeuta - senão o Pedro
                            // via "2 de 2 · Concluído" com 7 sessões pendentes da Denise.
                            // Com mais de uma venda no e-mail, o agregado continua valendo:
                            // ele é a soma real do que este terapeuta tem com o paciente.
                            const usaPacote = !!diag && p.saleIds.length === 1
                            const entreguesLinha = usaPacote ? diag!.entregues : p.entregues
                            const totalLinha = usaPacote ? diag!.total : p.total
                            const progresso = totalLinha > 0 ? Math.min((entreguesLinha / totalLinha) * 100, 100) : 0
                            const concluido = entreguesLinha === totalLinha && totalLinha > 0
                            return (
                              <tr key={p.email} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                                <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDt(p.dataCompraMaisRecente)}</td>
                                <td className="px-4 py-3">
                                  <p className="text-white font-medium">{p.nome}</p>
                                  <p className="text-xs text-gray-500">{p.email}</p>
                                  {rotulo && (
                                    <span className="inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full font-semibold border bg-violet-500/20 text-violet-300 border-violet-500/40">
                                      {rotulo}
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-gray-300">{totalLinha}</td>
                                <td className="px-4 py-3 text-green-500 font-medium">{entreguesLinha}</td>
                                <td className="px-4 py-3 text-white whitespace-nowrap">{fmtBRL(p.bruto)}</td>
                                <td className="px-4 py-3 text-green-500 whitespace-nowrap">{fmtBRL(p.liquido)}</td>
                                <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{p.vendedor}</td>
                                <td className="px-4 py-3 min-w-[120px]">
                                  <div className="w-full bg-gray-800 rounded-full h-1.5">
                                    <div className="bg-green-500 h-1.5 rounded-full transition-all" style={{ width: `${progresso}%` }} />
                                  </div>
                                  <p className={`text-[10px] mt-0.5 ${concluido ? 'text-green-500' : 'text-gray-500'}`}>
                                    {concluido ? 'Concluído ✓' : `${entreguesLinha} de ${totalLinha} sessões`}
                                  </p>
                                </td>
                                <td className="px-4 py-3">
                                  <button onClick={() => setProntuarioEmail(p.email)}
                                    className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors whitespace-nowrap">
                                    Ver prontuário
                                  </button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {vendasSubTab === 'reembolsados' && (
                  <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-white/10">
                            {['Data', 'Paciente', 'Formato', 'Valor', 'Status', 'Sessões canceladas'].map(h => (
                              <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-medium">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {vendasReembolsadas.length === 0 ? (
                            <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-600 text-xs">Nenhum reembolso no período</td></tr>
                          ) : vendasReembolsadas.map(sale => {
                            const sessoesVenda = sessoes.filter(s => s.sale_id === sale.id)
                            const canceladas = sessoesVenda.filter(s => s.status === 'cancelada').length
                            const rotulo = progressoDiagnostico(sale, sessoesPacoteDiag[sale.id])?.rotulo ?? null
                            return (
                              <tr key={sale.id} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                                <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDt(sale.data_hora)}</td>
                                <td className="px-4 py-3">
                                  <p className="text-white font-medium">{sale.nome}</p>
                                  <p className="text-xs text-gray-500">{sale.email}</p>
                                  {rotulo && (
                                    <span className="inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full font-semibold border bg-violet-500/20 text-violet-300 border-violet-500/40">
                                      {rotulo}
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-gray-300 text-xs max-w-[180px] truncate">{sale.produto}</td>
                                <td className="px-4 py-3 text-red-400 whitespace-nowrap">{fmtBRL(sale.valor_pago_cliente)}</td>
                                <td className="px-4 py-3">
                                  <span className="text-xs text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full capitalize">{sale.status}</span>
                                </td>
                                <td className="px-4 py-3 text-gray-400">{canceladas > 0 ? canceladas : '—'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ══════════════ AGENDA ══════════════ */}
            {terapeutaTab === 'agenda' && (
              agendaDiaSelecionado ? (
                <AgendaDiaTerapeuta
                  data={agendaDiaSelecionado}
                  sessoes={sessoes
                    .filter(s => s.data_agendada && s.status !== 'cancelada'
                      && new Date(s.data_agendada).toDateString() === agendaDiaSelecionado.toDateString())
                    .map((s): SessaoDia => {
                      // vendas ja traz order_id (correcao desta mesma task) - so
                      // falta repassar o rotulo pro componente da agenda diaria.
                      const formatoSessao = formatoDaVenda(vendas[s.sale_id] ?? { id: s.sale_id, order_id: undefined })
                      return {
                        id: s.id,
                        paciente_nome: s.paciente_nome,
                        numero_sessao: s.numero_sessao,
                        total_sessoes: s.total_sessoes,
                        status: s.status,
                        data_agendada: s.data_agendada as string,
                        rotulo_diagnostico: formatoSessao
                          ? rotuloDiagnostico({ formato: formatoSessao.formato, numeroSessao: s.numero_sessao, totalSessoes: s.total_sessoes })
                          : null,
                      }
                    })}
                  compromissos={compromissos.filter(c =>
                    new Date(c.inicio).toDateString() === agendaDiaSelecionado.toDateString())}
                  duracaoSessaoMinutos={terapeuta?.duracao_sessao_minutos ?? 60}
                  horariosFixos={terapeuta?.horarios_fixos ?? []}
                  onClickSessao={(sessaoDia) => {
                    const sessaoCompleta = sessoes.find(s => s.id === sessaoDia.id)
                    if (sessaoCompleta) setAgendaDetalhe(sessaoCompleta)
                  }}
                  onClickCompromisso={(compromisso) => { setCompromissoApagar(compromisso); setCompromissoApagarErro('') }}
                  onClickLivre={(inicio, fim) => abrirLancarCompromisso(inicio, fim)}
                  onNavegarDia={(dir) => setAgendaDiaSelecionado(d => {
                    if (!d) return d
                    const novo = new Date(d)
                    novo.setDate(novo.getDate() + dir)
                    return novo
                  })}
                  onVoltarMes={() => setAgendaDiaSelecionado(null)}
                />
              ) : (
                <>
                  <div className="mb-4 flex items-center justify-between">
                    <p className="text-sm font-medium text-white">{MESES_NOME[agendaMes]} {agendaAno}</p>
                    <div className="flex items-center gap-1">
                      <button onClick={() => navMesAgenda(-1)} aria-label="Mês anterior" className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button onClick={() => navMesAgenda(1)} aria-label="Próximo mês" className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden">
                    <div className="grid grid-cols-7 border-b border-white/10">
                      {DIAS_SEMANA.map(d => (
                        <div key={d} className="px-2 py-3 text-center text-xs text-gray-500 font-medium">{d}</div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7">
                      {agendaCells.map((dia, idx) => {
                        const ss = dia ? sessoesNoDiaAgenda(dia) : []
                        const isHoje = dia === agendaHojeCell
                        return (
                          <button key={idx} type="button" disabled={!dia}
                            onClick={() => dia && setAgendaDiaSelecionado(new Date(agendaAno, agendaMes, dia))}
                            className={`min-h-[90px] p-1.5 border-b border-r border-white/5 text-left ${!dia ? 'bg-gray-900/50 cursor-default' : 'hover:bg-white/5 transition-colors cursor-pointer'}`}>
                            {dia && (
                              <>
                                <span className={`text-xs font-medium inline-flex w-6 h-6 items-center justify-center rounded-full mb-1 ${
                                  isHoje ? 'bg-indigo-600 text-white' : 'text-gray-400'
                                }`}>{dia}</span>
                                <div className="space-y-0.5">
                                  {ss.slice(0, 3).map(s => (
                                    <div key={s.id}
                                      className="w-full text-left text-[10px] px-1.5 py-0.5 rounded bg-indigo-600/20 text-indigo-300 truncate">
                                      {s.data_agendada ? new Date(s.data_agendada).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''} {s.paciente_nome.split(' ')[0]}
                                    </div>
                                  ))}
                                  {ss.length > 3 && (
                                    <span className="text-[10px] text-gray-500">+{ss.length - 3} mais</span>
                                  )}
                                  <p className="text-[10px] text-green-500/70 mt-0.5">{previewVagosNoDia(dia)}</p>
                                </div>
                              </>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </>
              )
            )}

            {/* ══════════════ FECHAMENTOS ══════════════ */}
            {terapeutaTab === 'fechamentos' && (
              fechamentosLoading ? (
                <div className="flex items-center justify-center h-40">
                  <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-white/10">
                    <h2 className="text-sm font-semibold text-white">Histórico de fechamentos ({fechamentos.length})</h2>
                  </div>
                  {fechamentos.length === 0 ? (
                    <p className="px-4 py-8 text-center text-gray-600 text-xs">Nenhum fechamento de comissão realizado ainda</p>
                  ) : (
                    <div className="divide-y divide-white/5">
                      {fechamentos.map(f => (
                        <div key={f.id}>
                          <button onClick={() => { setFechamentoExpandido(e => e === f.id ? null : f.id); setFechamentoSessoesPage(1) }}
                            className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/2 transition-colors">
                            <div className="text-left">
                              <p className="text-sm text-white">{fmtDt(f.data_confirmacao)}</p>
                              <p className="text-xs text-gray-500">{f.quantidade_sessoes} sessão(ões)</p>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-semibold text-green-500">{fmtBRL(f.valor_total)}</span>
                              {fechamentoExpandido === f.id ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
                            </div>
                          </button>
                          {fechamentoExpandido === f.id && (
                            <div className="px-4 pb-4">
                              <div className="flex justify-end mb-2">
                                <button onClick={() => exportFechamentoCSV(f)}
                                  className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg transition-colors">
                                  <Download className="w-3.5 h-3.5" /> Baixar CSV
                                </button>
                              </div>
                              <div className="overflow-x-auto bg-gray-800/40 rounded-lg">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="border-b border-white/5">
                                      {['Paciente', 'Sessão', 'Data entrega', 'Comissão'].map(h => (
                                        <th key={h} className="px-3 py-2 text-left text-gray-500 font-medium">{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {f.sessoes
                                      .slice((fechamentoSessoesPage - 1) * FECHAMENTO_SESSOES_PAGE_SIZE, fechamentoSessoesPage * FECHAMENTO_SESSOES_PAGE_SIZE)
                                      .map(s => (
                                      <tr key={s.id} className="border-b border-white/5">
                                        <td className="px-3 py-2 text-white">{s.paciente_nome}</td>
                                        <td className="px-3 py-2 text-gray-300">{s.numero_sessao} de {s.total_sessoes}</td>
                                        <td className="px-3 py-2 text-gray-400 whitespace-nowrap">{fmtDt(s.data_entrega)}</td>
                                        <td className="px-3 py-2 text-green-500 whitespace-nowrap">{fmtBRL(s.comissao_valor)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              {f.sessoes.length > FECHAMENTO_SESSOES_PAGE_SIZE && (
                                <Pagination
                                  currentPage={fechamentoSessoesPage}
                                  totalPages={Math.ceil(f.sessoes.length / FECHAMENTO_SESSOES_PAGE_SIZE)}
                                  onPrevious={() => setFechamentoSessoesPage(p => Math.max(1, p - 1))}
                                  onNext={() => setFechamentoSessoesPage(p => Math.min(Math.ceil(f.sessoes.length / FECHAMENTO_SESSOES_PAGE_SIZE), p + 1))}
                                />
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            )}
          </>
        )}
      </main>

      {/* Modal anular — precisa de motivo antes da senha */}
      {statusSessaoId && statusAcao === 'anular' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-sm font-semibold text-white mb-1">Anular sessão concluída</h3>
            <p className="text-xs text-gray-400 mb-4">Informe o motivo da anulação. A sessão voltará ao status &quot;Agendada&quot;.</p>
            <textarea value={anularMotivo} onChange={e => setAnularMotivo(e.target.value)} rows={3}
              placeholder="Motivo da anulação (mínimo 10 caracteres)..."
              className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500/50 resize-none mb-3" />
            {statusErro && <p className="text-xs text-red-400 mb-3">{statusErro}</p>}
            <div className="flex gap-2">
              <button onClick={() => { setStatusSessaoId(null); setAnularMotivo('') }}
                className="flex-1 px-3 py-2 text-sm text-gray-400 bg-gray-800 border border-white/10 rounded-lg">Cancelar</button>
              <button onClick={() => {
                if (anularMotivo.trim().length < 10) { setStatusErro('Mínimo 10 caracteres'); return }
                setStatusErro('')
              }}
                className="flex-1 px-3 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors">
                Próximo →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal concluir — precisa da data de entrega antes da senha */}
      {statusSessaoId && statusAcao === 'concluir' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-sm font-semibold text-white mb-1">Concluir sessão</h3>
            <p className="text-xs text-gray-400 mb-4">Data e horário em que a sessão foi de fato entregue (pode ser uma data passada, no caso de lançamento manual).</p>
            <input type="datetime-local" value={concluirData} onChange={e => setConcluirData(e.target.value)}
              className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-green-500/50 mb-3" />
            {statusErro && <p className="text-xs text-red-400 mb-3">{statusErro}</p>}
            <div className="flex gap-2">
              <button onClick={() => { setStatusSessaoId(null); setConcluirData('') }}
                className="flex-1 px-3 py-2 text-sm text-gray-400 bg-gray-800 border border-white/10 rounded-lg">Cancelar</button>
              <button onClick={() => {
                if (!concluirData) { setStatusErro('Informe a data de entrega'); return }
                setStatusErro('')
              }}
                className="flex-1 px-3 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-500 rounded-lg transition-colors">
                Próximo →
              </button>
            </div>
          </div>
        </div>
      )}

      <SenhaModal
        dispensarSenha={dispensaSenha}
        isOpen={!!statusSessaoId && (statusAcao !== 'anular' || anularMotivo.trim().length >= 10) && (statusAcao !== 'concluir' || !!concluirData)}
        onClose={() => { setStatusSessaoId(null); setStatusErro(''); setAnularMotivo(''); setConcluirData('') }}
        onConfirm={handleStatusAcao}
        titulo={
          statusAcao === 'iniciar' ? 'Iniciar consulta'
          : statusAcao === 'concluir' ? 'Concluir consulta'
          : statusAcao === 'nao_compareceu' ? 'Registrar não comparecimento'
          : 'Anular sessão'
        }
        descricao="Digite sua senha para confirmar"
        loading={statusLoading}
        erro={statusErro}
      />

      {/* Modal remarcar — data primeiro (visão admin) */}
      {remarcarSessaoId && !remarcarSenhaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-sm font-semibold text-white mb-4">Remarcar sessão</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Nova data e hora</label>
                <input type="datetime-local" value={remarcarData} onChange={e => setRemarcarData(e.target.value)}
                  className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Motivo (opcional)</label>
                <input type="text" value={remarcarMotivo} onChange={e => setRemarcarMotivo(e.target.value)}
                  placeholder="Ex: Paciente solicitou"
                  className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setRemarcarSessaoId(null)} className="flex-1 px-4 py-2 text-sm text-gray-400 bg-gray-800 border border-white/10 rounded-lg">Cancelar</button>
              <button onClick={() => { if (!remarcarData) return; setRemarcarSenhaModal(true) }}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors">
                Próximo
              </button>
            </div>
          </div>
        </div>
      )}

      <SenhaModal
        dispensarSenha={dispensaSenha}
        isOpen={remarcarSenhaModal}
        onClose={() => { setRemarcarSenhaModal(false); setRemarcarErro('') }}
        onConfirm={handleRemarcar}
        titulo="Confirmar remarcação"
        descricao="Digite sua senha para remarcar a sessão"
        loading={remarcarLoading}
        erro={remarcarErro}
      />

      {/* Modal: PRONTUÁRIO (visão terapeuta) — sem ações de agenda */}
      {prontuarioPaciente && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-white/10 rounded-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">

            <div className="sticky top-0 bg-gray-900 border-b border-white/10 px-6 py-4 flex items-start justify-between z-10">
              <div>
                <h3 className="text-sm font-semibold text-white">Prontuário — {prontuarioPaciente.nome}</h3>
                <p className="text-xs text-gray-400 mt-0.5">{prontuarioPaciente.email}</p>
              </div>
              <button onClick={() => setProntuarioEmail(null)} className="text-gray-500 hover:text-white mt-0.5">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-6">

              {/* SEÇÃO 1 — Informações do paciente */}
              {prontuarioSaleMaisRecente && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Informações do paciente</h4>
                    {!editandoPaciente && (
                      <button onClick={() => {
                        setEditNome(prontuarioSaleMaisRecente.nome)
                        setEditEmail(prontuarioSaleMaisRecente.email)
                        setEditTelefone(prontuarioSaleMaisRecente.telefone ?? '')
                        setEditErro('')
                        setEditandoPaciente(true)
                      }} className="text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors">
                        ✏️ Editar
                      </button>
                    )}
                  </div>

                  {editandoPaciente ? (
                    <div className="bg-gray-800/50 border border-white/5 rounded-xl p-4 space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <label className="text-[10px] text-gray-500 block mb-1">Nome <span className="text-red-400">*</span></label>
                          <input type="text" value={editNome} onChange={e => setEditNome(e.target.value)}
                            className="w-full bg-gray-700 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50" />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500 block mb-1">E-mail <span className="text-red-400">*</span></label>
                          <input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)}
                            className="w-full bg-gray-700 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50" />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500 block mb-1">Telefone</label>
                          <input type="text" value={editTelefone} onChange={e => setEditTelefone(e.target.value)}
                            className="w-full bg-gray-700 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50" />
                        </div>
                      </div>
                      <p className="text-[10px] text-gray-500">Formato comprado, data da compra e plataforma não são editáveis aqui — só nome, e-mail e telefone.</p>
                      {editErro && <p className="text-xs text-red-400">{editErro}</p>}
                      <div className="flex gap-2">
                        <button onClick={() => { setEditandoPaciente(false); setEditErro('') }}
                          className="px-3 py-1.5 text-xs text-gray-400 bg-gray-700 rounded-lg">Cancelar</button>
                        <button onClick={() => {
                          if (!editValido) { setEditErro('Preencha nome e e-mail'); return }
                          setEditErro(''); setEditSenhaOpen(true)
                        }} disabled={!editValido}
                          className="px-4 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg transition-colors">
                          Salvar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {[
                        { label: 'Nome', value: prontuarioSaleMaisRecente.nome },
                        { label: 'E-mail', value: prontuarioSaleMaisRecente.email },
                        { label: 'Telefone', value: prontuarioSaleMaisRecente.telefone ?? '—' },
                        { label: 'Formato comprado', value: prontuarioSaleMaisRecente.produto },
                        { label: 'Data da compra', value: fmtDt(prontuarioSaleMaisRecente.data_hora) },
                        { label: 'Plataforma', value: prontuarioSaleMaisRecente.plataforma ?? '—' },
                      ].map(({ label, value }) => (
                        <div key={label} className="bg-gray-800/40 rounded-lg p-3">
                          <p className="text-[10px] text-gray-500 mb-0.5">{label}</p>
                          <p className="text-xs text-white">{value}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* SEÇÃO 2 — Histórico de sessões (somente leitura) */}
              <div>
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  Histórico de sessões ({prontuarioSessoesOrdenadas.length})
                </h4>

                {prontuarioSessoesOrdenadas.length > 0 && (
                  <div className="mb-4">
                    <div className="w-full bg-gray-800 rounded-full h-2">
                      <div className="bg-green-500 h-2 rounded-full transition-all"
                        style={{ width: `${(prontuarioPaciente.entregues / prontuarioPaciente.total) * 100}%` }} />
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1">{prontuarioPaciente.entregues} de {prontuarioPaciente.total} sessões entregues</p>
                  </div>
                )}

                <div className="space-y-3">
                  {prontuarioSessoesOrdenadas.length === 0 ? (
                    <p className="text-xs text-gray-600 text-center py-4">Nenhuma sessão criada ainda.</p>
                  ) : prontuarioSessoesOrdenadas.map(s => {
                    const badge = STATUS_LABEL[s.status] ?? { label: s.status, color: 'text-gray-400 bg-gray-400/10' }
                    const remarcacoesSessao = remarcacoes[s.id] ?? []
                    // Diagnóstico Guiado é um pacote dividido entre dois
                    // terapeutas - quem lê o prontuário precisa saber que essa
                    // sessão não é avulsa, é parte de um bloco maior.
                    const formatoSessao = formatoDaVenda(vendas[s.sale_id] ?? { id: s.sale_id, order_id: undefined })
                    return (
                      <div key={s.id} className="bg-gray-800/40 border border-white/5 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-3 flex-wrap">
                          <span className="text-xs text-gray-500 font-medium">Sessão {s.numero_sessao} de {s.total_sessoes}</span>
                          <span className={`text-[11px] px-2 py-0.5 rounded-full ${badge.color}`}>{badge.label}</span>
                          {s.numero_sessao === s.total_sessoes && (
                            <span className="text-[10px] text-red-400 border border-red-400/30 px-1.5 py-0.5 rounded">Última sessão</span>
                          )}
                          {formatoSessao && (
                            <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold border bg-violet-500/20 text-violet-300 border-violet-500/40">
                              {rotuloDiagnostico({ formato: formatoSessao.formato, numeroSessao: s.numero_sessao, totalSessoes: s.total_sessoes })}
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-1">
                          <div>
                            <p className="text-gray-500">Data agendada</p>
                            <p className="text-white">{fmtDt(s.data_agendada)}</p>
                          </div>
                          {s.status === 'entregue' && (
                            <div>
                              <p className="text-gray-500">Data entregue</p>
                              <p className="text-green-500">{fmtDt(s.data_entrega)}</p>
                            </div>
                          )}
                          <div>
                            <p className="text-gray-500">Comissão</p>
                            <p className="text-green-500">{fmtBRL(s.comissao_valor)}</p>
                          </div>
                          {s.link_meet && (
                            <div>
                              <p className="text-gray-500">Link Meet</p>
                              <LinkMeetCell id={s.id} link={s.link_meet} copiadoId={linkCopiadoId} onCopy={copiarLinkMeet} />
                            </div>
                          )}
                        </div>

                        {remarcacoesSessao.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
                            <p className="text-[10px] text-gray-500 uppercase tracking-wide font-medium">
                              Histórico de remarcações ({remarcacoesSessao.length})
                            </p>
                            {remarcacoesSessao.map(r => (
                              <div key={r.id} className="bg-yellow-500/5 border border-yellow-500/15 rounded-lg p-2.5 text-xs space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-yellow-400 text-[10px] font-medium px-1.5 py-0.5 bg-yellow-400/10 rounded">⚠️ Remarcada</span>
                                  <span className="text-gray-500 text-[10px]">Remarcado em {fmtDt(r.created_at)}</span>
                                </div>
                                <p className="text-gray-400"><span className="text-gray-500">De:</span> {fmtDt(r.data_anterior)} → <span className="text-gray-500">Para:</span> {fmtDt(r.data_nova)}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* SEÇÃO 3 — Ocorrências */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Ocorrências</h4>
                  {ocorrenciaTipo === null && (
                    <button onClick={() => setOcorrenciaTipo('select')}
                      className="text-xs text-green-500 hover:text-green-400 font-medium transition-colors">
                      + Registrar Ocorrência
                    </button>
                  )}
                </div>

                {/* Seleção de tipo */}
                {ocorrenciaTipo === 'select' && (
                  <div className="bg-gray-800/50 border border-white/5 rounded-xl p-4 mb-4">
                    <p className="text-xs text-gray-400 mb-3 font-medium">Selecione o tipo de ocorrência:</p>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      {[
                        { tipo: 'nota' as const, icon: '📝', title: 'Nota / Observação', desc: 'Registre uma nota ou observação sobre o paciente' },
                        { tipo: 'remarcacao' as const, icon: '📅', title: 'Remarcar Consulta', desc: 'Solicite a remarcação de uma consulta agendada' },
                        { tipo: 'reembolso' as const, icon: '💰', title: 'Solicitação de Reembolso Parcial', desc: 'Reembolso de sessões não realizadas — vai para aprovação do CEO' },
                        { tipo: 'orientacao' as const, icon: '📣', title: 'Orientação da Sessão', desc: 'Vai automaticamente no lembrete de 30min (grupo do terapeuta e paciente)' },
                      ].map(({ tipo, icon, title, desc }) => (
                        <button key={tipo} onClick={() => setOcorrenciaTipo(tipo)}
                          className="text-left p-3 bg-gray-800 hover:bg-gray-700 border border-white/10 hover:border-white/20 rounded-xl transition-colors">
                          <p className="text-base mb-1">{icon}</p>
                          <p className="text-xs font-medium text-white mb-1">{title}</p>
                          <p className="text-[10px] text-gray-500 leading-relaxed">{desc}</p>
                        </button>
                      ))}
                    </div>
                    <button onClick={() => setOcorrenciaTipo(null)}
                      className="mt-3 text-xs text-gray-500 hover:text-gray-400 transition-colors">Cancelar</button>
                  </div>
                )}

                {/* Formulário: NOTA */}
                {ocorrenciaTipo === 'nota' && (
                  <div className="bg-gray-800/50 border border-white/5 rounded-xl p-4 mb-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-white">📝 Nova nota / observação</p>
                      <button onClick={() => setOcorrenciaTipo(null)} className="text-gray-500 hover:text-white"><X className="w-3.5 h-3.5" /></button>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Título <span className="text-red-400">*</span></label>
                      <input type="text" value={notaTitulo} onChange={e => setNotaTitulo(e.target.value)} maxLength={100}
                        placeholder="Ex: Observação após sessão 2..."
                        className="w-full bg-gray-700 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Vincular a uma sessão (opcional)</label>
                      <select value={notaSessaoId} onChange={e => setNotaSessaoId(e.target.value)}
                        className="w-full bg-gray-700 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50">
                        <option value="">Nota geral (sem sessão específica)</option>
                        {prontuarioSessoesOrdenadas.map(s => (
                          <option key={s.id} value={s.id}>
                            Sessão {s.numero_sessao} — {fmtDt(s.data_agendada)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Descrição <span className="text-red-400">*</span> (mín. 10 caracteres)</label>
                      <textarea value={notaDesc} onChange={e => setNotaDesc(e.target.value)} rows={4}
                        placeholder="Descreva a nota ou observação sobre este paciente..."
                        className="w-full bg-gray-700 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50 resize-y" />
                      <p className="text-[10px] text-gray-600 mt-0.5">{notaDesc.length} caracteres</p>
                    </div>
                    {notaErro && <p className="text-xs text-red-400">{notaErro}</p>}
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => setOcorrenciaTipo(null)}
                        className="px-3 py-1.5 text-xs text-gray-400 bg-gray-700 rounded-lg">Cancelar</button>
                      <button onClick={() => { if (!notaValida) { setNotaErro('Preencha o título e a descrição (mín. 10 caracteres)'); return } setNotaErro(''); setNotaSenhaOpen(true) }}
                        disabled={!notaValida}
                        className="px-4 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg transition-colors">
                        Salvar nota
                      </button>
                    </div>
                  </div>
                )}

                {/* Formulário: REMARCAR */}
                {ocorrenciaTipo === 'remarcacao' && (
                  <div className="bg-gray-800/50 border border-white/5 rounded-xl p-4 mb-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-white">📅 Remarcar consulta</p>
                      <button onClick={() => setOcorrenciaTipo(null)} className="text-gray-500 hover:text-white"><X className="w-3.5 h-3.5" /></button>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Qual sessão remarcar? <span className="text-red-400">*</span></label>
                      <select value={remSessaoId} onChange={e => {
                        const s = prontuarioSessoesOrdenadas.find(x => x.id === e.target.value)
                        setRemSessaoId(e.target.value)
                        setRemNovaData(s?.data_agendada ? isoToDatetimeLocalBRT(s.data_agendada) : '')
                      }} className="w-full bg-gray-700 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50">
                        <option value="">Selecionar sessão...</option>
                        {sessoesPendentesProntuario.map(s => (
                          <option key={s.id} value={s.id}>
                            Sessão {s.numero_sessao} — {fmtDt(s.data_agendada)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-gray-500 block mb-1">Nova data e horário <span className="text-red-400">*</span></label>
                        <input type="datetime-local" value={remNovaData} onChange={e => setRemNovaData(e.target.value)}
                          className="w-full bg-gray-700 border border-white/10 rounded-lg px-2 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50" />
                        {remNovaData && new Date(remNovaData) <= new Date() && (
                          <p className="text-[10px] text-red-400 mt-0.5">A nova data deve ser no futuro</p>
                        )}
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500 block mb-1">Solicitado por <span className="text-red-400">*</span></label>
                        <select value={remSolicitadoPor} onChange={e => setRemSolicitadoPor(e.target.value)}
                          className="w-full bg-gray-700 border border-white/10 rounded-lg px-2 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50">
                          <option value="">Selecionar...</option>
                          <option value="paciente">Paciente</option>
                          <option value="terapeuta">Terapeuta</option>
                          <option value="comercial">Comercial/Admin</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Motivo da remarcação <span className="text-red-400">*</span> (mín. 10 caracteres)</label>
                      <textarea value={remMotivo} onChange={e => setRemMotivo(e.target.value)} rows={3}
                        placeholder="Descreva o motivo pelo qual a consulta está sendo remarcada..."
                        className="w-full bg-gray-700 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50 resize-y" />
                      {remMotivo.length > 0 && remMotivo.length < 10 && (
                        <p className="text-[10px] text-red-400 mt-0.5">O motivo é obrigatório (mínimo 10 caracteres)</p>
                      )}
                    </div>
                    {remErro && <p className="text-xs text-red-400">{remErro}</p>}
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => setOcorrenciaTipo(null)}
                        className="px-3 py-1.5 text-xs text-gray-400 bg-gray-700 rounded-lg">Cancelar</button>
                      <button onClick={() => {
                        if (!remSessaoId) { setRemErro('Selecione a sessão'); return }
                        if (!remSolicitadoPor) { setRemErro('Informe quem solicitou a remarcação'); return }
                        if (remMotivo.length < 10) { setRemErro('Descreva o motivo com pelo menos 10 caracteres'); return }
                        if (!remNovaData || new Date(remNovaData) <= new Date()) { setRemErro('A nova data deve ser no futuro'); return }
                        setRemErro(''); setRemSenhaOpen(true)
                      }} disabled={!remValido}
                        className="px-4 py-1.5 text-xs font-medium text-white bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 rounded-lg transition-colors">
                        Confirmar remarcação
                      </button>
                    </div>
                  </div>
                )}

                {/* Formulário: REEMBOLSO */}
                {ocorrenciaTipo === 'reembolso' && (
                  <div className="bg-gray-800/50 border border-white/5 rounded-xl p-4 mb-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-white">💰 Solicitação de reembolso parcial</p>
                      <button onClick={() => setOcorrenciaTipo(null)} className="text-gray-500 hover:text-white"><X className="w-3.5 h-3.5" /></button>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-2">Sessões elegíveis para reembolso <span className="text-red-400">*</span></label>
                      {sessoesPendentesProntuario.length === 0 ? (
                        <p className="text-xs text-gray-600">Nenhuma sessão pendente/agendada para reembolso.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {sessoesPendentesProntuario.map(s => {
                            const valorSessao = prontuarioPaciente
                              ? prontuarioPaciente.bruto / (totalProntuario || 1)
                              : 0
                            return (
                              <label key={s.id} className="flex items-center gap-2.5 cursor-pointer p-2 bg-gray-700/50 rounded-lg hover:bg-gray-700">
                                <input type="checkbox" checked={reeSessoes.includes(s.id)}
                                  onChange={e => setReeSessoes(p => e.target.checked ? [...p, s.id] : p.filter(x => x !== s.id))}
                                  className="accent-indigo-500 w-3.5 h-3.5" />
                                <span className="text-xs text-white">
                                  Sessão {s.numero_sessao} — {fmtDt(s.data_agendada)} — <span className="text-green-500">{fmtBRL(valorSessao)}</span>
                                </span>
                              </label>
                            )
                          })}
                        </div>
                      )}
                    </div>
                    {reembolsoCalc && (
                      <div className="bg-gray-700/50 rounded-lg p-3 space-y-1">
                        <p className="text-[10px] text-gray-500">Cálculo por tabela de preços:</p>
                        <p className="text-lg font-bold text-red-400">{fmtBRL(reembolsoCalc.valor_reembolso)}</p>
                        <p className="text-[11px] text-gray-400 leading-relaxed">{reembolsoCalc.explicacao}</p>
                      </div>
                    )}
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Motivo do reembolso <span className="text-red-400">*</span> (mín. 20 caracteres)</label>
                      <textarea value={reeMotivo} onChange={e => setReeMotivo(e.target.value)} rows={3}
                        placeholder="Descreva detalhadamente o motivo do reembolso..."
                        className="w-full bg-gray-700 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50 resize-y" />
                      {reeMotivo.length > 0 && reeMotivo.length < 20 && (
                        <p className="text-[10px] text-red-400 mt-0.5">{20 - reeMotivo.length} caracteres restantes</p>
                      )}
                    </div>
                    <div className="flex items-start gap-2 bg-yellow-500/8 border border-yellow-500/20 rounded-lg p-3">
                      <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 shrink-0 mt-0.5" />
                      <p className="text-[11px] text-yellow-400">Esta solicitação será enviada para aprovação do CEO antes de ser processada. As sessões NÃO serão canceladas imediatamente.</p>
                    </div>
                    {reeErro && <p className="text-xs text-red-400">{reeErro}</p>}
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => setOcorrenciaTipo(null)}
                        className="px-3 py-1.5 text-xs text-gray-400 bg-gray-700 rounded-lg">Cancelar</button>
                      <button onClick={() => {
                        if (reeSessoes.length === 0) { setReeErro('Selecione pelo menos uma sessão'); return }
                        if (reeMotivo.length < 20) { setReeErro('Descreva o motivo com pelo menos 20 caracteres'); return }
                        setReeErro(''); setReeSenhaOpen(true)
                      }} disabled={!reeValido}
                        className="px-4 py-1.5 text-xs font-medium text-white bg-orange-600 hover:bg-orange-500 disabled:opacity-50 rounded-lg transition-colors">
                        Enviar solicitação
                      </button>
                    </div>
                  </div>
                )}

                {/* Formulário: ORIENTAÇÃO DA SESSÃO */}
                {ocorrenciaTipo === 'orientacao' && (
                  <div className="bg-gray-800/50 border border-white/5 rounded-xl p-4 mb-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-white">📣 {orientEditandoId ? 'Editar orientação da sessão' : 'Nova orientação da sessão'}</p>
                      <button onClick={() => { setOcorrenciaTipo(null); setOrientSessaoId(''); setOrientDesc(''); setOrientEditandoId(null); setOrientErro('') }}
                        className="text-gray-500 hover:text-white"><X className="w-3.5 h-3.5" /></button>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Qual sessão? <span className="text-red-400">*</span></label>
                      <select value={orientSessaoId} disabled={!!orientEditandoId} onChange={e => {
                        const sid = e.target.value
                        setOrientSessaoId(sid)
                        const existente = orientacaoExistentePorSessao[sid]
                        if (existente) {
                          setOrientEditandoId(existente.id)
                          setOrientDesc(existente.descricao)
                        } else {
                          setOrientEditandoId(null)
                          setOrientDesc('')
                        }
                      }} className="w-full bg-gray-700 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50 disabled:opacity-60">
                        <option value="">Selecionar sessão...</option>
                        {sessoesPendentesProntuario.map(s => (
                          <option key={s.id} value={s.id}>
                            Sessão {s.numero_sessao} — {fmtDt(s.data_agendada)}{orientacaoExistentePorSessao[s.id] ? ' (já tem orientação — editar)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    {orientBloqueadaPorPrazo && (
                      <p className="text-[11px] text-amber-400">⚠️ Faltam menos de 40 minutos para essa sessão — não dá mais tempo de entrar no lembrete automático de 30min. Não é possível registrar/editar.</p>
                    )}
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Título</label>
                      <input type="text" value="ORIENTAÇÃO DA SESSÃO:" disabled
                        className="w-full bg-gray-700/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-400" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Descrição <span className="text-red-400">*</span> (mín. 10 caracteres)</label>
                      <textarea value={orientDesc} onChange={e => setOrientDesc(e.target.value)} rows={4}
                        placeholder="Ex: Hoje nessa sessão será o marido dela que vai fazer, ele questionou..."
                        className="w-full bg-gray-700 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50 resize-y" />
                    </div>
                    {orientErro && <p className="text-xs text-red-400">{orientErro}</p>}
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => { setOcorrenciaTipo(null); setOrientSessaoId(''); setOrientDesc(''); setOrientEditandoId(null); setOrientErro('') }}
                        className="px-3 py-1.5 text-xs text-gray-400 bg-gray-700 rounded-lg">Cancelar</button>
                      <button onClick={() => {
                        if (!orientSessaoId) { setOrientErro('Selecione a sessão'); return }
                        if (orientDesc.trim().length < 10) { setOrientErro('Descreva com pelo menos 10 caracteres'); return }
                        if (orientBloqueadaPorPrazo) { setOrientErro('Faltam menos de 40 minutos para a sessão'); return }
                        setOrientErro(''); setOrientSenhaOpen(true)
                      }} disabled={!orientValida}
                        className="px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors">
                        {orientEditandoId ? 'Salvar edição' : 'Registrar orientação'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Lista de ocorrências — agrupada por sessão */}
                <div className="space-y-4">
                  {prontuarioOcorrencias.length === 0 ? (
                    <p className="text-xs text-gray-600 text-center py-4">Nenhuma ocorrência registrada.</p>
                  ) : (
                    <>
                      {ocorrenciasAgrupadasPorSessao.porSessao.map(({ sessao, ocorrencias: lista }) => (
                        <div key={sessao.id}>
                          <p className="text-[11px] font-semibold text-gray-400 mb-2">
                            Sessão {sessao.numero_sessao} — {fmtDt(sessao.data_agendada)}
                          </p>
                          <div className="space-y-2">
                            {lista.map(o => {
                              const meta = OCORRENCIA_META[o.tipo] ?? { icon: '📌', label: o.tipo, cls: 'text-gray-400 bg-gray-400/10 border-gray-400/20' }
                              return (
                                <div key={o.id} className={`border rounded-xl p-3 ${meta.cls}`}>
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                      <span>{meta.icon}</span>
                                      <span className="text-[11px] font-medium">{meta.label}</span>
                                    </div>
                                    <span className="text-[10px] opacity-60">{fmtDt(o.created_at)}</span>
                                  </div>
                                  <p className="text-xs text-white font-medium mb-0.5">{o.titulo}</p>
                                  <p className="text-xs opacity-80 leading-relaxed">{o.descricao}</p>
                                  <p className="text-[10px] opacity-50 mt-2">
                                    Registrado por {o.criado_por_nome} ({o.criado_por_tipo})
                                  </p>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                      {ocorrenciasAgrupadasPorSessao.geral.length > 0 && (
                        <div>
                          <p className="text-[11px] font-semibold text-gray-400 mb-2">Geral</p>
                          <div className="space-y-2">
                            {ocorrenciasAgrupadasPorSessao.geral.map(o => {
                              const meta = OCORRENCIA_META[o.tipo] ?? { icon: '📌', label: o.tipo, cls: 'text-gray-400 bg-gray-400/10 border-gray-400/20' }
                              return (
                                <div key={o.id} className={`border rounded-xl p-3 ${meta.cls}`}>
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                      <span>{meta.icon}</span>
                                      <span className="text-[11px] font-medium">{meta.label}</span>
                                    </div>
                                    <span className="text-[10px] opacity-60">{fmtDt(o.created_at)}</span>
                                  </div>
                                  <p className="text-xs text-white font-medium mb-0.5">{o.titulo}</p>
                                  <p className="text-xs opacity-80 leading-relaxed">{o.descricao}</p>
                                  <p className="text-[10px] opacity-50 mt-2">
                                    Registrado por {o.criado_por_nome} ({o.criado_por_tipo})
                                  </p>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      <SenhaModal
        dispensarSenha={dispensaSenha}
        isOpen={notaSenhaOpen}
        onClose={() => { setNotaSenhaOpen(false); setNotaErro('') }}
        onConfirm={handleNota}
        titulo="Salvar nota"
        descricao="Digite sua senha para registrar a ocorrência"
        loading={notaLoading}
        erro={notaErro}
      />

      <SenhaModal
        dispensarSenha={dispensaSenha}
        isOpen={editSenhaOpen}
        onClose={() => { setEditSenhaOpen(false); setEditErro('') }}
        onConfirm={handleEditarPaciente}
        titulo="Salvar dados do paciente"
        descricao="Digite sua senha para confirmar a edição"
        loading={editLoading}
        erro={editErro}
      />

      <SenhaModal
        dispensarSenha={dispensaSenha}
        isOpen={remSenhaOpen}
        onClose={() => { setRemSenhaOpen(false); setRemErro('') }}
        onConfirm={handleRemarcarOcorrencia}
        titulo="Confirmar remarcação"
        descricao="Digite sua senha para remarcar a sessão"
        loading={remLoading}
        erro={remErro}
      />

      <SenhaModal
        dispensarSenha={dispensaSenha}
        isOpen={orientSenhaOpen}
        onClose={() => { setOrientSenhaOpen(false); setOrientErro('') }}
        onConfirm={handleOrientacao}
        titulo={orientEditandoId ? 'Salvar edição da orientação' : 'Registrar orientação'}
        descricao="Digite sua senha para confirmar"
        loading={orientLoading}
        erro={orientErro}
      />

      <SenhaModal
        dispensarSenha={dispensaSenha}
        isOpen={reeSenhaOpen}
        onClose={() => { setReeSenhaOpen(false); setReeErro('') }}
        onConfirm={handleReembolso}
        titulo="Enviar solicitação de reembolso"
        descricao="Digite sua senha para enviar para aprovação do CEO"
        loading={reeLoading}
        erro={reeErro}
      />

      {/* Modal: Lançamento manual de paciente (venda + sessões) */}
      {manualOpen && !manualSenhaOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Lançar paciente manualmente</h3>
              <button onClick={() => setManualOpen(false)} className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-gray-500 mb-4">Cria a venda e as sessões numa tacada só — para pacientes já em atendimento fora do sistema.</p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Nome do paciente</label>
                  <input type="text" value={manualNome} onChange={e => setManualNome(e.target.value)}
                    className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">E-mail</label>
                  <input type="email" value={manualEmail} onChange={e => setManualEmail(e.target.value)}
                    className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Telefone</label>
                <input type="text" value={manualTelefone} onChange={e => setManualTelefone(e.target.value)}
                  className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Produto</label>
                  <input type="text" value={manualProduto} onChange={e => setManualProduto(e.target.value)}
                    className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Plataforma</label>
                  <select value={manualPlataforma} onChange={e => setManualPlataforma(e.target.value)}
                    className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50">
                    <option value="hubla">Hubla</option>
                    <option value="kiwify">Kiwify</option>
                    <option value="manual">Manual</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Valor bruto (R$)</label>
                  <input type="text" inputMode="decimal" value={manualValorBruto} onChange={e => setManualValorBruto(e.target.value)}
                    placeholder="0,00"
                    className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Valor líquido (R$)</label>
                  <input type="text" inputMode="decimal" value={manualValorLiquido} onChange={e => setManualValorLiquido(e.target.value)}
                    placeholder="0,00"
                    className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Data da compra</label>
                <input type="datetime-local" value={manualDataCompra} onChange={e => setManualDataCompra(e.target.value)}
                  className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
                {terapeuta?.vendas_a_partir_de && manualDataCompra && new Date(manualDataCompra) < new Date(terapeuta.vendas_a_partir_de) && (
                  <p className="text-[10px] text-amber-400 mt-1">
                    ⚠️ Essa data é anterior ao corte configurado pra {terapeuta.nome} — esse paciente vai ser salvo, mas NÃO vai aparecer em Pacientes Ativos, Agenda nem lembretes de WhatsApp (tratado como venda retroativa).
                  </p>
                )}
              </div>
              <div className="border-t border-white/10 pt-3">
                <p className="text-xs text-gray-400 font-medium mb-2">Sessões</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">Total de sessões vendidas</label>
                    <input type="number" min={1} value={manualTotalSessoes} onChange={e => setManualTotalSessoes(e.target.value)}
                      className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">Sessões entregues (quando houver)</label>
                    <input type="number" min={0} value={manualEntreguesNumero} onChange={e => setManualEntreguesNumero(e.target.value)}
                      className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 block mb-1">Próxima sessão</label>
                    <input type="datetime-local" value={manualProximaSessaoData} onChange={e => setManualProximaSessaoData(e.target.value)}
                      className="w-full bg-gray-800 border border-white/10 rounded-lg px-2 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50" />
                  </div>
                </div>
                <p className="text-[10px] text-gray-600 mt-2">
                  As sessões entregues são preenchidas automaticamente de 7 em 7 dias pra trás a partir da próxima sessão. As sessões futuras (total − entregues) são agendadas de 7 em 7 dias pra frente a partir dela.
                </p>
                {manualFuturasNum > 1 && manualDatasEditadas.length > 0 && (
                  <div className="bg-gray-800/60 rounded-lg p-3 mt-3">
                    <p className="text-xs text-gray-400 mb-2 font-medium">Datas das {manualFuturasNum} sessões futuras (intervalo de 7 dias — edite se alguma sair da regra):</p>
                    <div className="space-y-1.5">
                      {manualDatasEditadas.map((valor, i) => (
                        <div key={i} className="flex items-center gap-3 text-xs">
                          <span className="text-gray-500 w-16 shrink-0">Sessão {manualEntreguesNum + i + 1}:</span>
                          <input type="datetime-local" value={valor}
                            onChange={e => setManualDatasEditadas(prev => prev.map((v, idx) => idx === i ? e.target.value : v))}
                            className="flex-1 bg-gray-800 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500/50" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {manualErro && <p className="text-xs text-red-400">{manualErro}</p>}
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setManualOpen(false)}
                className="flex-1 px-4 py-2 text-sm text-gray-400 bg-gray-800 border border-white/10 rounded-lg">Cancelar</button>
              <button onClick={() => { setManualErro(''); setManualSenhaOpen(true) }}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors">
                Confirmar lançamento
              </button>
            </div>
          </div>
        </div>
      )}

      <SenhaModal
        isOpen={manualSenhaOpen}
        onClose={() => { setManualSenhaOpen(false); setManualErro('') }}
        onConfirm={handleLancamentoManual}
        titulo="Confirmar lançamento manual"
        descricao="Digite sua senha para criar a venda e as sessões"
        loading={manualLoading}
        erro={manualErro}
      />

      {/* Confirmação de lançamento manual */}
      {manualSucesso && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setManualSucesso(null)}>
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-sm mx-4 text-center" onClick={e => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-7 h-7 text-green-500" />
            </div>
            <h3 className="text-base font-semibold text-white mb-1">Paciente lançado!</h3>
            <p className="text-sm text-gray-400 mb-5">
              {manualSucesso.criadas} sessão(ões) de {manualSucesso.nome} registrada(s).
              {manualSucesso.puladas > 0 && ` ${manualSucesso.puladas} sessão(ões) futura(s) ficaram de fora até você informar a data real.`}
            </p>
            <button onClick={() => setManualSucesso(null)}
              className="w-full py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors">
              OK
            </button>
          </div>
        </div>
      )}

      {/* Modal detalhe da sessão — Agenda */}
      {agendaDetalhe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setAgendaDetalhe(null)}>
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Detalhes da consulta</h3>
              <button onClick={() => setAgendaDetalhe(null)} className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3 text-sm">
              {(() => {
                const formatoAgendaDetalhe = formatoDaVenda(vendas[agendaDetalhe.sale_id] ?? { id: agendaDetalhe.sale_id, order_id: undefined })
                if (!formatoAgendaDetalhe) return null
                return (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border bg-violet-500/20 text-violet-300 border-violet-500/40">
                    {rotuloDiagnostico({
                      formato: formatoAgendaDetalhe.formato,
                      numeroSessao: agendaDetalhe.numero_sessao,
                      totalSessoes: agendaDetalhe.total_sessoes,
                    })}
                  </span>
                )
              })()}
              <div className="flex justify-between items-start gap-4">
                <span className="text-gray-500 shrink-0">Paciente</span>
                <span className="text-white text-right">{agendaDetalhe.paciente_nome}</span>
              </div>
              <div className="flex justify-between items-start gap-4">
                <span className="text-gray-500 shrink-0">E-mail</span>
                <span className="text-white text-right">{agendaDetalhe.paciente_email}</span>
              </div>
              <div className="flex justify-between items-start gap-4">
                <span className="text-gray-500 shrink-0">Sessão</span>
                <span className="text-white text-right">{agendaDetalhe.numero_sessao} de {agendaDetalhe.total_sessoes}</span>
              </div>
              <div className="flex justify-between items-start gap-4">
                <span className="text-gray-500 shrink-0">Status</span>
                <span className="text-white text-right">{STATUS_LABEL[agendaDetalhe.status]?.label ?? agendaDetalhe.status}</span>
              </div>
              <div className="flex justify-between items-start gap-4">
                <span className="text-gray-500 shrink-0">Data/hora</span>
                <span className="text-white text-right">{fmtDt(agendaDetalhe.data_agendada)}</span>
              </div>
              <div className="flex justify-between items-start gap-4">
                <span className="text-gray-500 shrink-0">Comissão</span>
                <span className="text-white text-right">{fmtBRL(agendaDetalhe.comissao_valor)}</span>
              </div>
              {agendaDetalhe.link_meet && (
                <div className="flex justify-between items-center gap-4">
                  <span className="text-gray-500 shrink-0">Link Meet</span>
                  <LinkMeetCell id={agendaDetalhe.id} link={agendaDetalhe.link_meet} copiadoId={linkCopiadoId} onCopy={copiarLinkMeet} />
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 flex-wrap mt-5 pt-4 border-t border-white/10">
              {(agendaDetalhe.status === 'agendada' || agendaDetalhe.status === 'pendente') && (agendaDetalhe.status_consulta ?? 'aguardando') === 'aguardando' && (
                <button onClick={() => { setStatusSessaoId(agendaDetalhe.id); setStatusAcao('iniciar'); setStatusErro(''); setAgendaDetalhe(null) }}
                  className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors">
                  ▶ Iniciar
                </button>
              )}
              {(agendaDetalhe.status === 'agendada' || agendaDetalhe.status === 'pendente') && (
                <button onClick={() => { setStatusSessaoId(agendaDetalhe.id); setStatusAcao('concluir'); setConcluirData(nowForDatetimeLocal()); setStatusErro(''); setAgendaDetalhe(null) }}
                  className="flex items-center gap-1 text-xs text-green-500 hover:text-green-400 transition-colors">
                  <CheckCircle className="w-3.5 h-3.5" /> Concluir
                </button>
              )}
              {agendaDetalhe.status === 'entregue' && (
                <button onClick={() => { setStatusSessaoId(agendaDetalhe.id); setStatusAcao('anular'); setAnularMotivo(''); setStatusErro(''); setAgendaDetalhe(null) }}
                  className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors">
                  Anular
                </button>
              )}
              {(agendaDetalhe.status === 'agendada' || agendaDetalhe.status === 'pendente') && (
                <button onClick={() => { setRemarcarSessaoId(agendaDetalhe.id); setRemarcarData(agendaDetalhe.data_agendada ? isoToDatetimeLocalBRT(agendaDetalhe.data_agendada) : ''); setRemarcarMotivo(''); setAgendaDetalhe(null) }}
                  className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors">
                  <RefreshCw className="w-3.5 h-3.5" /> Remarcar
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Aviso de intervalo do Diagnóstico Guiado - aparece assim que uma
          remarcação deixa menos de 7 dias até a sessão vizinha do pacote.
          Sem restrição extra de papel: qualquer um que pôde remarcar (admin,
          comercial ou o próprio terapeuta) também pode escolher aqui, porque
          é a mesma ação de agendamento continuando. */}
      {avisoRemarcacao && !avisoEmpurrarSenhaOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-sm font-semibold text-white mb-1">Intervalo entre sessões</h3>
            {avisoRemarcacao.paciente && (
              <p className="text-xs text-gray-500 mb-3">{avisoRemarcacao.paciente}</p>
            )}
            <p className="text-sm text-gray-300 mb-4">{avisoRemarcacao.mensagem}</p>
            {/* As duas opções têm custo real - o texto precisa deixar isso
                explícito, sem eufemismo, porque quem decide é o comercial. */}
            <p className="text-xs text-gray-500 mb-4 leading-relaxed">
              <span className="text-gray-300 font-medium">Manter</span> deixa a próxima sessão a menos de 7 dias
              desta. <span className="text-gray-300 font-medium">Empurrar</span> remarca todas as sessões
              seguintes deste pacote, mantendo 7 dias entre elas, e o paciente precisa ser avisado.
            </p>
            {avisoRemarcacao.seguintes.length > 0 && (
              <div className="bg-gray-800/60 rounded-lg p-3 mb-5">
                <p className="text-[11px] text-amber-400 mb-2">
                  Empurrar substitui as datas destas {avisoRemarcacao.seguintes.length} sessão(ões), e o paciente recebe convites novos:
                </p>
                <div className="space-y-0.5">
                  {avisoRemarcacao.seguintes.map(x => (
                    <div key={x.numero} className="flex items-center gap-2 text-[11px]">
                      <span className="text-gray-500 w-16 shrink-0">Sessão {x.numero}:</span>
                      <span className="text-gray-300">{x.dataAtual}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {avisoEmpurrarErro && <p className="text-xs text-red-400 mb-3 whitespace-pre-line">{avisoEmpurrarErro}</p>}
            <div className="flex gap-3">
              <button onClick={() => { setAvisoRemarcacao(null); setAvisoEmpurrarErro('') }}
                className="flex-1 px-4 py-2 text-sm text-gray-400 bg-gray-800 hover:bg-gray-700 border border-white/10 rounded-lg transition-colors">
                Manter as demais como estão
              </button>
              <button onClick={() => { setAvisoEmpurrarErro(''); setAvisoEmpurrarSenhaOpen(true) }}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors">
                Empurrar as seguintes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SEM `dispensarSenha` de proposito. O Pedro e o unico usuario com
          dispensa ativa, e o SenhaModal com dispensa auto-confirma no efeito:
          o clique em "Empurrar as seguintes" dispararia o POST na hora, sem
          nenhuma segunda confirmacao. Aqui isso reescreve ate 8 sessoes e manda
          convites novos ao paciente - precisa de um passo deliberado. */}
      <SenhaModal
        isOpen={avisoEmpurrarSenhaOpen}
        onClose={() => { setAvisoEmpurrarSenhaOpen(false); setAvisoEmpurrarErro('') }}
        onConfirm={handleEmpurrarSeguintes}
        titulo="Empurrar sessões seguintes"
        descricao="Digite sua senha para remarcar as sessões seguintes deste pacote"
        loading={avisoEmpurrarLoading}
        erro={avisoEmpurrarErro}
      />

      {/* Confirmação de sessões empurradas */}
      {avisoEmpurrarSucesso !== null && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => { setAvisoEmpurrarSucesso(null); setAvisoEmpurrarCalendario(null) }}>
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-sm mx-4 text-center" onClick={e => e.stopPropagation()}>
            <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 ${avisoEmpurrarCalendario ? 'bg-amber-500/10' : 'bg-green-500/10'}`}>
              {avisoEmpurrarCalendario
                ? <AlertTriangle className="w-7 h-7 text-amber-500" />
                : <CheckCircle className="w-7 h-7 text-green-500" />}
            </div>
            <h3 className="text-base font-semibold text-white mb-1">
              {avisoEmpurrarSucesso === 0 ? 'Nada para empurrar' : 'Sessões remarcadas'}
            </h3>
            {/* movidas=0 significa que não havia sessão seguinte no pacote -
                nada mudou, então não faz sentido pedir pra avisar o paciente
                de uma mudança que não aconteceu (achado da revisão). */}
            <p className="text-sm text-gray-400 mb-5">
              {avisoEmpurrarSucesso === 0
                ? 'Não havia sessões seguintes neste pacote para mover. Nada foi alterado.'
                : `${avisoEmpurrarSucesso} sessão(ões) seguinte(s) ${avisoEmpurrarSucesso === 1 ? 'foi remarcada' : 'foram remarcadas'} pra manter os 7 dias entre elas. Avise o paciente sobre as novas datas.`}
            </p>
            {avisoEmpurrarCalendario && (
              <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 mb-5 text-left">
                {avisoEmpurrarCalendario}
              </p>
            )}
            <button onClick={() => { setAvisoEmpurrarSucesso(null); setAvisoEmpurrarCalendario(null) }}
              className="w-full py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors">
              OK
            </button>
          </div>
        </div>
      )}

      {/* Modal: Lançar compromisso pessoal */}
      {compromissoNovoOpen && !compromissoNovoSenhaOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-sm mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Lançar compromisso</h3>
              <button onClick={() => setCompromissoNovoOpen(false)} className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Título <span className="text-red-400">*</span></label>
                <input type="text" value={compromissoNovoTitulo} onChange={e => setCompromissoNovoTitulo(e.target.value)}
                  placeholder="Ex: Almoço, Gravação de conteúdo"
                  className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Categoria (cor na agenda)</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setCompromissoNovoCategoria('compromisso')}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-lg border transition-colors ${
                      compromissoNovoCategoria === 'compromisso'
                        ? 'border-stone-400 bg-stone-400/10 text-stone-300'
                        : 'border-white/10 bg-gray-800 text-gray-500 hover:text-gray-300'
                    }`}>
                    <i className="w-[3px] h-2.5 rounded-sm bg-stone-400 inline-block" /> Compromisso
                  </button>
                  <button type="button" onClick={() => setCompromissoNovoCategoria('sessao')}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-lg border transition-colors ${
                      compromissoNovoCategoria === 'sessao'
                        ? 'border-indigo-500 bg-indigo-500/10 text-indigo-200'
                        : 'border-white/10 bg-gray-800 text-gray-500 hover:text-gray-300'
                    }`}>
                    <i className="w-[3px] h-2.5 rounded-sm bg-indigo-500 inline-block" /> Sessão
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Início <span className="text-red-400">*</span></label>
                  <input type="datetime-local" value={compromissoNovoInicio} onChange={e => setCompromissoNovoInicio(e.target.value)}
                    className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Fim <span className="text-red-400">*</span></label>
                  <input type="datetime-local" value={compromissoNovoFim} onChange={e => setCompromissoNovoFim(e.target.value)}
                    className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
                </div>
              </div>
              <div>
                <label className="flex items-center gap-2 text-xs text-gray-400">
                  <input type="checkbox" checked={compromissoNovoRepetir} onChange={e => setCompromissoNovoRepetir(e.target.checked)}
                    className="rounded border-white/10 bg-gray-800" />
                  Repetir
                </label>
                {compromissoNovoRepetir && (
                  <div className="mt-2 flex items-end gap-3">
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Frequência</label>
                      <select value={compromissoNovoFrequencia} onChange={e => setCompromissoNovoFrequencia(e.target.value as 'semanal' | 'diaria')}
                        className="bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50">
                        <option value="semanal">Semanalmente</option>
                        <option value="diaria">Diariamente</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Por quantas {compromissoNovoFrequencia === 'diaria' ? 'vezes' : 'semanas'}</label>
                      <input type="number" min={2} max={compromissoNovoFrequencia === 'diaria' ? 90 : 52} value={compromissoNovoSemanas}
                        onChange={e => setCompromissoNovoSemanas(e.target.value)}
                        className="w-24 bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
                    </div>
                  </div>
                )}
              </div>
              {compromissoNovoErro && <p className="text-xs text-red-400">{compromissoNovoErro}</p>}
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setCompromissoNovoOpen(false)}
                className="flex-1 px-4 py-2 text-sm text-gray-400 bg-gray-800 border border-white/10 rounded-lg">Cancelar</button>
              <button onClick={() => {
                if (!compromissoNovoValido) { setCompromissoNovoErro('Preencha o título e um intervalo válido'); return }
                const conflito = haConflitoDeHorario(new Date(compromissoNovoInicio), new Date(compromissoNovoFim))
                if (conflito && !window.confirm('Já existe uma sessão ou compromisso nesse horário. Deseja continuar mesmo assim?')) return
                setCompromissoNovoErro(''); setCompromissoNovoSenhaOpen(true)
              }} disabled={!compromissoNovoValido}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg transition-colors">
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      <SenhaModal
        dispensarSenha={dispensaSenha}
        isOpen={compromissoNovoSenhaOpen}
        onClose={() => { setCompromissoNovoSenhaOpen(false); setCompromissoNovoErro('') }}
        onConfirm={handleLancarCompromisso}
        titulo="Confirmar compromisso"
        descricao="Digite sua senha para travar esse horário na agenda"
        loading={compromissoNovoLoading}
        erro={compromissoNovoErro}
      />

      {compromissoNovoSucesso && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setCompromissoNovoSucesso(null)}>
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-sm mx-4 text-center" onClick={e => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-7 h-7 text-green-500" />
            </div>
            <h3 className="text-base font-semibold text-white mb-1">Compromissos criados!</h3>
            <p className="text-sm text-gray-400 mb-5">{compromissoNovoSucesso} compromissos lançados, um por semana.</p>
            <button onClick={() => setCompromissoNovoSucesso(null)}
              className="w-full py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors">
              OK
            </button>
          </div>
        </div>
      )}

      {/* Modal: apagar compromisso pessoal */}
      {compromissoApagar && !compromissoApagarSenhaOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-sm font-semibold text-white mb-1">Apagar compromisso</h3>
            <p className="text-xs text-gray-400 mb-4">
              &quot;{compromissoApagar.titulo}&quot; será removido da agenda. Essa ação não pode ser desfeita.
            </p>
            {compromissoApagarErro && <p className="text-xs text-red-400 mb-3">{compromissoApagarErro}</p>}
            <div className="flex gap-2">
              <button onClick={() => setCompromissoApagar(null)}
                className="flex-1 px-3 py-2 text-sm text-gray-400 bg-gray-800 border border-white/10 rounded-lg">Cancelar</button>
              <button onClick={() => setCompromissoApagarSenhaOpen(true)}
                className="flex-1 px-3 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors">
                Apagar
              </button>
            </div>
          </div>
        </div>
      )}

      <SenhaModal
        dispensarSenha={dispensaSenha}
        isOpen={compromissoApagarSenhaOpen}
        onClose={() => { setCompromissoApagarSenhaOpen(false); setCompromissoApagarErro('') }}
        onConfirm={handleApagarCompromisso}
        titulo="Confirmar exclusão"
        descricao="Digite sua senha para apagar o compromisso"
        loading={compromissoApagarLoading}
        erro={compromissoApagarErro}
      />

      <MobileNav />
    </div>
  )
}
