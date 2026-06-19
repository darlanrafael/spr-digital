'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Calendar, CheckCircle, RefreshCw, X, ChevronDown, ChevronUp } from 'lucide-react'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import SenhaModal from '@/components/SenhaModal'

// ─── Types ────────────────────────────────────────────────────────────────────
type Preset = 'today' | 'yesterday' | 'last_7d' | 'this_month' | 'custom'
type AbaAtiva = 'aprovadas' | 'reembolsos'
type SubAba = 'pendentes' | 'ativos'

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
  data_agendada: string | null
  data_entrega: string | null
  link_meet: string | null
  comissao_valor: number
  comissao_paga: boolean
  paciente_nome: string
  paciente_email: string
  agendado_por: string | null
  entregue_confirmado_por: string | null
  observacoes: string | null
  terapeutas: { nome: string } | null
}

type Terapeuta = { id: string; nome: string }

type PageData = {
  counts: { aprovadas: number; pendentes: number; ativos: number; reembolsos: number }
  vendas_pendentes: Sale[]
  vendas_ativos: Sale[]
  vendas_reembolsos: Sale[]
  sessoes_por_venda: Record<string, Sessao[]>
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
function fmtHora(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
}

function inferirNumeroSessoes(produto: string): number {
  const p = produto.toLowerCase()
  if (p.includes('8 sess') || p.includes('8sess')) return 8
  if (p.includes('4 sess') || p.includes('4sess')) return 4
  if (p.includes('2 sess') || p.includes('2sess')) return 2
  return 1
}

const PRESET_LABELS: Record<Preset, string> = {
  today: 'Hoje', yesterday: 'Ontem', last_7d: '7 dias', this_month: 'Este mês', custom: 'Personalizado',
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pendente: { label: 'Pendente', cls: 'text-amber-400 bg-amber-400/10' },
  agendada: { label: 'Agendada', cls: 'text-blue-400 bg-blue-400/10' },
  entregue: { label: 'Entregue ✓', cls: 'text-green-500 bg-green-500/10' },
  cancelada: { label: 'Cancelada', cls: 'text-red-400 bg-red-400/10' },
  remarcada: { label: 'Remarcada', cls: 'text-yellow-400 bg-yellow-400/10' },
}

const EMPTY_DATA: PageData = {
  counts: { aprovadas: 0, pendentes: 0, ativos: 0, reembolsos: 0 },
  vendas_pendentes: [], vendas_ativos: [], vendas_reembolsos: [],
  sessoes_por_venda: {}, terapeutas: [], formatos: [],
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function TerapeutasVendas() {
  // Filters
  const [abaAtiva, setAbaAtiva] = useState<AbaAtiva>('aprovadas')
  const [subAba, setSubAba] = useState<SubAba>('pendentes')
  const [preset, setPreset] = useState<Preset>('this_month')
  const [dateStart, setDateStart] = useState('')
  const [dateEnd, setDateEnd] = useState('')
  const [busca, setBusca] = useState('')
  const [filtroTerapeuta, setFiltroTerapeuta] = useState('all')
  const [filtroFormato, setFiltroFormato] = useState('all')

  // Data
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
    toastRef.current = setTimeout(() => setToast(''), 3000)
  }

  // Modal agendar
  const [agendarVendaId, setAgendarVendaId] = useState<string | null>(null)
  const [agendarTerapeutaId, setAgendarTerapeutaId] = useState('')
  const [agendarDataPrimeira, setAgendarDataPrimeira] = useState('')
  const [agendarLinkMeet, setAgendarLinkMeet] = useState('')
  const [agendarSenhaOpen, setAgendarSenhaOpen] = useState(false)
  const [agendarLoading, setAgendarLoading] = useState(false)
  const [agendarErro, setAgendarErro] = useState('')

  // Modal prontuário
  const [prontuarioVendaId, setProntuarioVendaId] = useState<string | null>(null)
  const [obsValues, setObsValues] = useState<Record<string, string>>({})
  const [obsSaving, setObsSaving] = useState<Record<string, boolean>>({})
  const [obsSuccess, setObsSuccess] = useState<Record<string, boolean>>({})
  const [prontuarioExpandido, setProntuarioExpandido] = useState<Record<string, boolean>>({})

  // Confirmar entrega (dentro do prontuário)
  const [confirmarSessaoId, setConfirmarSessaoId] = useState<string | null>(null)
  const [confirmarLoading, setConfirmarLoading] = useState(false)
  const [confirmarErro, setConfirmarErro] = useState('')
  const [confirmarSenhaOpen, setConfirmarSenhaOpen] = useState(false)

  // Remarcar (dentro do prontuário)
  const [remarcarSessaoId, setRemarcarSessaoId] = useState<string | null>(null)
  const [remarcarNovaData, setRemarcarNovaData] = useState('')
  const [remarcarMotivo, setRemarcarMotivo] = useState('')
  const [remarcarSenhaOpen, setRemarcarSenhaOpen] = useState(false)
  const [remarcarLoading, setRemarcarLoading] = useState(false)
  const [remarcarErro, setRemarcarErro] = useState('')

  // ── Load data ──
  const loadData = useCallback(async () => {
    if (preset === 'custom' && (!dateStart || !dateEnd)) return
    setLoading(true)
    setErro('')
    try {
      const params = new URLSearchParams({ datePreset: preset })
      if (preset === 'custom') {
        params.set('dateStart', dateStart + 'T03:00:00.000Z')
        params.set('dateEnd', dateEnd + 'T26:59:59.000Z')
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

  // Inicializar obsValues quando prontuário abre
  useEffect(() => {
    if (!prontuarioVendaId) return
    const sessoes = pageData.sessoes_por_venda[prontuarioVendaId] ?? []
    const init: Record<string, string> = {}
    sessoes.forEach(s => { init[s.id] = s.observacoes ?? '' })
    setObsValues(init)
    setObsSuccess({})
  }, [prontuarioVendaId, pageData.sessoes_por_venda])

  // ── Derived values ──
  const searchLower = busca.toLowerCase()
  function filterList(list: Sale[]) {
    return list
      .filter(v => !busca ||
        v.nome.toLowerCase().includes(searchLower) ||
        v.email.toLowerCase().includes(searchLower)
      )
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

  const agendarVenda = agendarVendaId ? [...pageData.vendas_pendentes, ...pageData.vendas_ativos].find(v => v.id === agendarVendaId) : null
  const agendarNumSessoes = agendarVenda ? inferirNumeroSessoes(agendarVenda.produto) : 1
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

  // ── Handlers ──
  async function handleAgendar(senha: string) {
    if (!agendarVendaId || !agendarTerapeutaId || !agendarDataPrimeira) return
    setAgendarLoading(true)
    setAgendarErro('')
    const res = await fetch('/api/terapeutas/sessoes/agendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sale_id: agendarVendaId,
        terapeuta_id: agendarTerapeutaId,
        data_primeira_sessao: agendarDataPrimeira,
        link_meet: agendarLinkMeet || undefined,
        usuario_email: adminEmail,
        senha,
      }),
    })
    const json = await res.json()
    setAgendarLoading(false)
    if (!res.ok) { setAgendarErro(json.error ?? 'Erro ao agendar'); return }
    setAgendarSenhaOpen(false)
    setAgendarVendaId(null)
    setAgendarDataPrimeira('')
    setAgendarLinkMeet('')
    showToast(`✓ ${json.sessoes_criadas} sessões agendadas com sucesso!`)
    loadData()
  }

  async function handleConfirmar(senha: string) {
    if (!confirmarSessaoId) return
    setConfirmarLoading(true)
    setConfirmarErro('')
    const res = await fetch('/api/terapeutas/sessoes/confirmar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessao_id: confirmarSessaoId, usuario_email: adminEmail, senha }),
    })
    const json = await res.json()
    setConfirmarLoading(false)
    if (!res.ok) { setConfirmarErro(json.error ?? 'Erro'); return }
    setConfirmarSessaoId(null)
    setConfirmarSenhaOpen(false)
    showToast('✓ Sessão confirmada como entregue!')
    loadData()
  }

  async function handleRemarcar(senha: string) {
    if (!remarcarSessaoId || !remarcarNovaData) return
    setRemarcarLoading(true)
    setRemarcarErro('')
    const res = await fetch('/api/terapeutas/sessoes/remarcar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessao_id: remarcarSessaoId, nova_data: remarcarNovaData, motivo: remarcarMotivo, usuario_email: adminEmail, senha }),
    })
    const json = await res.json()
    setRemarcarLoading(false)
    if (!res.ok) { setRemarcarErro(json.error ?? 'Erro'); return }
    setRemarcarSessaoId(null)
    setRemarcarSenhaOpen(false)
    setRemarcarNovaData('')
    setRemarcarMotivo('')
    showToast('✓ Sessão remarcada com sucesso!')
    loadData()
  }

  async function handleSalvarObs(sessaoId: string) {
    setObsSaving(p => ({ ...p, [sessaoId]: true }))
    setObsSuccess(p => ({ ...p, [sessaoId]: false }))
    const res = await fetch('/api/terapeutas/vendas', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessao_id: sessaoId, observacoes: obsValues[sessaoId] ?? '' }),
    })
    setObsSaving(p => ({ ...p, [sessaoId]: false }))
    if (res.ok) {
      setObsSuccess(p => ({ ...p, [sessaoId]: true }))
      setTimeout(() => setObsSuccess(p => ({ ...p, [sessaoId]: false })), 2000)
    }
  }

  // ── Render helpers ──
  function renderFiltros(showTerapeuta: boolean) {
    return (
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="text"
          placeholder="Buscar paciente..."
          value={busca}
          onChange={e => setBusca(e.target.value)}
          className="bg-gray-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500/50 w-44"
        />
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
              }`}>
              {PRESET_LABELS[p]}
            </button>
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
          <button onClick={() => setAbaAtiva('aprovadas')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              abaAtiva === 'aprovadas' ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white border border-white/10'
            }`}>
            Aprovadas [{pageData.counts.aprovadas}]
          </button>
          <button onClick={() => setAbaAtiva('reembolsos')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              abaAtiva === 'reembolsos' ? 'bg-gray-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white border border-white/10'
            }`}>
            Reembolsos [{pageData.counts.reembolsos}]
          </button>
        </div>

        {erro && (
          <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400">
            {erro}
          </div>
        )}

        {/* ABA: APROVADAS */}
        {abaAtiva === 'aprovadas' && (
          <>
            {/* Sub-abas */}
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
                {loading ? (
                  <div className="flex justify-center h-40 items-center">
                    <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : (
                  <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-white/10">
                            {['Data', 'Paciente', 'Formato', 'Qtd. Sessões', 'Fat. Bruto', 'Líquido', 'Ações'].map(h => (
                              <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-medium whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {vendasPendentesDisplay.length === 0 ? (
                            <EmptyRow cols={7} msg="Nenhuma venda pendente de agendamento" />
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
                              <td className="px-4 py-3">
                                <button
                                  onClick={() => {
                                    setAgendarVendaId(sale.id)
                                    setAgendarTerapeutaId(pageData.terapeutas[0]?.id ?? '')
                                    setAgendarDataPrimeira('')
                                    setAgendarLinkMeet('')
                                    setAgendarErro('')
                                  }}
                                  className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors whitespace-nowrap"
                                >
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
                {loading ? (
                  <div className="flex justify-center h-40 items-center">
                    <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : (
                  <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-white/10">
                            {['Data', 'Paciente', 'Qtd. Sessões', 'Sessões Feitas', 'Fat. Bruto', 'Líquido', 'Progresso', 'Ações'].map(h => (
                              <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-medium whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {vendasAtivosDisplay.length === 0 ? (
                            <EmptyRow cols={8} msg="Nenhum paciente ativo encontrado" />
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
                                <td className="px-4 py-3 text-gray-300">{total} sessões</td>
                                <td className="px-4 py-3 text-green-500 font-medium">{entregues}</td>
                                <td className="px-4 py-3 text-white whitespace-nowrap">{fmtBRL(sale.valor_pago_cliente)}</td>
                                <td className="px-4 py-3 text-green-500 whitespace-nowrap">{fmtBRL(sale.valor_liquido)}</td>
                                <td className="px-4 py-3 min-w-[120px]">
                                  <div className="w-full bg-gray-800 rounded-full h-1.5">
                                    <div className="bg-green-500 h-1.5 rounded-full transition-all" style={{ width: `${progresso}%` }} />
                                  </div>
                                  <p className={`text-[10px] mt-0.5 ${concluido ? 'text-green-500' : 'text-gray-500'}`}>
                                    {concluido ? 'Concluído ✓' : `${entregues} de ${total} sessões`}
                                  </p>
                                </td>
                                <td className="px-4 py-3">
                                  <button
                                    onClick={() => setProntuarioVendaId(sale.id)}
                                    className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors whitespace-nowrap"
                                  >
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
            {loading ? (
              <div className="flex justify-center h-40 items-center">
                <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
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
                        <EmptyRow cols={6} msg="Nenhum reembolso no período selecionado" />
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
              <h3 className="text-sm font-semibold text-white">
                Agendar sessões — {agendarVenda?.nome}
              </h3>
              <button onClick={() => setAgendarVendaId(null)} className="text-gray-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
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
                <input type="datetime-local" value={agendarDataPrimeira}
                  onChange={e => setAgendarDataPrimeira(e.target.value)}
                  className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
              </div>

              <div>
                <label className="text-xs text-gray-400 block mb-1">Link Google Meet (opcional)</label>
                <input type="url" value={agendarLinkMeet} placeholder="https://meet.google.com/..."
                  onChange={e => setAgendarLinkMeet(e.target.value)}
                  className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
              </div>

              {/* Preview datas */}
              {agendarPreviewDatas.length > 0 && (
                <div className="bg-gray-800/60 rounded-lg p-3">
                  <p className="text-xs text-gray-400 mb-2 font-medium">
                    Datas das {agendarNumSessoes} sessões (intervalo de 7 dias):
                  </p>
                  <div className="space-y-1">
                    {agendarPreviewDatas.map((d, i) => (
                      <div key={i} className="flex items-center gap-3 text-xs">
                        <span className="text-gray-500 w-16 shrink-0">Sessão {i + 1}:</span>
                        <span className="text-white">{d.toLocaleString('pt-BR', {
                          day: '2-digit', month: '2-digit', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {agendarErro && <p className="text-xs text-red-400">{agendarErro}</p>}
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={() => setAgendarVendaId(null)}
                className="flex-1 px-4 py-2 text-sm text-gray-400 bg-gray-800 border border-white/10 rounded-lg">
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (!agendarTerapeutaId || !agendarDataPrimeira) {
                    setAgendarErro('Selecione o terapeuta e a data')
                    return
                  }
                  setAgendarErro('')
                  setAgendarSenhaOpen(true)
                }}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-500 rounded-lg transition-colors">
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
            {/* Header do prontuário */}
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
              {/* Seção 1 — Info do paciente */}
              <div>
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Informações do paciente</h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    { label: 'Nome', value: prontuarioSale.nome },
                    { label: 'E-mail', value: prontuarioSale.email },
                    { label: 'Telefone', value: prontuarioSale.telefone ?? '—' },
                    { label: 'Formato comprado', value: prontuarioSale.produto },
                    { label: 'Data da compra', value: fmtDt(prontuarioSale.data_hora) },
                    { label: 'Faturamento bruto', value: fmtBRL(prontuarioSale.valor_pago_cliente) },
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

              {/* Seção 2 — Histórico de sessões */}
              <div>
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                  Histórico de sessões ({prontuarioSessoes.length})
                </h4>
                <div className="space-y-3">
                  {prontuarioSessoes.length === 0 ? (
                    <p className="text-xs text-gray-600 text-center py-4">Nenhuma sessão criada ainda.</p>
                  ) : prontuarioSessoes.map(s => {
                    const badge = STATUS_BADGE[s.status] ?? { label: s.status, cls: 'text-gray-400 bg-gray-400/10' }
                    const isRemarcar = remarcarSessaoId === s.id
                    return (
                      <div key={s.id} className="bg-gray-800/40 border border-white/5 rounded-xl p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 font-medium">Sessão {s.numero_sessao} de {s.total_sessoes}</span>
                            <span className={`text-[11px] px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                            {s.numero_sessao === s.total_sessoes && (
                              <span className="text-[10px] text-red-400 border border-red-400/30 px-1.5 py-0.5 rounded">Última sessão</span>
                            )}
                          </div>
                          <button
                            onClick={() => setProntuarioExpandido(p => ({ ...p, [s.id]: !p[s.id] }))}
                            className="text-gray-500 hover:text-white"
                          >
                            {prontuarioExpandido[s.id] ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                        </div>

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
                              <p className="text-gray-300">{s.agendado_por}</p>
                            </div>
                          )}
                          {s.data_agendada && s.status === 'agendada' && (
                            <div>
                              <p className="text-gray-500">Horário</p>
                              <p className="text-indigo-400 font-medium">{fmtHora(s.data_agendada)}</p>
                            </div>
                          )}
                        </div>

                        {/* Ações */}
                        <div className="flex items-center gap-3 mb-3">
                          {s.status === 'agendada' && (
                            <button
                              onClick={() => { setConfirmarSessaoId(s.id); setConfirmarErro(''); setConfirmarSenhaOpen(true) }}
                              className="flex items-center gap-1 text-xs text-green-500 hover:text-green-400 transition-colors"
                            >
                              <CheckCircle className="w-3 h-3" /> Confirmar entrega
                            </button>
                          )}
                          {(s.status === 'agendada' || s.status === 'pendente') && (
                            <button
                              onClick={() => {
                                setRemarcarSessaoId(isRemarcar ? null : s.id)
                                setRemarcarNovaData(s.data_agendada?.slice(0, 16) ?? '')
                                setRemarcarMotivo('')
                                setRemarcarErro('')
                              }}
                              className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors"
                            >
                              <RefreshCw className="w-3 h-3" /> Remarcar
                            </button>
                          )}
                        </div>

                        {/* Formulário remarcar inline */}
                        {isRemarcar && (
                          <div className="bg-gray-800 rounded-lg p-3 mb-3 space-y-2">
                            <p className="text-xs text-gray-400 font-medium">Remarcar sessão</p>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-[10px] text-gray-500 block mb-1">Nova data e hora</label>
                                <input type="datetime-local" value={remarcarNovaData}
                                  onChange={e => setRemarcarNovaData(e.target.value)}
                                  className="w-full bg-gray-700 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:outline-none" />
                              </div>
                              <div>
                                <label className="text-[10px] text-gray-500 block mb-1">Motivo (opcional)</label>
                                <input type="text" value={remarcarMotivo} placeholder="Ex: Paciente solicitou"
                                  onChange={e => setRemarcarMotivo(e.target.value)}
                                  className="w-full bg-gray-700 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:outline-none" />
                              </div>
                            </div>
                            {remarcarErro && <p className="text-xs text-red-400">{remarcarErro}</p>}
                            <div className="flex gap-2 pt-1">
                              <button onClick={() => setRemarcarSessaoId(null)}
                                className="px-3 py-1 text-xs text-gray-400 bg-gray-700 rounded">Cancelar</button>
                              <button onClick={() => { if (!remarcarNovaData) return; setRemarcarSenhaOpen(true) }}
                                className="px-3 py-1 text-xs font-medium text-white bg-purple-600 hover:bg-purple-500 rounded transition-colors">
                                Confirmar data
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Observações */}
                        {(prontuarioExpandido[s.id] || s.observacoes) && (
                          <div>
                            <label className="text-[10px] text-gray-500 block mb-1">Observações / Transcrição da sessão</label>
                            <textarea
                              value={obsValues[s.id] ?? s.observacoes ?? ''}
                              onChange={e => setObsValues(p => ({ ...p, [s.id]: e.target.value }))}
                              rows={3}
                              placeholder="Adicionar notas sobre esta sessão..."
                              className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50 resize-y"
                            />
                            <div className="flex items-center gap-2 mt-1.5">
                              <button
                                onClick={() => handleSalvarObs(s.id)}
                                disabled={obsSaving[s.id]}
                                className="px-3 py-1 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 rounded transition-colors"
                              >
                                {obsSaving[s.id] ? 'Salvando...' : 'Salvar observações'}
                              </button>
                              {obsSuccess[s.id] && <span className="text-xs text-green-500">✓ Salvo!</span>}
                            </div>
                          </div>
                        )}
                        {!prontuarioExpandido[s.id] && !s.observacoes && (
                          <button onClick={() => setProntuarioExpandido(p => ({ ...p, [s.id]: true }))}
                            className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors">
                            + Adicionar observações
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Seção 3 — Resumo financeiro */}
              {prontuarioSessoes.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Resumo financeiro</h4>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      {
                        label: 'Comissão total',
                        value: fmtBRL(prontuarioSessoes.reduce((a, s) => a + (s.comissao_valor || 0), 0)),
                        color: 'text-white',
                      },
                      {
                        label: 'Comissão gerada (entregues)',
                        value: fmtBRL(prontuarioSessoes.filter(s => s.status === 'entregue').reduce((a, s) => a + (s.comissao_valor || 0), 0)),
                        color: 'text-green-500',
                      },
                      {
                        label: 'Comissão pendente',
                        value: fmtBRL(prontuarioSessoes.filter(s => ['pendente', 'agendada'].includes(s.status)).reduce((a, s) => a + (s.comissao_valor || 0), 0)),
                        color: 'text-gray-400',
                      },
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

      {/* SenhaModal: Agendar */}
      <SenhaModal
        isOpen={agendarSenhaOpen}
        onClose={() => { setAgendarSenhaOpen(false); setAgendarErro('') }}
        onConfirm={handleAgendar}
        titulo="Confirmar agendamento"
        descricao="Digite sua senha para registrar as sessões"
        loading={agendarLoading}
        erro={agendarErro}
      />

      {/* SenhaModal: Confirmar entrega */}
      <SenhaModal
        isOpen={confirmarSenhaOpen}
        onClose={() => { setConfirmarSenhaOpen(false); setConfirmarErro('') }}
        onConfirm={handleConfirmar}
        titulo="Confirmar entrega de sessão"
        descricao="Digite sua senha para confirmar que a sessão foi realizada"
        loading={confirmarLoading}
        erro={confirmarErro}
      />

      {/* SenhaModal: Remarcar */}
      <SenhaModal
        isOpen={remarcarSenhaOpen}
        onClose={() => { setRemarcarSenhaOpen(false); setRemarcarErro('') }}
        onConfirm={handleRemarcar}
        titulo="Confirmar remarcação"
        descricao="Digite sua senha para remarcar a sessão"
        loading={remarcarLoading}
        erro={remarcarErro}
      />

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
