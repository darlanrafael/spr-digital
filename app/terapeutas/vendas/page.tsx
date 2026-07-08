'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Calendar, CheckCircle, RefreshCw, X, AlertTriangle } from 'lucide-react'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import SenhaModal from '@/components/SenhaModal'

// ─── Types ────────────────────────────────────────────────────────────────────
type Preset = 'today' | 'yesterday' | 'last_7d' | 'this_month' | 'custom'
type AbaAtiva = 'aprovadas' | 'reembolsos'
type SubAba = 'pendentes' | 'ativos'
type OcorrenciaTipo = null | 'select' | 'nota' | 'remarcacao' | 'reembolso'

type Sale = {
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

type Sessao = {
  id: string
  sale_id: string
  terapeuta_id: string
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
  agendado_por: string | null
  vendedor_nome: string | null
  vendedor_email: string | null
  entregue_confirmado_por: string | null
  iniciado_em: string | null
  concluido_em: string | null
  terapeutas: { nome: string } | null
}

type Ocorrencia = {
  id: string
  sale_id: string
  tipo: string
  titulo: string
  descricao: string
  dados_extras: Record<string, unknown> | null
  criado_por_nome: string
  criado_por_tipo: string
  criado_por_email: string
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

type Terapeuta = { id: string; nome: string }

type PageData = {
  counts: { aprovadas: number; pendentes: number; ativos: number; reembolsos: number }
  vendas_pendentes: Sale[]
  vendas_ativos: Sale[]
  vendas_reembolsos: Sale[]
  sessoes_por_venda: Record<string, Sessao[]>
  ocorrencias_por_venda: Record<string, Ocorrencia[]>
  remarcacoes_por_sessao: Record<string, Remarcacao[]>
  terapeutas: Terapeuta[]
  formatos: string[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtBRL(n: number) {
  return 'R$ ' + new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}
function fmtDt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  })
}
function nowForDatetimeLocal(): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

function inferirNumeroSessoes(produto: string): number {
  const p = produto.toLowerCase()
  if (p.includes('8 sess') || p.includes('8sess')) return 8
  if (p.includes('4 sess') || p.includes('4sess')) return 4
  if (p.includes('2 sess') || p.includes('2sess')) return 2
  return 1
}

function nomeFromEmail(email: string): string {
  const prefix = email.split('@')[0]
  return prefix.replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

const PRESET_LABELS: Record<Preset, string> = {
  today: 'Hoje', yesterday: 'Ontem', last_7d: '7 dias', this_month: 'Este mês', custom: 'Personalizado',
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pendente:  { label: 'Pendente',    cls: 'text-gray-400 bg-gray-400/10' },
  agendada:  { label: 'Agendada',    cls: 'text-blue-400 bg-blue-400/10' },
  entregue:  { label: 'Entregue ✓', cls: 'text-green-500 bg-green-500/10' },
  cancelada: { label: 'Cancelada',   cls: 'text-red-400 bg-red-400/10' },
  remarcada: { label: 'Remarcada',   cls: 'text-yellow-400 bg-yellow-400/10' },
}

const OCORRENCIA_META: Record<string, { icon: string; label: string; cls: string }> = {
  nota:                  { icon: '📝', label: 'Nota',                    cls: 'text-gray-400 bg-gray-400/10 border-gray-400/20' },
  remarcacao:            { icon: '📅', label: 'Remarcação',              cls: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20' },
  confirmacao_entrega:   { icon: '✅', label: 'Sessão Entregue',         cls: 'text-green-500 bg-green-500/10 border-green-500/20' },
  solicitacao_reembolso: { icon: '💰', label: 'Solicitação de Reembolso', cls: 'text-orange-400 bg-orange-400/10 border-orange-400/20' },
  reembolso_aprovado:    { icon: '✅', label: 'Reembolso Aprovado',      cls: 'text-green-500 bg-green-500/10 border-green-500/20' },
  reembolso_rejeitado:   { icon: '❌', label: 'Reembolso Rejeitado',     cls: 'text-red-400 bg-red-400/10 border-red-400/20' },
}

const SC_BADGE: Record<string, { label: string; cls: string }> = {
  aguardando:     { label: 'Aguardando',    cls: 'text-amber-400 bg-amber-400/10' },
  em_atendimento: { label: 'Em atendimento', cls: 'text-blue-400 bg-blue-400/10' },
  concluida:      { label: 'Concluída',     cls: 'text-green-500 bg-green-500/10' },
  cancelada:      { label: 'Cancelada',     cls: 'text-red-400 bg-red-400/10' },
  remarcada:      { label: 'Remarcada',     cls: 'text-purple-400 bg-purple-400/10' },
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

const EMPTY_DATA: PageData = {
  counts: { aprovadas: 0, pendentes: 0, ativos: 0, reembolsos: 0 },
  vendas_pendentes: [], vendas_ativos: [], vendas_reembolsos: [],
  sessoes_por_venda: {}, ocorrencias_por_venda: {}, remarcacoes_por_sessao: {},
  terapeutas: [], formatos: [],
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function TerapeutasVendas() {
  // Filtros
  const [abaAtiva, setAbaAtiva] = useState<AbaAtiva>('aprovadas')
  const [subAba, setSubAba] = useState<SubAba>('pendentes')
  const [preset, setPreset] = useState<Preset>('this_month')
  const [dateStart, setDateStart] = useState('')
  const [dateEnd, setDateEnd] = useState('')
  const [busca, setBusca] = useState('')
  const [filtroTerapeuta, setFiltroTerapeuta] = useState('all')
  const [filtroFormato, setFiltroFormato] = useState('all')

  // Dados
  const [pageData, setPageData] = useState<PageData>(EMPTY_DATA)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')

  // Auth
  const [adminEmail, setAdminEmail] = useState('rafael@spr.com')

  // Toast
  const [toast, setToast] = useState('')
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function showToast(msg: string) {
    setToast(msg)
    if (toastRef.current) clearTimeout(toastRef.current)
    toastRef.current = setTimeout(() => setToast(''), 3500)
  }

  // Modal agendar
  const [agendarVendaId, setAgendarVendaId] = useState<string | null>(null)
  const [agendarTerapeutaId, setAgendarTerapeutaId] = useState('')
  const [agendarDataPrimeira, setAgendarDataPrimeira] = useState('')
  const [agendarNumSessoesInput, setAgendarNumSessoesInput] = useState('')
  const [agendarSenhaOpen, setAgendarSenhaOpen] = useState(false)
  const [agendarLoading, setAgendarLoading] = useState(false)
  const [agendarErro, setAgendarErro] = useState('')

  // Prontuário
  const [prontuarioVendaId, setProntuarioVendaId] = useState<string | null>(null)

  // Status consulta (iniciar / concluir / anular)
  const [scSessaoId, setScSessaoId] = useState<string | null>(null)
  const [scAcao, setScAcao] = useState<'iniciar' | 'concluir' | 'anular'>('iniciar')
  const [scSenhaOpen, setScSenhaOpen] = useState(false)
  const [scLoading, setScLoading] = useState(false)
  const [scErro, setScErro] = useState('')
  const [anularMotivo, setAnularMotivo] = useState('')
  const [scConcluirData, setScConcluirData] = useState('')

  // ── Ocorrências inline no prontuário ──
  const [ocorrenciaTipo, setOcorrenciaTipo] = useState<OcorrenciaTipo>(null)
  // Nota
  const [notaTitulo, setNotaTitulo] = useState('')
  const [notaDesc, setNotaDesc] = useState('')
  const [notaErro, setNotaErro] = useState('')
  const [notaLoading, setNotaLoading] = useState(false)
  const [notaSenhaOpen, setNotaSenhaOpen] = useState(false)
  // Remarcar
  const [remSessaoId, setRemSessaoId] = useState('')
  const [remNovaData, setRemNovaData] = useState('')
  const [remSolicitadoPor, setRemSolicitadoPor] = useState('')
  const [remMotivo, setRemMotivo] = useState('')
  const [remErro, setRemErro] = useState('')
  const [remLoading, setRemLoading] = useState(false)
  const [remSenhaOpen, setRemSenhaOpen] = useState(false)
  // Reembolso
  const [reeSessoes, setReeSessoes] = useState<string[]>([])
  const [reeMotivo, setReeMotivo] = useState('')
  const [reeErro, setReeErro] = useState('')
  const [reeLoading, setReeLoading] = useState(false)
  const [reeSenhaOpen, setReeSenhaOpen] = useState(false)

  // ── Load data ──
  const loadData = useCallback(async () => {
    if (preset === 'custom' && (!dateStart || !dateEnd)) return
    setLoading(true)
    setErro('')
    try {
      const params = new URLSearchParams({ datePreset: preset })
      if (preset === 'custom') {
        params.set('dateStart', dateStart + 'T03:00:00.000Z')
        // Fim do dia em Brasília (23:59:59 BRT) convertido pra UTC = 02:59:59 do dia seguinte
        const fimBrt = new Date(dateEnd + 'T00:00:00Z')
        fimBrt.setUTCDate(fimBrt.getUTCDate() + 1)
        fimBrt.setUTCHours(2, 59, 59, 999)
        params.set('dateEnd', fimBrt.toISOString())
      }
      const res = await fetch('/api/terapeutas/vendas?' + params.toString())
      if (!res.ok) throw new Error(await res.text())
      const json = await res.json() as PageData
      setPageData(json)
      if (json.terapeutas.length > 0 && !agendarTerapeutaId) {
        setAgendarTerapeutaId(json.terapeutas[0].id)
      }
    } catch (e) {
      setErro(String(e))
    } finally {
      setLoading(false)
    }
  }, [preset, dateStart, dateEnd])

  useEffect(() => { loadData() }, [loadData])

  // Reset ocorrência state quando prontuário abre/fecha
  useEffect(() => {
    setOcorrenciaTipo(null)
    setNotaTitulo(''); setNotaDesc(''); setNotaErro('')
    setRemSessaoId(''); setRemNovaData(''); setRemSolicitadoPor(''); setRemMotivo(''); setRemErro('')
    setReeSessoes([]); setReeMotivo(''); setReeErro('')
  }, [prontuarioVendaId])

  // ── Derived ──
  const searchLower = busca.toLowerCase()
  function filterList(list: Sale[]) {
    return list
      .filter(v => !busca || v.nome.toLowerCase().includes(searchLower) || v.email.toLowerCase().includes(searchLower))
      .filter(v => filtroFormato === 'all' || v.produto === filtroFormato)
  }
  function filterAtivos(list: Sale[]) {
    return filterList(list).filter(v =>
      filtroTerapeuta === 'all' ||
      (pageData.sessoes_por_venda[v.id] ?? []).some(s => s.terapeuta_id === filtroTerapeuta)
    )
  }

  const vendasPendentesDisplay = filterList(pageData.vendas_pendentes)
  const vendasAtivosDisplay = filterAtivos(pageData.vendas_ativos)
  const vendasReembolsosDisplay = filterList(pageData.vendas_reembolsos)

  const agendarVenda = agendarVendaId
    ? [...pageData.vendas_pendentes, ...pageData.vendas_ativos].find(v => v.id === agendarVendaId)
    : null
  const agendarNumSessoes = parseInt(agendarNumSessoesInput, 10) || (agendarVenda ? inferirNumeroSessoes(agendarVenda.produto) : 1)
  const agendarPreviewDatas = agendarDataPrimeira && agendarVenda
    ? Array.from({ length: agendarNumSessoes }, (_, i) => {
        const d = new Date(agendarDataPrimeira)
        d.setDate(d.getDate() + i * 7)
        return d
      })
    : []

  const prontuarioSale = prontuarioVendaId
    ? [...pageData.vendas_pendentes, ...pageData.vendas_ativos, ...pageData.vendas_reembolsos].find(v => v.id === prontuarioVendaId)
    : null
  const prontuarioSessoes = prontuarioVendaId ? (pageData.sessoes_por_venda[prontuarioVendaId] ?? []) : []
  const prontuarioOcorrencias = prontuarioVendaId ? (pageData.ocorrencias_por_venda[prontuarioVendaId] ?? []) : []

  const sessoesPendentesProntuario = prontuarioSessoes.filter(s => s.status === 'agendada' || s.status === 'pendente')
  const entreguesProntuario = prontuarioSessoes.filter(s => s.status === 'entregue').length
  const totalProntuario = prontuarioSessoes[0]?.total_sessoes ?? prontuarioSessoes.length

  // Reembolso calculado por tabela de preços
  const terapeutaIdProntuario = prontuarioSessoes[0]?.terapeuta_id ?? ''
  const terapeutaNomeProntuario = pageData.terapeutas.find(t => t.id === terapeutaIdProntuario)?.nome ?? ''
  const reembolsoCalc = prontuarioSale && terapeutaNomeProntuario
    ? calcularReembolsoLocal({
        terapeuta_nome: terapeutaNomeProntuario,
        sessoes_total: totalProntuario,
        sessoes_feitas: entreguesProntuario,
        valor_pago: prontuarioSale.valor_pago_cliente,
      })
    : null
  const valorReembolso = reembolsoCalc?.valor_reembolso ?? 0

  function getVendedor(saleId: string): string {
    const sessoes = pageData.sessoes_por_venda[saleId] ?? []
    const s = sessoes.find(x => x.vendedor_nome) ?? sessoes.find(x => x.agendado_por)
    return s?.vendedor_nome ?? s?.agendado_por ?? '—'
  }

  // Validações
  const remValido = remSessaoId && remNovaData && new Date(remNovaData) > new Date() && remSolicitadoPor && remMotivo.length >= 10
  const reeValido = reeSessoes.length > 0 && reeMotivo.length >= 20
  const notaValida = notaTitulo.trim().length > 0 && notaDesc.trim().length >= 10

  // ── Handlers ──
  async function handleAgendar(senha: string) {
    if (!agendarVendaId || !agendarTerapeutaId || !agendarDataPrimeira) return
    setAgendarLoading(true); setAgendarErro('')
    const res = await fetch('/api/terapeutas/sessoes/agendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sale_id: agendarVendaId, terapeuta_id: agendarTerapeutaId,
        data_primeira_sessao: agendarDataPrimeira,
        numero_sessoes: agendarNumSessoes,
        usuario_email: adminEmail, senha,
      }),
    })
    const json = await res.json()
    setAgendarLoading(false)
    if (!res.ok) { setAgendarErro(json.error ?? 'Erro'); return }
    setAgendarSenhaOpen(false); setAgendarVendaId(null)
    setAgendarDataPrimeira('')
    showToast(`✓ ${json.sessoes_criadas} sessões agendadas com sucesso!`)
    loadData()
  }

  async function handleStatusConsulta(senha: string) {
    if (!scSessaoId) return
    setScLoading(true); setScErro('')
    const res = await fetch('/api/terapeutas/sessoes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessao_id: scSessaoId,
        acao: scAcao,
        motivo: scAcao === 'anular' ? anularMotivo : undefined,
        data_entrega: scAcao === 'concluir' ? new Date(scConcluirData).toISOString() : undefined,
        usuario_nome: nomeFromEmail(adminEmail),
        usuario_tipo: 'admin',
        usuario_email: adminEmail,
        senha,
      }),
    })
    const json = await res.json()
    setScLoading(false)
    if (!res.ok) { setScErro(json.error ?? 'Erro'); return }
    setScSessaoId(null); setScSenhaOpen(false); setAnularMotivo(''); setScConcluirData('')
    const msgs: Record<string, string> = { iniciar: '▶ Consulta iniciada!', concluir: '✓ Consulta concluída!', anular: '✓ Sessão anulada.' }
    showToast(msgs[scAcao] ?? '✓ Feito!')
    loadData()
  }

  async function postOcorrencia(senha: string, payload: {
    tipo: string; titulo: string; descricao: string
    dados_extras?: Record<string, unknown>
  }, onSuccess: () => void, setLoading: (v: boolean) => void, setErro: (v: string) => void) {
    if (!prontuarioVendaId) return
    setLoading(true); setErro('')
    const res = await fetch('/api/terapeutas/vendas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sale_id: prontuarioVendaId,
        ...payload,
        senha,
        usuario_nome: nomeFromEmail(adminEmail),
        usuario_tipo: 'admin',
        usuario_email: adminEmail,
      }),
    })
    const json = await res.json()
    setLoading(false)
    if (!res.ok) { setErro(json.error ?? 'Erro'); return }
    onSuccess()
    loadData()
  }

  async function handleNota(senha: string) {
    await postOcorrencia(
      senha,
      { tipo: 'nota', titulo: notaTitulo, descricao: notaDesc },
      () => {
        setNotaSenhaOpen(false); setOcorrenciaTipo(null)
        setNotaTitulo(''); setNotaDesc('')
        showToast('✓ Nota registrada com sucesso!')
      },
      setNotaLoading, setNotaErro
    )
  }

  async function handleRemarcar(senha: string) {
    const sessao = prontuarioSessoes.find(s => s.id === remSessaoId)
    await postOcorrencia(
      senha,
      {
        tipo: 'remarcacao',
        titulo: `Remarcação — Sessão ${sessao?.numero_sessao ?? ''}`,
        descricao: `Solicitado por: ${remSolicitadoPor}. Motivo: ${remMotivo}`,
        dados_extras: {
          sessao_id: remSessaoId,
          nova_data: remNovaData,
          data_anterior: sessao?.data_agendada ?? '',
          solicitado_por: remSolicitadoPor,
          motivo: remMotivo,
        },
      },
      () => {
        setRemSenhaOpen(false); setOcorrenciaTipo(null)
        setRemSessaoId(''); setRemNovaData(''); setRemSolicitadoPor(''); setRemMotivo('')
        showToast('✓ Sessão remarcada com sucesso!')
      },
      setRemLoading, setRemErro
    )
  }

  async function handleReembolso(senha: string) {
    if (!prontuarioSale) return
    const sessoesSel = prontuarioSessoes.filter(s => reeSessoes.includes(s.id))
    const valorFinal = reembolsoCalc?.valor_reembolso ?? 0
    await postOcorrencia(
      senha,
      {
        tipo: 'solicitacao_reembolso',
        titulo: `Solicitação de reembolso parcial — ${entreguesProntuario} sessão(ões) realizadas`,
        descricao: `${reembolsoCalc?.explicacao ?? ''}. Sessões a cancelar: ${sessoesSel.map(s => s.numero_sessao).join(', ')}. Motivo: ${reeMotivo}`,
        dados_extras: {
          sessoes_ids: reeSessoes,
          sessoes_numeros: sessoesSel.map(s => s.numero_sessao),
          valor_reembolso: valorFinal,
          motivo: reeMotivo,
          paciente_nome: prontuarioSale.nome,
          paciente_email: prontuarioSale.email,
        },
      },
      () => {
        setReeSenhaOpen(false); setOcorrenciaTipo(null)
        setReeSessoes([]); setReeMotivo('')
        showToast('✓ Solicitação enviada para aprovação do CEO!')
      },
      setReeLoading, setReeErro
    )
  }

  // ── Render helpers ──
  function renderFiltros(showTerapeuta: boolean) {
    return (
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input type="text" placeholder="Buscar paciente..." value={busca} onChange={e => setBusca(e.target.value)}
          className="bg-gray-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500/50 w-44" />
        {showTerapeuta && (
          <select value={filtroTerapeuta} onChange={e => setFiltroTerapeuta(e.target.value)}
            className="bg-gray-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500/50">
            <option value="all">Todos os terapeutas</option>
            {pageData.terapeutas.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
        )}
        <select value={filtroFormato} onChange={e => setFiltroFormato(e.target.value)}
          className="bg-gray-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500/50">
          <option value="all">Todos os formatos</option>
          {pageData.formatos.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
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

  function Spinner() {
    return (
      <div className="flex justify-center h-40 items-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  function EmptyRow({ cols, msg }: { cols: number; msg: string }) {
    return <tr><td colSpan={cols} className="px-4 py-10 text-center text-gray-600 text-xs">{msg}</td></tr>
  }

  // ── Main render ──
  return (
    <div className="min-h-screen bg-gray-950 pb-24 md:pb-8">
      <Header />
      <main className="max-w-7xl mx-auto px-4 py-6">

        {/* Título + email */}
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-white">Vendas · Terapeutas</h1>
            <p className="text-sm text-gray-400 mt-1">Gestão de mentorias — Pedro | Denise</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 whitespace-nowrap">Seu e-mail:</span>
            <input type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)}
              className="bg-gray-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500/50 w-48" />
            <button onClick={loadData} className="p-1.5 text-gray-500 hover:text-white transition-colors">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Abas principais */}
        <div className="flex items-center gap-2 mb-4">
          {[
            { id: 'aprovadas', label: `Aprovadas [${pageData.counts.aprovadas}]`, cls: 'bg-green-600' },
            { id: 'reembolsos', label: `Reembolsos [${pageData.counts.reembolsos}]`, cls: 'bg-gray-600' },
          ].map(({ id, label, cls }) => (
            <button key={id} onClick={() => setAbaAtiva(id as AbaAtiva)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                abaAtiva === id ? `${cls} text-white` : 'bg-gray-800 text-gray-400 hover:text-white border border-white/10'
              }`}>{label}</button>
          ))}
        </div>

        {erro && (
          <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400">{erro}</div>
        )}

        {/* ABA: APROVADAS */}
        {abaAtiva === 'aprovadas' && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <button onClick={() => setSubAba('pendentes')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  subAba === 'pendentes' ? 'bg-amber-600/80 text-white' : 'text-gray-400 hover:text-white border border-white/10'
                }`}>
                Agendamentos Pendentes [{pageData.counts.pendentes}]
              </button>
              <button onClick={() => setSubAba('ativos')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  subAba === 'ativos' ? 'bg-blue-600/80 text-white' : 'text-gray-400 hover:text-white border border-white/10'
                }`}>
                Pacientes Ativos [{pageData.counts.ativos}]
              </button>
            </div>

            {/* SUB-ABA: PENDENTES */}
            {subAba === 'pendentes' && (
              <>
                {renderFiltros(false)}
                {loading ? <Spinner /> : (
                  <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-white/10">
                            {['Data da compra', 'Paciente', 'Formato', 'Qtd. Sessões', 'Fat. Bruto', 'Líquido', 'Vendedor', 'Ações'].map(h => (
                              <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-medium whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {vendasPendentesDisplay.length === 0 ? (
                            <EmptyRow cols={8} msg="Nenhuma venda pendente de agendamento" />
                          ) : vendasPendentesDisplay.map(sale => (
                            <tr key={sale.id} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                              <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDt(sale.data_hora)}</td>
                              <td className="px-4 py-3">
                                <p className="text-white font-medium">{sale.nome}</p>
                                <p className="text-xs text-gray-500">{sale.email}</p>
                              </td>
                              <td className="px-4 py-3 text-gray-300 text-xs max-w-[180px] truncate">{sale.produto}</td>
                              <td className="px-4 py-3 text-center">
                                <span className="text-indigo-400 font-medium">{inferirNumeroSessoes(sale.produto)}</span>
                              </td>
                              <td className="px-4 py-3 text-white whitespace-nowrap">{fmtBRL(sale.valor_pago_cliente)}</td>
                              <td className="px-4 py-3 text-green-500 whitespace-nowrap">{fmtBRL(sale.valor_liquido)}</td>
                              <td className="px-4 py-3 text-gray-500 text-xs">—</td>
                              <td className="px-4 py-3">
                                <button onClick={() => {
                                  setAgendarVendaId(sale.id)
                                  setAgendarTerapeutaId(pageData.terapeutas[0]?.id ?? '')
                                  setAgendarDataPrimeira(''); setAgendarErro('')
                                  setAgendarNumSessoesInput(String(inferirNumeroSessoes(sale.produto)))
                                }} className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors whitespace-nowrap">
                                  <Calendar className="w-3 h-3" /> Agendar
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* SUB-ABA: ATIVOS */}
            {subAba === 'ativos' && (
              <>
                {renderFiltros(true)}
                {loading ? <Spinner /> : (
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
                          {vendasAtivosDisplay.length === 0 ? (
                            <EmptyRow cols={9} msg="Nenhum paciente ativo encontrado" />
                          ) : vendasAtivosDisplay.map(sale => {
                            const sessoes = pageData.sessoes_por_venda[sale.id] ?? []
                            const total = sessoes[0]?.total_sessoes ?? sessoes.length
                            const entregues = sessoes.filter(s => s.status === 'entregue').length
                            const progresso = total > 0 ? Math.min((entregues / total) * 100, 100) : 0
                            const concluido = entregues === total && total > 0
                            return (
                              <tr key={sale.id} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                                <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDt(sale.data_hora)}</td>
                                <td className="px-4 py-3">
                                  <p className="text-white font-medium">{sale.nome}</p>
                                  <p className="text-xs text-gray-500">{sale.email}</p>
                                </td>
                                <td className="px-4 py-3 text-gray-300">{total}</td>
                                <td className="px-4 py-3 text-green-500 font-medium">{entregues}</td>
                                <td className="px-4 py-3 text-white whitespace-nowrap">{fmtBRL(sale.valor_pago_cliente)}</td>
                                <td className="px-4 py-3 text-green-500 whitespace-nowrap">{fmtBRL(sale.valor_liquido)}</td>
                                <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{getVendedor(sale.id)}</td>
                                <td className="px-4 py-3 min-w-[120px]">
                                  <div className="w-full bg-gray-800 rounded-full h-1.5">
                                    <div className="bg-green-500 h-1.5 rounded-full transition-all" style={{ width: `${progresso}%` }} />
                                  </div>
                                  <p className={`text-[10px] mt-0.5 ${concluido ? 'text-green-500' : 'text-gray-500'}`}>
                                    {concluido ? 'Concluído ✓' : `${entregues} de ${total} sessões`}
                                  </p>
                                </td>
                                <td className="px-4 py-3">
                                  <button onClick={() => setProntuarioVendaId(sale.id)}
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
              </>
            )}
          </>
        )}

        {/* ABA: REEMBOLSOS */}
        {abaAtiva === 'reembolsos' && (
          <>
            {renderFiltros(false)}
            {loading ? <Spinner /> : (
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
                      {vendasReembolsosDisplay.length === 0 ? (
                        <EmptyRow cols={6} msg="Nenhum reembolso no período" />
                      ) : vendasReembolsosDisplay.map(sale => {
                        const sessoes = pageData.sessoes_por_venda[sale.id] ?? []
                        const canceladas = sessoes.filter(s => s.status === 'cancelada').length
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
      </main>

      {/* ── MODAL: AGENDAR ── */}
      {agendarVendaId && !agendarSenhaOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Agendar sessões — {agendarVenda?.nome}</h3>
              <button onClick={() => setAgendarVendaId(null)} className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Terapeuta <span className="text-red-400">*</span></label>
                <select value={agendarTerapeutaId} onChange={e => setAgendarTerapeutaId(e.target.value)}
                  className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50">
                  {pageData.terapeutas.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Data e horário da 1ª sessão <span className="text-red-400">*</span></label>
                <input type="datetime-local" value={agendarDataPrimeira} onChange={e => setAgendarDataPrimeira(e.target.value)}
                  className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Quantidade de sessões <span className="text-red-400">*</span></label>
                <input type="number" min={1} value={agendarNumSessoesInput} onChange={e => setAgendarNumSessoesInput(e.target.value)}
                  className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
                <p className="text-[10px] text-gray-600 mt-1">
                  Sugerido a partir do nome do produto — confira o pacote real (ex: planilha de acompanhamento) antes de confirmar.
                </p>
              </div>
              {agendarPreviewDatas.length > 0 && (
                <div className="bg-gray-800/60 rounded-lg p-3">
                  <p className="text-xs text-gray-400 mb-2 font-medium">Datas das {agendarNumSessoes} sessões (intervalo de 7 dias):</p>
                  <div className="space-y-1">
                    {agendarPreviewDatas.map((d, i) => (
                      <div key={i} className="flex items-center gap-3 text-xs">
                        <span className="text-gray-500 w-16 shrink-0">Sessão {i + 1}:</span>
                        <span className="text-white">{d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {agendarErro && <p className="text-xs text-red-400">{agendarErro}</p>}
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setAgendarVendaId(null)}
                className="flex-1 px-4 py-2 text-sm text-gray-400 bg-gray-800 border border-white/10 rounded-lg">Cancelar</button>
              <button onClick={() => {
                if (!agendarTerapeutaId || !agendarDataPrimeira) { setAgendarErro('Selecione o terapeuta e a data'); return }
                setAgendarErro(''); setAgendarSenhaOpen(true)
              }} className="flex-1 px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-500 rounded-lg transition-colors">
                Confirmar agendamento
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: PRONTUÁRIO ── */}
      {prontuarioVendaId && prontuarioSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-white/10 rounded-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">

            {/* Header sticky */}
            <div className="sticky top-0 bg-gray-900 border-b border-white/10 px-6 py-4 flex items-start justify-between z-10">
              <div>
                <h3 className="text-sm font-semibold text-white">Prontuário — {prontuarioSale.nome}</h3>
                <p className="text-xs text-gray-400 mt-0.5">{prontuarioSale.email}</p>
              </div>
              <button onClick={() => setProntuarioVendaId(null)} className="text-gray-500 hover:text-white mt-0.5">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-6">

              {/* SEÇÃO 1 — Informações do paciente */}
              <div>
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Informações do paciente</h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    { label: 'Nome', value: prontuarioSale.nome },
                    { label: 'E-mail', value: prontuarioSale.email },
                    { label: 'Telefone', value: prontuarioSale.telefone ?? '—' },
                    { label: 'Formato comprado', value: prontuarioSale.produto },
                    { label: 'Data da compra', value: fmtDt(prontuarioSale.data_hora) },
                    { label: 'Fat. bruto', value: fmtBRL(prontuarioSale.valor_pago_cliente) },
                    { label: 'Valor líquido', value: fmtBRL(prontuarioSale.valor_liquido) },
                    { label: 'Plataforma', value: prontuarioSale.plataforma ?? '—' },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-gray-800/40 rounded-lg p-3">
                      <p className="text-[10px] text-gray-500 mb-0.5">{label}</p>
                      <p className="text-xs text-white">{value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* SEÇÃO 2 — Histórico de sessões */}
              <div>
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  Histórico de sessões ({prontuarioSessoes.length})
                </h4>

                {/* Barra de progresso geral */}
                {prontuarioSessoes.length > 0 && (
                  <div className="mb-4">
                    <div className="w-full bg-gray-800 rounded-full h-2">
                      <div className="bg-green-500 h-2 rounded-full transition-all"
                        style={{ width: `${totalProntuario > 0 ? (entreguesProntuario / totalProntuario) * 100 : 0}%` }} />
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1">{entreguesProntuario} de {totalProntuario} sessões entregues</p>
                  </div>
                )}

                <div className="space-y-3">
                  {prontuarioSessoes.length === 0 ? (
                    <p className="text-xs text-gray-600 text-center py-4">Nenhuma sessão criada ainda.</p>
                  ) : prontuarioSessoes.map(s => {
                    const badge = STATUS_BADGE[s.status] ?? { label: s.status, cls: 'text-gray-400 bg-gray-400/10' }
                    const remarcacoes = pageData.remarcacoes_por_sessao[s.id] ?? []
                    return (
                      <div key={s.id} className="bg-gray-800/40 border border-white/5 rounded-xl p-4">
                        {/* Header do card */}
                        <div className="flex items-center gap-2 mb-3 flex-wrap">
                          <span className="text-xs text-gray-500 font-medium">Sessão {s.numero_sessao} de {s.total_sessoes}</span>
                          <span className={`text-[11px] px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                          {s.status !== 'entregue' && s.status !== 'cancelada' && (
                            <span className={`text-[11px] px-2 py-0.5 rounded-full ${(SC_BADGE[s.status_consulta ?? 'aguardando'] ?? SC_BADGE.aguardando).cls}`}>
                              {(SC_BADGE[s.status_consulta ?? 'aguardando'] ?? SC_BADGE.aguardando).label}
                            </span>
                          )}
                          {s.numero_sessao === s.total_sessoes && (
                            <span className="text-[10px] text-red-400 border border-red-400/30 px-1.5 py-0.5 rounded">Última sessão</span>
                          )}
                        </div>

                        {/* Dados */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-3">
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
                            <p className="text-gray-500">Terapeuta</p>
                            <p className="text-white">{(s.terapeutas as { nome: string } | null)?.nome ?? '—'}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Comissão</p>
                            <p className="text-green-500">{fmtBRL(s.comissao_valor)}</p>
                          </div>
                          {s.link_meet && (
                            <div>
                              <p className="text-gray-500">Meet</p>
                              <a href={s.link_meet} target="_blank" rel="noopener noreferrer"
                                className="text-indigo-400 hover:underline">Abrir link</a>
                            </div>
                          )}
                          {s.agendado_por && (
                            <div>
                              <p className="text-gray-500">Agendado por</p>
                              <p className="text-gray-300 text-[11px]">{s.agendado_por}</p>
                            </div>
                          )}
                        </div>

                        {/* Ações */}
                        <div className="flex items-center gap-3 flex-wrap">
                          {(s.status === 'agendada' || s.status === 'pendente') && (s.status_consulta ?? 'aguardando') === 'aguardando' && (
                            <button onClick={() => { setScSessaoId(s.id); setScAcao('iniciar'); setScErro(''); setScSenhaOpen(true) }}
                              className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors">
                              ▶ Iniciar consulta
                            </button>
                          )}
                          {(s.status === 'agendada' || s.status === 'pendente') && (
                            <button onClick={() => { setScSessaoId(s.id); setScAcao('concluir'); setScConcluirData(nowForDatetimeLocal()); setScErro('') }}
                              className="flex items-center gap-1 text-xs text-green-500 hover:text-green-400 transition-colors">
                              <CheckCircle className="w-3 h-3" /> Concluir consulta
                            </button>
                          )}
                          {s.status === 'entregue' && (
                            <button onClick={() => { setScSessaoId(s.id); setScAcao('anular'); setAnularMotivo(''); setScErro('') }}
                              className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors">
                              Anular sessão
                            </button>
                          )}
                          {(s.status === 'agendada' || s.status === 'pendente') && (
                            <button onClick={() => {
                              setOcorrenciaTipo('remarcacao')
                              setRemSessaoId(s.id)
                              setRemNovaData(s.data_agendada?.slice(0, 16) ?? '')
                              setRemSolicitadoPor(''); setRemMotivo(''); setRemErro('')
                            }} className="flex items-center gap-1 text-xs text-yellow-400 hover:text-yellow-300 transition-colors">
                              <RefreshCw className="w-3 h-3" /> Remarcar
                            </button>
                          )}
                        </div>

                        {/* Histórico de remarcações desta sessão */}
                        {remarcacoes.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
                            <p className="text-[10px] text-gray-500 uppercase tracking-wide font-medium">
                              Histórico de remarcações ({remarcacoes.length})
                            </p>
                            {remarcacoes.map(r => (
                              <div key={r.id} className="bg-yellow-500/5 border border-yellow-500/15 rounded-lg p-2.5 text-xs space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-yellow-400 text-[10px] font-medium px-1.5 py-0.5 bg-yellow-400/10 rounded">⚠️ Remarcada</span>
                                  <span className="text-gray-500 text-[10px]">Remarcado em {fmtDt(r.created_at)}</span>
                                </div>
                                <p className="text-gray-400"><span className="text-gray-500">Por:</span> {r.remarcado_por_nome} ({r.remarcado_por_tipo})</p>
                                <p className="text-gray-400"><span className="text-gray-500">Solicitado pelo/a:</span> {r.solicitado_por}</p>
                                <p className="text-gray-400"><span className="text-gray-500">De:</span> {fmtDt(r.data_anterior)} → <span className="text-gray-500">Para:</span> {fmtDt(r.data_nova)}</p>
                                <div className="bg-gray-800/60 rounded p-2 text-gray-300">
                                  <span className="text-gray-500">Motivo: </span>{r.motivo}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* SEÇÃO 3 — OCORRÊNCIAS */}
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
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {[
                        { tipo: 'nota' as const, icon: '📝', title: 'Nota / Observação', desc: 'Registre uma nota ou observação sobre o paciente' },
                        { tipo: 'remarcacao' as const, icon: '📅', title: 'Remarcar Consulta', desc: 'Solicite a remarcação de uma consulta agendada' },
                        { tipo: 'reembolso' as const, icon: '💰', title: 'Solicitação de Reembolso Parcial', desc: 'Reembolso de sessões não realizadas — vai para aprovação do CEO' },
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
                        const s = prontuarioSessoes.find(x => x.id === e.target.value)
                        setRemSessaoId(e.target.value)
                        setRemNovaData(s?.data_agendada?.slice(0, 16) ?? '')
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
                            const valorSessao = prontuarioSale
                              ? prontuarioSale.valor_pago_cliente / (totalProntuario || 1)
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
                          Registrado por {o.criado_por_nome} ({o.criado_por_tipo}) — {o.criado_por_email}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* SEÇÃO 4 — Resumo financeiro */}
              {prontuarioSessoes.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Resumo financeiro</h4>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: 'Comissão total', value: fmtBRL(prontuarioSessoes.reduce((a, s) => a + (s.comissao_valor || 0), 0)), color: 'text-white' },
                      { label: 'Comissão gerada', value: fmtBRL(prontuarioSessoes.filter(s => s.status === 'entregue').reduce((a, s) => a + (s.comissao_valor || 0), 0)), color: 'text-green-500' },
                      { label: 'Comissão pendente', value: fmtBRL(prontuarioSessoes.filter(s => ['pendente', 'agendada'].includes(s.status)).reduce((a, s) => a + (s.comissao_valor || 0), 0)), color: 'text-gray-400' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="bg-gray-800/40 rounded-lg p-3">
                        <p className="text-[10px] text-gray-500 mb-1">{label}</p>
                        <p className={`text-sm font-bold ${color}`}>{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── SenhaModals ── */}
      <SenhaModal isOpen={agendarSenhaOpen} onClose={() => { setAgendarSenhaOpen(false); setAgendarErro('') }}
        onConfirm={handleAgendar} titulo="Confirmar agendamento"
        descricao="Digite sua senha para registrar as sessões" loading={agendarLoading} erro={agendarErro} />

      {/* Anular sessão — precisa de motivo antes da senha */}
      {scSessaoId && scAcao === 'anular' && !scSenhaOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-sm font-semibold text-white mb-1">Anular sessão concluída</h3>
            <p className="text-xs text-gray-400 mb-4">Informe o motivo. A sessão voltará ao status &quot;Agendada&quot;.</p>
            <textarea value={anularMotivo} onChange={e => setAnularMotivo(e.target.value)} rows={3}
              placeholder="Motivo da anulação (mínimo 10 caracteres)..."
              className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500/50 resize-none mb-3" />
            {scErro && <p className="text-xs text-red-400 mb-3">{scErro}</p>}
            <div className="flex gap-2">
              <button onClick={() => { setScSessaoId(null); setAnularMotivo('') }}
                className="flex-1 px-3 py-2 text-sm text-gray-400 bg-gray-800 border border-white/10 rounded-lg">Cancelar</button>
              <button onClick={() => {
                if (anularMotivo.trim().length < 10) { setScErro('Mínimo 10 caracteres'); return }
                setScErro(''); setScSenhaOpen(true)
              }} className="flex-1 px-3 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors">
                Próximo →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Concluir sessão — precisa da data de entrega antes da senha */}
      {scSessaoId && scAcao === 'concluir' && !scSenhaOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-sm font-semibold text-white mb-1">Concluir sessão</h3>
            <p className="text-xs text-gray-400 mb-4">Data e horário em que a sessão foi de fato entregue (pode ser uma data passada, no caso de lançamento manual).</p>
            <input type="datetime-local" value={scConcluirData} onChange={e => setScConcluirData(e.target.value)}
              className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-green-500/50 mb-3" />
            {scErro && <p className="text-xs text-red-400 mb-3">{scErro}</p>}
            <div className="flex gap-2">
              <button onClick={() => { setScSessaoId(null); setScConcluirData('') }}
                className="flex-1 px-3 py-2 text-sm text-gray-400 bg-gray-800 border border-white/10 rounded-lg">Cancelar</button>
              <button onClick={() => {
                if (!scConcluirData) { setScErro('Informe a data de entrega'); return }
                setScErro(''); setScSenhaOpen(true)
              }} className="flex-1 px-3 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-500 rounded-lg transition-colors">
                Próximo →
              </button>
            </div>
          </div>
        </div>
      )}

      <SenhaModal isOpen={scSenhaOpen} onClose={() => { setScSenhaOpen(false); setScErro('') }}
        onConfirm={handleStatusConsulta}
        titulo={scAcao === 'iniciar' ? 'Iniciar consulta' : scAcao === 'concluir' ? 'Concluir consulta' : 'Anular sessão'}
        descricao="Digite sua senha para confirmar" loading={scLoading} erro={scErro} />

      <SenhaModal isOpen={notaSenhaOpen} onClose={() => { setNotaSenhaOpen(false); setNotaErro('') }}
        onConfirm={handleNota} titulo="Salvar nota" descricao="Digite sua senha para registrar a ocorrência"
        loading={notaLoading} erro={notaErro} />

      <SenhaModal isOpen={remSenhaOpen} onClose={() => { setRemSenhaOpen(false); setRemErro('') }}
        onConfirm={handleRemarcar} titulo="Confirmar remarcação"
        descricao="Digite sua senha para remarcar a sessão" loading={remLoading} erro={remErro} />

      <SenhaModal isOpen={reeSenhaOpen} onClose={() => { setReeSenhaOpen(false); setReeErro('') }}
        onConfirm={handleReembolso} titulo="Enviar solicitação de reembolso"
        descricao="Digite sua senha para enviar para aprovação do CEO" loading={reeLoading} erro={reeErro} />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-[100] bg-gray-800 border border-white/10 text-white text-xs px-4 py-2.5 rounded-full shadow-lg">
          {toast}
        </div>
      )}

      <MobileNav />
    </div>
  )
}
