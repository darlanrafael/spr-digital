'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  CheckCircle, RefreshCw, ArrowLeft, X, AlertTriangle,
  Users, Clock, TrendingUp, Award, Calendar, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Download,
  DollarSign, Receipt, Percent, Copy, Check,
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
import { getSupabaseClient } from '@/lib/supabase'
import { getSession } from '@/lib/auth'

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
  link_meet: string | null
  status: string
  status_consulta: string
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
function fmtDt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
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
}

export default function PainelTerapeuta() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [terapeuta, setTerapeuta] = useState<Terapeuta | null>(null)
  const [outrasTerapeutas, setOutrasTerapeutas] = useState<{ id: string; nome: string }[]>([])
  const [sessoes, setSessoes] = useState<Sessao[]>([])
  const [vendas, setVendas] = useState<Record<string, SaleInfo>>({})
  const [ocorrencias, setOcorrencias] = useState<Record<string, Ocorrencia[]>>({})
  const [remarcacoes, setRemarcacoes] = useState<Record<string, Remarcacao[]>>({})
  const [loading, setLoading] = useState(true)
  const [adminEmail, setAdminEmail] = useState('')
  const [isTerapeutaSession, setIsTerapeutaSession] = useState(false)
  const [sessionNome, setSessionNome] = useState('')
  const [linkCopiadoId, setLinkCopiadoId] = useState<string | null>(null)

  async function copiarLinkMeet(id: string, link: string) {
    await navigator.clipboard.writeText(link)
    setLinkCopiadoId(id)
    setTimeout(() => setLinkCopiadoId(prev => prev === id ? null : prev), 1500)
  }

  // Modal status_consulta (iniciar / concluir / anular) — usado tanto na visão admin quanto na do terapeuta
  const [statusSessaoId, setStatusSessaoId] = useState<string | null>(null)
  const [statusAcao, setStatusAcao] = useState<'iniciar' | 'concluir' | 'anular'>('iniciar')
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

  // Visão terapeuta — tabs de página
  const [terapeutaTab, setTerapeutaTab] = useState<'overview' | 'vendas' | 'agenda' | 'fechamentos'>('overview')

  // Agenda — calendário do mês
  const hoje = new Date()
  const [agendaMes, setAgendaMes] = useState(hoje.getMonth())
  const [agendaAno, setAgendaAno] = useState(hoje.getFullYear())
  const [agendaDetalhe, setAgendaDetalhe] = useState<Sessao | null>(null)
  const [agendaDiaSelecionado, setAgendaDiaSelecionado] = useState<Date | null>(null)
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
  const [ovProximasConsultas, setOvProximasConsultas] = useState<ConsultaHoje[]>([])
  const [ovLoading, setOvLoading] = useState(false)

  // Vendas
  const [vendasSubTab, setVendasSubTab] = useState<'pendentes' | 'ativos' | 'concluidos' | 'reembolsados'>('pendentes')
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
      const { data: vendasData } = await client
        .from('sales').select('id,nome,email,telefone,produto,plataforma,valor_pago_cliente,valor_liquido,data_hora,status').in('id', saleIds)
      for (const v of (vendasData ?? []) as SaleInfo[]) vendasMap[v.id] = v
    }
    setVendas(vendasMap)

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
        .select('id,nome,email,telefone,produto,plataforma,valor_pago_cliente,valor_liquido,data_hora,status')
        .ilike('produto', `%${primeiroNome}%`)
        .eq('status', 'aprovada')
      // vendas_a_partir_de: corte de data — vendas anteriores não aparecem
      // mais em Pendentes de Agendamento (paciente lançado manualmente em
      // vez de reconciliar contra a venda antiga importada).
      if (terapeutaResp?.vendas_a_partir_de) {
        candidatasQuery = candidatasQuery.gte('data_hora', terapeutaResp.vendas_a_partir_de)
      }
      const { data: candidatas } = await candidatasQuery
      let pendentes = ((candidatas ?? []) as SaleInfo[]).filter(v => !saleIds.includes(v.id))
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
      p.bruto = vendasDoPaciente.reduce((a, v) => a + (v.valor_pago_cliente || 0), 0)
      p.liquido = vendasDoPaciente.reduce((a, v) => a + (v.valor_liquido || 0), 0)
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
      body: JSON.stringify({ sessao_id: remarcarSessaoId, nova_data: remarcarData, motivo: remarcarMotivo, usuario_email: adminEmail, senha }),
    })
    const json = await res.json()
    setRemarcarLoading(false)
    if (!res.ok) { setRemarcarErro(json.error ?? 'Erro'); return }
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
      }),
    })
    const json = await res.json()
    setRemLoading(false)
    if (!res.ok) { setRemErro(json.error ?? 'Erro'); return }
    setRemSenhaOpen(false); setOcorrenciaTipo(null)
    setRemSessaoId(''); setRemNovaData(''); setRemSolicitadoPor(''); setRemMotivo('')
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
        valor_pago_cliente: parseFloat(manualValorBruto.replace(',', '.')) || 0,
        valor_liquido: parseFloat(manualValorLiquido.replace(',', '.')) || 0,
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
    const duracaoMs = (terapeuta?.duracao_sessao_minutos ?? 60) * 60000
    const conflitaSessao = sessoes.some(s => {
      if (!s.data_agendada || s.status === 'cancelada') return false
      const sIni = new Date(s.data_agendada).getTime()
      const sFim = sIni + duracaoMs
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
      }),
    })
    const json = await res.json()
    setCompromissoApagarLoading(false)
    if (!res.ok) { setCompromissoApagarErro(json.error ?? 'Erro'); return }
    setCompromissoApagarSenhaOpen(false); setCompromissoApagar(null)
    loadData()
  }

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
                                    <td className="px-4 py-3 text-white">{s.paciente_nome}</td>
                                    <td className="px-4 py-3">
                                      <LinkMeetCell id={s.id} link={s.link_meet} copiadoId={linkCopiadoId} onCopy={copiarLinkMeet} />
                                    </td>
                                    <td className="px-4 py-3">
                                      <span className={`text-xs px-2 py-0.5 rounded-full ${scBadge.cls}`}>{scBadge.label}</span>
                                    </td>
                                    <td className="px-4 py-3">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        {(s.status === 'agendada' || s.status === 'pendente') && (s.status_consulta ?? 'aguardando') === 'aguardando' && (
                                          <button onClick={() => { setStatusSessaoId(s.id); setStatusAcao('iniciar'); setStatusErro('') }}
                                            className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors whitespace-nowrap">
                                            ▶ Iniciar
                                          </button>
                                        )}
                                        {(s.status === 'agendada' || s.status === 'pendente') && (
                                          <button onClick={() => { setStatusSessaoId(s.id); setStatusAcao('concluir'); setConcluirData(nowForDatetimeLocal()); setStatusErro('') }}
                                            className="flex items-center gap-1 text-xs text-green-500 hover:text-green-400 transition-colors whitespace-nowrap">
                                            <CheckCircle className="w-3 h-3" /> Concluir
                                          </button>
                                        )}
                                        {s.status === 'entregue' && (
                                          <button onClick={() => { setStatusSessaoId(s.id); setStatusAcao('anular'); setAnularMotivo(''); setStatusErro('') }}
                                            className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors whitespace-nowrap">
                                            Anular
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
                              {ovProximasConsultas.map(s => {
                                const scBadge = STATUS_CONSULTA_BADGE[s.status_consulta] ?? STATUS_CONSULTA_BADGE.aguardando
                                return (
                                  <tr key={s.id} className="border-b border-white/5 hover:bg-white/2">
                                    <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{s.data}</td>
                                    <td className="px-4 py-3 text-purple-400 font-medium">{s.horario}</td>
                                    <td className="px-4 py-3 text-white">{s.paciente_nome}</td>
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
                          ) : pacientesPendentesAgrupados.map(p => (
                            <tr key={p.email} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                              <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDt(p.dataCompraMaisRecente)}</td>
                              <td className="px-4 py-3">
                                <p className="text-white font-medium">{p.nome}</p>
                                <p className="text-xs text-gray-500">{p.email}</p>
                              </td>
                              <td className="px-4 py-3 text-gray-300 text-xs max-w-[200px] truncate">{p.produtos.join(' + ')}</td>
                              <td className="px-4 py-3 text-gray-300 text-xs whitespace-nowrap">{p.qtdVendas > 1 ? `${p.qtdVendas} vendas` : '1 venda'}</td>
                              <td className="px-4 py-3 text-white whitespace-nowrap">{fmtBRL(p.bruto)}</td>
                              <td className="px-4 py-3 text-green-500 whitespace-nowrap">{fmtBRL(p.liquido)}</td>
                              {!isTerapeutaSession && (
                                <td className="px-4 py-3">
                                  <div className="flex flex-wrap gap-1.5">
                                    {p.saleIds.map((sid, i) => (
                                      <Link key={sid} href={`/terapeutas/vendas?agendar=${sid}&terapeuta=${id}`}
                                        className="px-2.5 py-1 text-xs font-medium rounded-lg bg-amber-600/80 text-white hover:bg-amber-600 transition-colors whitespace-nowrap">
                                        {p.saleIds.length > 1 ? `Agendar venda ${i + 1}` : 'Agendar'}
                                      </Link>
                                    ))}
                                  </div>
                                </td>
                              )}
                            </tr>
                          ))}
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
                            const progresso = p.total > 0 ? Math.min((p.entregues / p.total) * 100, 100) : 0
                            const concluido = p.entregues === p.total && p.total > 0
                            return (
                              <tr key={p.email} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                                <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDt(p.dataCompraMaisRecente)}</td>
                                <td className="px-4 py-3">
                                  <p className="text-white font-medium">{p.nome}</p>
                                  <p className="text-xs text-gray-500">{p.email}</p>
                                </td>
                                <td className="px-4 py-3 text-gray-300">{p.total}</td>
                                <td className="px-4 py-3 text-green-500 font-medium">{p.entregues}</td>
                                <td className="px-4 py-3 text-white whitespace-nowrap">{fmtBRL(p.bruto)}</td>
                                <td className="px-4 py-3 text-green-500 whitespace-nowrap">{fmtBRL(p.liquido)}</td>
                                <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{p.vendedor}</td>
                                <td className="px-4 py-3 min-w-[120px]">
                                  <div className="w-full bg-gray-800 rounded-full h-1.5">
                                    <div className="bg-green-500 h-1.5 rounded-full transition-all" style={{ width: `${progresso}%` }} />
                                  </div>
                                  <p className={`text-[10px] mt-0.5 ${concluido ? 'text-green-500' : 'text-gray-500'}`}>
                                    {concluido ? 'Concluído ✓' : `${p.entregues} de ${p.total} sessões`}
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
                            return (
                              <tr key={sale.id} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                                <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDt(sale.data_hora)}</td>
                                <td className="px-4 py-3">
                                  <p className="text-white font-medium">{sale.nome}</p>
                                  <p className="text-xs text-gray-500">{sale.email}</p>
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
                    .map((s): SessaoDia => ({
                      id: s.id,
                      paciente_nome: s.paciente_nome,
                      numero_sessao: s.numero_sessao,
                      total_sessoes: s.total_sessoes,
                      status: s.status,
                      data_agendada: s.data_agendada as string,
                    }))}
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
        isOpen={!!statusSessaoId && (statusAcao !== 'anular' || anularMotivo.trim().length >= 10) && (statusAcao !== 'concluir' || !!concluirData)}
        onClose={() => { setStatusSessaoId(null); setStatusErro(''); setAnularMotivo(''); setConcluirData('') }}
        onConfirm={handleStatusAcao}
        titulo={statusAcao === 'iniciar' ? 'Iniciar consulta' : statusAcao === 'concluir' ? 'Concluir consulta' : 'Anular sessão'}
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
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Informações do paciente</h4>
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
                    return (
                      <div key={s.id} className="bg-gray-800/40 border border-white/5 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-3 flex-wrap">
                          <span className="text-xs text-gray-500 font-medium">Sessão {s.numero_sessao} de {s.total_sessoes}</span>
                          <span className={`text-[11px] px-2 py-0.5 rounded-full ${badge.color}`}>{badge.label}</span>
                          {s.numero_sessao === s.total_sessoes && (
                            <span className="text-[10px] text-red-400 border border-red-400/30 px-1.5 py-0.5 rounded">Última sessão</span>
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

                {/* Lista de ocorrências */}
                <div className="space-y-2">
                  {prontuarioOcorrencias.length === 0 ? (
                    <p className="text-xs text-gray-600 text-center py-4">Nenhuma ocorrência registrada.</p>
                  ) : prontuarioOcorrencias.map(o => {
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

            </div>
          </div>
        </div>
      )}

      <SenhaModal
        isOpen={notaSenhaOpen}
        onClose={() => { setNotaSenhaOpen(false); setNotaErro('') }}
        onConfirm={handleNota}
        titulo="Salvar nota"
        descricao="Digite sua senha para registrar a ocorrência"
        loading={notaLoading}
        erro={notaErro}
      />

      <SenhaModal
        isOpen={remSenhaOpen}
        onClose={() => { setRemSenhaOpen(false); setRemErro('') }}
        onConfirm={handleRemarcarOcorrencia}
        titulo="Confirmar remarcação"
        descricao="Digite sua senha para remarcar a sessão"
        loading={remLoading}
        erro={remErro}
      />

      <SenhaModal
        isOpen={orientSenhaOpen}
        onClose={() => { setOrientSenhaOpen(false); setOrientErro('') }}
        onConfirm={handleOrientacao}
        titulo={orientEditandoId ? 'Salvar edição da orientação' : 'Registrar orientação'}
        descricao="Digite sua senha para confirmar"
        loading={orientLoading}
        erro={orientErro}
      />

      <SenhaModal
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
