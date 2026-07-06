'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  CheckCircle, RefreshCw, ArrowLeft, X,
  Users, Clock, DollarSign, TrendingUp, BarChart2, Award, Calendar, CalendarDays,
} from 'lucide-react'
import Link from 'next/link'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import SenhaModal from '@/components/SenhaModal'
import { getSupabaseClient } from '@/lib/supabase'
import { getSession } from '@/lib/auth'

type Terapeuta = {
  id: string
  nome: string
  email: string
  percentual_comissao: number
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

type Preset = 'today' | 'yesterday' | 'last_7d' | 'this_month' | 'custom'

type Metricas = {
  sessoes_vendidas: number
  sessoes_entregues: number
  sessoes_futuras: number
  faturamento_bruto: number
  faturamento_liquido_spr: number
  total_impostos: number
  ticket_medio: number
  comissao_gerada: number
  comissao_futura: number
  faturamento_liquido_terapeutas: number
}

const METRICAS_VAZIA: Metricas = {
  sessoes_vendidas: 0, sessoes_entregues: 0, sessoes_futuras: 0,
  faturamento_bruto: 0, faturamento_liquido_spr: 0, total_impostos: 0,
  ticket_medio: 0, comissao_gerada: 0, comissao_futura: 0,
  faturamento_liquido_terapeutas: 0,
}

type ConsultaHoje = {
  id: string
  horario: string
  paciente_nome: string
  status: string
  status_consulta: string
}

const PRESET_LABELS: Record<Preset, string> = {
  today: 'Hoje',
  yesterday: 'Ontem',
  last_7d: '7 dias',
  this_month: 'Este mês',
  custom: 'Personalizado',
}

const STATUS_CONSULTA_BADGE: Record<string, { label: string; cls: string }> = {
  aguardando:     { label: 'Aguardando',    cls: 'text-amber-400 bg-amber-400/10' },
  em_atendimento: { label: 'Em atendimento', cls: 'text-blue-400 bg-blue-400/10 animate-pulse' },
  concluida:      { label: 'Concluída',     cls: 'text-green-500 bg-green-500/10' },
  cancelada:      { label: 'Cancelada',     cls: 'text-red-400 bg-red-400/10' },
  remarcada:      { label: 'Remarcada',     cls: 'text-purple-400 bg-purple-400/10' },
}

function fmtBRL(n: number) {
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
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
    case 'yesterday': { const y = new Date(now); y.setDate(y.getDate() - 1); return d.toDateString() === y.toDateString() }
    case 'last_7d': { const diffDays = (now.getTime() - d.getTime()) / 86400000; return diffDays >= 0 && diffDays <= 7 }
    case 'this_month': return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
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
  const [sessoes, setSessoes] = useState<Sessao[]>([])
  const [vendas, setVendas] = useState<Record<string, SaleInfo>>({})
  const [ocorrencias, setOcorrencias] = useState<Record<string, Ocorrencia[]>>({})
  const [remarcacoes, setRemarcacoes] = useState<Record<string, Remarcacao[]>>({})
  const [loading, setLoading] = useState(true)
  const [adminEmail, setAdminEmail] = useState('')
  const [isTerapeutaSession, setIsTerapeutaSession] = useState(false)
  const [sessionNome, setSessionNome] = useState('')

  // Modal status_consulta (iniciar / concluir / anular) — usado tanto na visão admin quanto na do terapeuta
  const [statusSessaoId, setStatusSessaoId] = useState<string | null>(null)
  const [statusAcao, setStatusAcao] = useState<'iniciar' | 'concluir' | 'anular'>('iniciar')
  const [statusErro, setStatusErro] = useState('')
  const [statusLoading, setStatusLoading] = useState(false)
  const [anularMotivo, setAnularMotivo] = useState('')

  // Modal remarcar — visão admin
  const [remarcarSessaoId, setRemarcarSessaoId] = useState<string | null>(null)
  const [remarcarData, setRemarcarData] = useState('')
  const [remarcarMotivo, setRemarcarMotivo] = useState('')
  const [remarcarSenhaModal, setRemarcarSenhaModal] = useState(false)
  const [remarcarErro, setRemarcarErro] = useState('')
  const [remarcarLoading, setRemarcarLoading] = useState(false)

  // Visão terapeuta — tabs de página
  const [terapeutaTab, setTerapeutaTab] = useState<'overview' | 'vendas'>('overview')

  // Overview
  const [ovPreset, setOvPreset] = useState<Preset>('this_month')
  const [ovDateStart, setOvDateStart] = useState('')
  const [ovDateEnd, setOvDateEnd] = useState('')
  const [ovMetricas, setOvMetricas] = useState<Metricas>(METRICAS_VAZIA)
  const [ovConsultasHoje, setOvConsultasHoje] = useState<ConsultaHoje[]>([])
  const [ovLoading, setOvLoading] = useState(false)

  // Vendas
  const [vendasSubTab, setVendasSubTab] = useState<'ativos' | 'concluidos' | 'reembolsados'>('ativos')
  const [vBusca, setVBusca] = useState('')
  const [vFormato, setVFormato] = useState('all')
  const [vPreset, setVPreset] = useState<Preset>('this_month')
  const [vDateStart, setVDateStart] = useState('')
  const [vDateEnd, setVDateEnd] = useState('')

  // Pacientes e prontuário
  const [prontuarioEmail, setProntuarioEmail] = useState<string | null>(null)
  const [notaFormOpen, setNotaFormOpen] = useState(false)
  const [notaTitulo, setNotaTitulo] = useState('')
  const [notaDesc, setNotaDesc] = useState('')
  const [notaErro, setNotaErro] = useState('')
  const [notaLoading, setNotaLoading] = useState(false)
  const [notaSenhaOpen, setNotaSenhaOpen] = useState(false)

  async function loadData(isTerapeuta: boolean) {
    const client = getSupabaseClient()
    if (!client) return
    setLoading(true)
    const [tResp, sResp] = await Promise.all([
      client.from('terapeutas').select('id,nome,email,percentual_comissao').eq('id', id).single(),
      client.from('sessoes').select('id,sale_id,numero_sessao,total_sessoes,status,status_consulta,data_agendada,data_entrega,link_meet,comissao_valor,comissao_paga,paciente_nome,paciente_email,entregue_confirmado_por,iniciado_em,concluido_em,vendedor_nome,agendado_por')
        .eq('terapeuta_id', id).order('sale_id').order('numero_sessao', { ascending: true }),
    ])
    if (tResp.data) setTerapeuta(tResp.data as unknown as Terapeuta)
    const sessoesData = (sResp.data ?? []) as Sessao[]
    setSessoes(sessoesData)

    if (isTerapeuta) {
      const saleIds = [...new Set(sessoesData.map(s => s.sale_id))]
      const sessaoIds = sessoesData.map(s => s.id)
      if (saleIds.length > 0) {
        const [vendasResp, ocResp, remResp] = await Promise.all([
          client.from('sales').select('id,nome,email,telefone,produto,plataforma,valor_pago_cliente,valor_liquido,data_hora,status').in('id', saleIds),
          client.from('ocorrencias_prontuario').select('id,sale_id,tipo,titulo,descricao,criado_por_nome,criado_por_tipo,created_at').in('sale_id', saleIds).order('created_at', { ascending: false }),
          sessaoIds.length > 0
            ? client.from('remarcacoes_historico').select('*').in('sessao_id', sessaoIds).order('created_at', { ascending: true })
            : Promise.resolve({ data: [] as Remarcacao[] }),
        ])
        const vendasMap: Record<string, SaleInfo> = {}
        for (const v of (vendasResp.data ?? []) as SaleInfo[]) vendasMap[v.id] = v
        setVendas(vendasMap)

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
    }
    setLoading(false)
  }

  useEffect(() => {
    // Admin session takes absolute priority over terapeutas_session
    const adminSession = getSession()
    if (adminSession) {
      setAdminEmail(adminSession.email)
      setSessionNome(adminSession.name)
      // isTerapeutaSession stays false — admin sees full view
      if (id) loadData(false)
      return
    }

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
          if (id) loadData(true)
          return
        }
      } catch { /* ignore */ }
    }
    if (id) loadData(false)
  }, [id])

  // ── Overview: cards + consultas de hoje via /api/terapeutas/dashboard ──
  async function loadOverview() {
    if (ovPreset === 'custom' && (!ovDateStart || !ovDateEnd)) return
    setOvLoading(true)
    try {
      const params = new URLSearchParams({ datePreset: ovPreset, terapeutaId: id })
      if (ovPreset === 'custom') {
        if (ovDateStart) params.set('dateStart', ovDateStart + 'T03:00:00.000Z')
        if (ovDateEnd) params.set('dateEnd', ovDateEnd + 'T26:59:59.000Z')
      }
      const res = await fetch('/api/terapeutas/dashboard?' + params.toString())
      const json = await res.json()
      setOvMetricas(json.metricas ?? METRICAS_VAZIA)
      setOvConsultasHoje(json.consultas_hoje ?? [])
    } finally {
      setOvLoading(false)
    }
  }

  useEffect(() => {
    if (!isTerapeutaSession || !id) return
    loadOverview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTerapeutaSession, id, ovPreset, ovDateStart, ovDateEnd])

  // Auto-refresh consultas de hoje a cada 60s
  useEffect(() => {
    if (!isTerapeutaSession || !id) return
    const interval = setInterval(() => {
      fetch(`/api/terapeutas/dashboard?datePreset=${ovPreset}&terapeutaId=${id}`)
        .then(r => r.ok ? r.json() : null)
        .then(json => { if (json?.consultas_hoje) setOvConsultasHoje(json.consultas_hoje) })
        .catch(() => {})
    }, 60000)
    return () => clearInterval(interval)
  }, [isTerapeutaSession, id, ovPreset])

  // Reset formulário de nota quando o prontuário abre/fecha
  useEffect(() => {
    setNotaFormOpen(false)
    setNotaTitulo(''); setNotaDesc(''); setNotaErro('')
  }, [prontuarioEmail])

  const entregues = sessoes.filter(s => s.status === 'entregue')
  const pendentes = sessoes.filter(s => s.status === 'pendente' || s.status === 'agendada')
  const receitaGerada = entregues.filter(s => !s.comissao_paga).reduce((a, s) => a + s.comissao_valor, 0)
  const receitaFutura = pendentes.filter(s => !s.comissao_paga).reduce((a, s) => a + s.comissao_valor, 0)

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

  function filtraPacientes(lista: PacienteAgrupado[]): PacienteAgrupado[] {
    const buscaLower = vBusca.toLowerCase()
    return lista.filter(p => {
      const matchBusca = !vBusca || p.nome.toLowerCase().includes(buscaLower) || p.email.toLowerCase().includes(buscaLower)
      const matchFormato = vFormato === 'all' || p.saleIds.some(sid => vendas[sid]?.produto === vFormato)
      const matchPeriodo = !p.dataCompraMaisRecente || noPeriodo(p.dataCompraMaisRecente, vPreset, vDateStart, vDateEnd)
      return matchBusca && matchFormato && matchPeriodo
    })
  }

  const pacientesAtivos = useMemo(() => filtraPacientes(pacientes.filter(p => p.ativo)), [pacientes, vBusca, vFormato, vPreset, vDateStart, vDateEnd])
  const pacientesConcluidos = useMemo(() => filtraPacientes(pacientes.filter(p => !p.ativo)), [pacientes, vBusca, vFormato, vPreset, vDateStart, vDateEnd])

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

  async function handleStatusAcao(senha: string) {
    if (!statusSessaoId) return
    setStatusLoading(true)
    setStatusErro('')
    if (statusAcao === 'anular' && anularMotivo.trim().length < 10) {
      setStatusErro('Informe o motivo (mínimo 10 caracteres)'); setStatusLoading(false); return
    }
    const res = await fetch('/api/terapeutas/sessoes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessao_id: statusSessaoId,
        acao: statusAcao,
        motivo: statusAcao === 'anular' ? anularMotivo : undefined,
        usuario_nome: sessionNome || adminEmail.split('@')[0],
        usuario_tipo: isTerapeutaSession ? 'terapeuta' : 'admin',
        usuario_email: adminEmail,
        senha,
      }),
    })
    const json = await res.json()
    setStatusLoading(false)
    if (!res.ok) { setStatusErro(json.error ?? 'Erro'); return }
    setStatusSessaoId(null); setAnularMotivo('')
    loadData(isTerapeutaSession)
    if (isTerapeutaSession) loadOverview()
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
    loadData(isTerapeutaSession)
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
        tipo: 'nota',
        titulo: notaTitulo,
        descricao: notaDesc,
        senha,
        usuario_nome: sessionNome || adminEmail.split('@')[0],
        usuario_tipo: 'terapeuta',
        usuario_email: adminEmail,
      }),
    })
    const json = await res.json()
    setNotaLoading(false)
    if (!res.ok) { setNotaErro(json.error ?? 'Erro'); return }
    setNotaSenhaOpen(false); setNotaFormOpen(false)
    setNotaTitulo(''); setNotaDesc('')
    loadData(true)
  }

  const notaValida = notaTitulo.trim().length > 0 && notaDesc.trim().length >= 10

  // Agrupar sessões por sale_id para mostrar "faltam X" — visão admin
  const saleIds = [...new Set(sessoes.map(s => s.sale_id))]

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
      <main className={isTerapeutaSession ? 'max-w-7xl mx-auto px-4 py-6' : 'max-w-5xl mx-auto px-4 py-6'}>
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
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : isTerapeutaSession ? (
          <>
            {/* Tabs de página */}
            <div className="flex items-center gap-1 bg-gray-900 border border-white/10 rounded-xl p-1 mb-6 w-fit">
              {([
                { key: 'overview', label: 'Overview' },
                { key: 'vendas', label: 'Vendas' },
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
                    {/* 10 cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                      {[
                        { label: 'Sessões vendidas', sub: 'Total de sessões contratadas', value: ovMetricas.sessoes_vendidas, icon: Users, color: 'text-white' },
                        { label: 'Sessões entregues', sub: 'Confirmadas pelo terapeuta', value: ovMetricas.sessoes_entregues, icon: CheckCircle, color: 'text-green-500' },
                        { label: 'Sessões futuras', sub: 'Agendadas e pendentes', value: ovMetricas.sessoes_futuras, icon: Clock, color: 'text-yellow-400' },
                        { label: 'Faturamento bruto', sub: '100% do valor pago pelos clientes', value: fmtBRL(ovMetricas.faturamento_bruto), icon: DollarSign, color: 'text-white' },
                        { label: 'Faturamento líquido SPR (70%)', sub: 'Após taxas e impostos — parte SPR', value: fmtBRL(ovMetricas.faturamento_liquido_spr), icon: TrendingUp, color: 'text-green-500' },
                        { label: 'Total de impostos', sub: '12,85% sobre faturamento bruto', value: fmtBRL(ovMetricas.total_impostos), icon: BarChart2, color: 'text-red-400' },
                        { label: 'Ticket médio', sub: 'Valor médio por venda', value: ovMetricas.faturamento_bruto > 0 ? fmtBRL(ovMetricas.ticket_medio) : '—', icon: BarChart2, color: 'text-white' },
                        { label: 'Comissão gerada', sub: 'Sessões entregues — a pagar', value: fmtBRL(ovMetricas.comissao_gerada), icon: Award, color: 'text-yellow-400' },
                        { label: 'Comissão futura', sub: 'Baseado nas sessões futuras', value: fmtBRL(ovMetricas.comissao_futura), icon: CalendarDays, color: 'text-gray-400' },
                        { label: 'Líquido terapeuta (30%)', sub: 'Sua parte após taxas e impostos', value: fmtBRL(ovMetricas.faturamento_liquido_terapeutas), icon: Users, color: 'text-blue-400' },
                      ].map(({ label, sub, value, icon: Icon, color }) => (
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
                                {['Horário', 'Paciente', 'Status Consulta', 'Ações'].map(h => (
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
                                        {s.status_consulta === 'em_atendimento' && (
                                          <button onClick={() => { setStatusSessaoId(s.id); setStatusAcao('concluir'); setStatusErro('') }}
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

                <div className="flex items-center gap-2 mb-4">
                  {[
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
          </>
        ) : (
          <>
            {/* Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {[
                {
                  label: 'Sessões entregues',
                  sub: 'Confirmadas',
                  value: entregues.length,
                  color: 'text-green-500',
                },
                {
                  label: 'Sessões futuras',
                  sub: 'Agendadas e pendentes',
                  value: pendentes.length,
                  color: 'text-yellow-400',
                },
                {
                  label: 'Comissão gerada',
                  sub: 'Sessões entregues — aguardando pagamento',
                  value: fmtBRL(receitaGerada),
                  color: 'text-green-500',
                },
                {
                  label: 'Comissão futura',
                  sub: 'Sessões agendadas e pendentes não pagas',
                  value: fmtBRL(receitaFutura),
                  color: 'text-gray-400',
                },
              ].map(({ label, sub, value, color }) => (
                <div key={label} className="bg-gray-900 border border-white/10 rounded-xl p-4">
                  <p className="text-xs text-gray-400 mb-1">{label}</p>
                  <p className={`text-lg font-bold ${color}`}>{value}</p>
                  <p className="text-[10px] text-gray-600 mt-0.5 leading-tight">{sub}</p>
                </div>
              ))}
            </div>

            {/* Email do usuário */}
            <div className="mb-4 flex items-center gap-3">
              <label className="text-xs text-gray-500 whitespace-nowrap">Seu e-mail (para autenticação):</label>
              <input type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)}
                className="bg-gray-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500/50 w-56" />
            </div>

            {/* Tabela de sessões */}
            <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10">
                <h2 className="text-sm font-semibold text-white">Sessões ({sessoes.length})</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5">
                      {['#', 'Paciente', 'Data agendada', 'Status', 'Comissão', 'Faltam', 'Ações'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {saleIds.map(saleId => {
                      const grupo = sessoes.filter(s => s.sale_id === saleId)
                      return grupo.map((s, idx) => {
                        const st = STATUS_LABEL[s.status] ?? { label: s.status, color: 'text-gray-400' }
                        const faltam = s.total_sessoes - s.numero_sessao
                        const isUltima = s.numero_sessao === s.total_sessoes
                        return (
                          <tr key={s.id} className={`border-b border-white/5 hover:bg-white/2 transition-colors ${idx === 0 && grupo.length > 1 ? 'border-t border-indigo-500/20' : ''}`}>
                            <td className="px-4 py-3 text-gray-500">{s.numero_sessao}</td>
                            <td className="px-4 py-3">
                              {idx === 0 && (
                                <>
                                  <p className="text-white font-medium">{s.paciente_nome}</p>
                                  <p className="text-xs text-gray-500">{s.paciente_email}</p>
                                </>
                              )}
                            </td>
                            <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{fmtDt(s.data_agendada)}</td>
                            <td className="px-4 py-3">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
                            </td>
                            <td className="px-4 py-3 text-green-500 whitespace-nowrap">{fmtBRL(s.comissao_valor)}</td>
                            <td className="px-4 py-3">
                              {isUltima ? (
                                <span className="text-[10px] text-red-400 border border-red-400/30 px-1.5 py-0.5 rounded">Última sessão</span>
                              ) : (
                                <span className="text-xs text-gray-500">Faltam {faltam}</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2 flex-wrap">
                                {(s.status === 'agendada' || s.status === 'pendente') && (s.status_consulta ?? 'aguardando') === 'aguardando' && (
                                  <button onClick={() => { setStatusSessaoId(s.id); setStatusAcao('iniciar'); setStatusErro('') }}
                                    className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors whitespace-nowrap">
                                    ▶ Iniciar
                                  </button>
                                )}
                                {s.status_consulta === 'em_atendimento' && (
                                  <button onClick={() => { setStatusSessaoId(s.id); setStatusAcao('concluir'); setStatusErro('') }}
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
                                {(s.status === 'agendada' || s.status === 'pendente') && (
                                  <button onClick={() => { setRemarcarSessaoId(s.id); setRemarcarData(s.data_agendada?.slice(0, 16) ?? ''); setRemarcarMotivo('') }}
                                    className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors whitespace-nowrap">
                                    <RefreshCw className="w-3 h-3" /> Remarcar
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })
                    })}
                    {sessoes.length === 0 && (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-600 text-xs">Nenhuma sessão cadastrada</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

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

      <SenhaModal
        isOpen={!!statusSessaoId && (statusAcao !== 'anular' || anularMotivo.trim().length >= 10)}
        onClose={() => { setStatusSessaoId(null); setStatusErro(''); setAnularMotivo('') }}
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

              {/* SEÇÃO 3 — Ocorrências (só notas) */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Ocorrências</h4>
                  {!notaFormOpen && (
                    <button onClick={() => setNotaFormOpen(true)}
                      className="text-xs text-green-500 hover:text-green-400 font-medium transition-colors">
                      + Registrar Nota
                    </button>
                  )}
                </div>

                {notaFormOpen && (
                  <div className="bg-gray-800/50 border border-white/5 rounded-xl p-4 mb-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-white">📝 Nova nota / observação</p>
                      <button onClick={() => setNotaFormOpen(false)} className="text-gray-500 hover:text-white"><X className="w-3.5 h-3.5" /></button>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Título <span className="text-red-400">*</span></label>
                      <input type="text" value={notaTitulo} onChange={e => setNotaTitulo(e.target.value)} maxLength={100}
                        placeholder="Ex: Observação após sessão 2..."
                        className="w-full bg-gray-700 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50" />
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
                      <button onClick={() => setNotaFormOpen(false)}
                        className="px-3 py-1.5 text-xs text-gray-400 bg-gray-700 rounded-lg">Cancelar</button>
                      <button onClick={() => { if (!notaValida) { setNotaErro('Preencha o título e a descrição (mín. 10 caracteres)'); return } setNotaErro(''); setNotaSenhaOpen(true) }}
                        disabled={!notaValida}
                        className="px-4 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg transition-colors">
                        Salvar nota
                      </button>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  {prontuarioOcorrencias.length === 0 ? (
                    <p className="text-xs text-gray-600 text-center py-3">Nenhuma ocorrência registrada.</p>
                  ) : prontuarioOcorrencias.map(o => (
                    <div key={o.id} className="bg-gray-800/40 border border-white/5 rounded-lg p-3 text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-white font-medium">{o.titulo}</span>
                        <span className="text-gray-600 text-[10px]">{fmtDt(o.created_at)}</span>
                      </div>
                      <p className="text-gray-400">{o.descricao}</p>
                      <p className="text-gray-600 text-[10px] mt-1">Por: {o.criado_por_nome}</p>
                    </div>
                  ))}
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

      <MobileNav />
    </div>
  )
}
