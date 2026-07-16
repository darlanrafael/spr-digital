'use client'

import { useState, useMemo, useEffect } from 'react'
import { Plus, TrendingUp, TrendingDown, DollarSign, Target, Pencil, Trash2, Check, X, RotateCcw } from 'lucide-react'
import { useApp } from '@/contexts/AppContext'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import PlatformBadge from '@/components/PlatformBadge'
import Modal from '@/components/Modal'
import ProtectedRoute from '@/components/ProtectedRoute'
import BestTimesComparison from '@/components/BestTimesPanel'
import {
  formatCurrency, formatDate, getSaleBruto, getAliquotaByPreco, getImpostoBase,
  getCurrentWeekRange,
} from '@/lib/formatters'
import {
  addFixedCost as svcAddFixed, updateFixedCost as svcUpdateFixed,
  deleteFixedCost as svcDeleteFixed, addCost as svcAddVar, updateCost as svcUpdateVar,
  deleteCost as svcDeleteVar,
} from '@/lib/services'
import { FixedCost, VariableCost, Sale } from '@/types'

// ─── MetaAdsCard — componente autônomo com estado próprio ──────────────────────
// Definido fora de DashboardContent para que re-renders do pai não o afetem.
type MetaCampanha = { name: string; spend: number; accountId: string }

function MetaAdsCard({
  datePreset,
  customDateStart,
  customDateEnd,
  projectId,
  onTotalChange,
  periodKey,
}: {
  datePreset: string
  customDateStart?: string
  customDateEnd?: string
  projectId: string
  onTotalChange: (total: number) => void
  periodKey: string
}) {
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [campanhas, setCampanhas] = useState<MetaCampanha[]>([])
  const [expanded, setExpanded] = useState(false)
  const [erro, setErro] = useState(false)
  // refreshKey força nova busca manual mantendo as mesmas datas
  const [refreshKey, setRefreshKey] = useState(0)

  // Busca automática: ao montar, ao mudar período e ao forçar refresh manual
  useEffect(() => {
    const isCustom = datePreset === 'custom'
    if (!datePreset) return
    if (isCustom && (!customDateStart || !customDateEnd)) return
    let cancelled = false

    const run = async () => {
      setLoading(true)
      setErro(false)

      try {
        const url = isCustom
          ? `/api/meta/insights?dateStart=${customDateStart}&dateEnd=${customDateEnd}&projectId=${projectId}`
          : `/api/meta/insights?datePreset=${datePreset}&projectId=${projectId}`
        const res = await fetch(url, { cache: 'no-store' })
        const data = await res.json() as { total?: number; campanhas?: MetaCampanha[]; erro?: string }
        console.log('[MetaAdsCard] total:', data.total, '| campanhas:', data.campanhas?.length)

        if (!cancelled) {
          const t = typeof data.total === 'number' ? data.total : 0
          setTotal(t)
          setCampanhas(data.campanhas ?? [])
          onTotalChange(t)
        }
      } catch (err) {
        console.error('[MetaAdsCard] ERRO:', err)
        if (!cancelled) setErro(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    run()
    return () => { cancelled = true }
  // onTotalChange é setMetaAdsTotal — setter estável do React, não causa re-runs extras
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datePreset, customDateStart, customDateEnd, projectId, refreshKey, periodKey])

  const fmt = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(v)

  const ativasFiltradas = campanhas.filter(c => c.spend > 0).sort((a, b) => b.spend - a.spend)

  return (
    <div style={{ background: '#111827', border: '1px solid rgba(99,179,237,0.3)', borderRadius: '12px', padding: '16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
        <p style={{ fontSize: '11px', color: '#9CA3AF', fontWeight: 500, margin: 0 }}>
          Investimento Meta Ads
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {total !== null && !loading && <span style={{ fontSize: '9px', color: '#60A5FA', fontWeight: 700 }}>API</span>}
          <button
            type="button"
            onClick={() => setRefreshKey(k => k + 1)}
            disabled={loading}
            title="Atualizar via Meta Ads API"
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '6px',
              color: loading ? '#4B5563' : '#9CA3AF',
              cursor: loading ? 'not-allowed' : 'pointer',
              padding: '4px 6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <RotateCcw className={`h-3.5 w-3.5${loading ? ' animate-spin' : ''}`} />
          </button>
          <Target style={{ width: '16px', height: '16px', color: '#6B7280' }} />
        </div>
      </div>

      {/* Body */}
      {erro ? (
        <div>
          <p style={{ fontSize: '20px', fontWeight: 700, color: '#F87171', margin: 0 }}>Erro ao buscar</p>
          <button
            type="button"
            onClick={() => setRefreshKey(k => k + 1)}
            style={{ background: 'none', border: 'none', color: '#6B7280', cursor: 'pointer', fontSize: '11px', padding: 0, marginTop: '4px' }}
          >
            Tentar novamente
          </button>
        </div>
      ) : total === null ? (
        <div>
          <p style={{ fontSize: '16px', fontWeight: 500, color: '#6B7280', margin: 0 }}>
            {loading ? 'Carregando...' : '—'}
          </p>
          {!loading && <p style={{ fontSize: '11px', color: '#4B5563', margin: '4px 0 0' }}>Aguardando dados</p>}
        </div>
      ) : (
        <div>
          <p style={{ fontSize: '22px', fontWeight: 700, color: '#F87171', margin: 0 }}>
            {fmt(total)}
          </p>
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            style={{ background: 'none', border: 'none', color: '#60A5FA', cursor: 'pointer', fontSize: '11px', padding: 0, marginTop: '4px' }}
          >
            {ativasFiltradas.length} campanha{ativasFiltradas.length !== 1 ? 's' : ''} · {expanded ? 'ocultar ▲' : 'ver detalhes ▼'}
          </button>
          {expanded && ativasFiltradas.length > 0 && (
            <div style={{ marginTop: '8px', maxHeight: '160px', overflowY: 'auto' }}>
              {ativasFiltradas.map((c, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <span style={{ fontSize: '11px', color: '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '68%' }}>
                    {c.name}
                  </span>
                  <span style={{ fontSize: '11px', color: '#F9FAFB', fontWeight: 500, flexShrink: 0 }}>
                    {fmt(c.spend)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

type PeriodFilter = 'today' | 'yesterday' | 'week' | 'month' | 'custom'
type FaturamentoToggle = 'produto' | 'plataforma'
type BalancoToggle = 'completo' | 'sem_fixos'

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <DashboardContent />
    </ProtectedRoute>
  )
}

function DashboardContent() {
  const { sales, costs, setCosts, products, selectedProject, user } = useApp()

  const [period, setPeriod] = useState<PeriodFilter>('today')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [faturamentoToggle, setFaturamentoToggle] = useState<FaturamentoToggle>('produto')
  const [balancoToggle, setBalancoToggle] = useState<BalancoToggle>('completo')

  // Total do Meta Ads comunicado via callback do MetaAdsCard
  const [metaAdsTotal, setMetaAdsTotal] = useState<number>(0)
  // Preset nativo da Meta API para o período selecionado
  const [metaDatePreset, setMetaDatePreset] = useState<string>('today')
  // Muda sempre que o usuário clica num botão de período, garantindo re-fetch
  const [metaPeriodKey, setMetaPeriodKey] = useState<string>('')

  // Custos fixos inline editing
  const [editingFixedId, setEditingFixedId] = useState<string | null>(null)
  const [editFixedForm, setEditFixedForm] = useState({ descricao: '', valor: '', data: '' })
  const [addingFixed, setAddingFixed] = useState(false)
  const [newFixedForm, setNewFixedForm] = useState({ descricao: '', valor: '' })

  // Custos variáveis
  const [showVarModal, setShowVarModal] = useState(false)
  const [varForm, setVarForm] = useState({ descricao: '', valor: '', data: '' })
  const [editingVarId, setEditingVarId] = useState<string | null>(null)
  const [editVarForm, setEditVarForm] = useState({ descricao: '', valor: '', data: '' })

  // Mês de referência dos custos fixos e variáveis — independente do período de faturamento
  const [custosMesRef, setCustosMesRef] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })

  const [periodSales, setPeriodSales] = useState<Sale[]>([])
  const [salesLoading, setSalesLoading] = useState(false)

  const [dashTab, setDashTab] = useState<'visao_geral' | 'melhores_horarios'>('visao_geral')

  const canEdit = user?.role === 'admin'

  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const yd = new Date(today); yd.setDate(today.getDate() - 1)
  const yesterdayStr = `${yd.getFullYear()}-${String(yd.getMonth() + 1).padStart(2, '0')}-${String(yd.getDate()).padStart(2, '0')}`
  const monthStr = todayStr.slice(0, 7)
  const weekRange = useMemo(() => getCurrentWeekRange(), [todayStr])

  const periodBounds = useMemo(() => {
    if (period === 'today') return { start: todayStr, end: todayStr }
    if (period === 'yesterday') return { start: yesterdayStr, end: yesterdayStr }
    if (period === 'week') return { start: weekRange.start, end: weekRange.end }
    if (period === 'month') return { start: `${monthStr}-01`, end: todayStr }
    if (period === 'custom' && customStart && customEnd) return { start: customStart, end: customEnd }
    return null
  }, [period, todayStr, yesterdayStr, monthStr, weekRange, customStart, customEnd])

  useEffect(() => {
    if (!periodBounds) {
      setSalesLoading(false)
      return
    }
    let cancelled = false
    const fetchPeriodSales = async () => {
      setSalesLoading(true)
      try {
        const params = new URLSearchParams({
          projectId: selectedProject === 'all' ? 'proj_1' : selectedProject,
          dateStart: periodBounds.start,
          dateEnd: periodBounds.end,
        })
        const res = await fetch(`/api/sales?${params}`)
        const data = await res.json()
        if (!cancelled) setPeriodSales(Array.isArray(data) ? data : [])
      } catch (err) {
        console.error('[Dashboard] Erro ao buscar vendas:', err)
        if (!cancelled) setPeriodSales([])
      } finally {
        if (!cancelled) setSalesLoading(false)
      }
    }
    fetchPeriodSales()
    return () => { cancelled = true }
  }, [periodBounds, selectedProject])

  const productMap = useMemo(() => Object.fromEntries(products.map(p => [p.id, p])), [products])

  const faturamentoBruto = useMemo(
    () => periodSales.reduce((acc, s) => acc + getSaleBruto(s), 0),
    [periodSales]
  )
  const faturamentoLiquido = useMemo(
    () => periodSales.reduce((acc, s) => acc + s.valor_liquido, 0),
    [periodSales]
  )
  const impostoTotal = useMemo(() => {
    return periodSales.reduce((acc, s) => {
      const aliquota = getAliquotaByPreco(s.preco_base)
      return acc + getImpostoBase(s) * (aliquota / 100)
    }, 0)
  }, [periodSales])

  const roas = metaAdsTotal > 0 ? faturamentoLiquido / metaAdsTotal : null

  // Custo já incluído num fechamento confirmado (fechamentoId preenchido) já
  // foi pago naquele fechamento — não deve mais aparecer aqui, senão parece
  // que ainda está pendente de pagamento quando na verdade já saiu.
  const fixedCostsFiltered = useMemo(
    () => costs.fixos.filter(c => c.data.startsWith(custosMesRef) && !c.fechamentoId),
    [costs.fixos, custosMesRef]
  )
  const fixedCostsTotal = fixedCostsFiltered.reduce((a, c) => a + c.valor, 0)

  const varCostsFiltered = useMemo(
    () => costs.variaveis.filter(v => v.data.startsWith(custosMesRef) && !v.fechamentoId),
    [costs.variaveis, custosMesRef]
  )

  const varCostsTotal = varCostsFiltered.reduce((a, c) => a + c.valor, 0)

  const byProduct = useMemo(() => {
    const map: Record<string, { produto: string; plataforma: string; qtd: number; bruto: number; aliquota: number; imposto: number; liquido: number; liquido_pos_impostos: number }> = {}
    for (const s of periodSales) {
      const prod = productMap[s.produto]
      const aliquota = getAliquotaByPreco(s.preco_base)
      if (!map[s.produto]) {
        map[s.produto] = {
          produto: prod?.nome ?? s.produto,
          plataforma: s.plataforma,
          qtd: 0, bruto: 0, aliquota, imposto: 0, liquido: 0, liquido_pos_impostos: 0,
        }
      }
      const impostoVenda = getImpostoBase(s) * (aliquota / 100)
      map[s.produto].qtd++
      map[s.produto].bruto += getSaleBruto(s)
      map[s.produto].imposto += impostoVenda
      map[s.produto].liquido += s.valor_liquido
      map[s.produto].liquido_pos_impostos += s.valor_liquido - impostoVenda
    }
    return Object.values(map)
  }, [periodSales, productMap])

  const byPlatform = useMemo(() => {
    const map: Record<string, { plataforma: string; qtd: number; bruto: number; liquido: number }> = {}
    for (const s of periodSales) {
      const key = s.plataforma
      if (!map[key]) map[key] = { plataforma: s.plataforma, qtd: 0, bruto: 0, liquido: 0 }
      map[key].qtd++
      map[key].bruto += getSaleBruto(s)
      map[key].liquido += s.valor_liquido
    }
    const entries = Object.values(map)
    const totalBruto = entries.reduce((a, e) => a + e.bruto, 0)
    return entries.map(e => ({ ...e, pct: totalBruto > 0 ? (e.bruto / totalBruto) * 100 : 0 }))
  }, [periodSales])

  const resultadoCompleto = faturamentoBruto - impostoTotal - metaAdsTotal - fixedCostsTotal - varCostsTotal
  const resultadoSemFixos = faturamentoBruto - impostoTotal - metaAdsTotal - varCostsTotal

  // Fixed costs CRUD
  function startEditFixed(c: FixedCost) {
    setEditingFixedId(c.id)
    setEditFixedForm({ descricao: c.descricao, valor: String(c.valor), data: c.data.slice(0, 7) })
  }

  async function saveEditFixed(id: string) {
    const patch = { descricao: editFixedForm.descricao, valor: parseFloat(editFixedForm.valor) || 0, data: `${editFixedForm.data}-01` }
    try { await svcUpdateFixed(id, patch) } catch (e) { console.error(e) }
    setCosts(prev => ({ ...prev, fixos: prev.fixos.map(c => c.id === id ? { ...c, ...patch } : c) }))
    setEditingFixedId(null)
  }

  async function deleteFixed(id: string) {
    try { await svcDeleteFixed(id) } catch (e) { console.error(e) }
    setCosts(prev => ({ ...prev, fixos: prev.fixos.filter(c => c.id !== id) }))
  }

  async function handleAddFixed(e: React.FormEvent) {
    e.preventDefault()
    const newFixed: FixedCost = {
      id: `cf_${Date.now()}`,
      descricao: newFixedForm.descricao,
      valor: parseFloat(newFixedForm.valor) || 0,
      data: `${custosMesRef}-01`,
      fechamentoId: null,
    }
    try { await svcAddFixed(newFixed) } catch (e) { console.error(e) }
    setCosts(prev => ({ ...prev, fixos: [...prev.fixos, newFixed] }))
    setNewFixedForm({ descricao: '', valor: '' })
    setAddingFixed(false)
  }

  // Variable costs CRUD
  function startEditVar(c: VariableCost) {
    setEditingVarId(c.id)
    setEditVarForm({ descricao: c.descricao, valor: String(c.valor), data: c.data.slice(0, 7) })
  }

  async function saveEditVar(id: string) {
    const patch = { descricao: editVarForm.descricao, valor: parseFloat(editVarForm.valor) || 0, data: `${editVarForm.data}-01` }
    try { await svcUpdateVar(id, patch) } catch (e) { console.error(e) }
    setCosts(prev => ({ ...prev, variaveis: prev.variaveis.map(c => c.id === id ? { ...c, ...patch } : c) }))
    setEditingVarId(null)
  }

  async function deleteVar(id: string) {
    try { await svcDeleteVar(id) } catch (e) { console.error(e) }
    setCosts(prev => ({ ...prev, variaveis: prev.variaveis.filter(c => c.id !== id) }))
  }

  async function handleAddVar(e: React.FormEvent) {
    e.preventDefault()
    const newVar: VariableCost = {
      id: `cv_${Date.now()}`,
      descricao: varForm.descricao,
      valor: parseFloat(varForm.valor),
      data: `${varForm.data}-01`,
      projetoId: selectedProject === 'all' ? null : selectedProject,
      fechamentoId: null,
    }
    try { await svcAddVar(newVar) } catch (e) { console.error(e) }
    setCosts(prev => ({ ...prev, variaveis: [...prev.variaveis, newVar] }))
    setVarForm({ descricao: '', valor: '', data: '' })
    setShowVarModal(false)
  }

  const metaPresets: Record<PeriodFilter, string> = {
    today: 'today', yesterday: 'yesterday', week: 'last_7d', month: 'this_month', custom: 'custom',
  }

  const periodLabels: Record<PeriodFilter, string> = {
    today: 'Hoje', yesterday: 'Ontem', week: 'Esta semana', month: 'Este mês', custom: 'Personalizado',
  }

  const bestTimesAStart = periodBounds?.start ?? `${monthStr}-01`
  const bestTimesAEnd = periodBounds?.end ?? todayStr

  const metaProjId = selectedProject === 'all' ? 'proj_1' : selectedProject

  return (
    <div className="min-h-screen bg-gray-950">
      <Header />
      <main className="max-w-screen-xl mx-auto px-4 py-6 pb-20 md:pb-6">

        {/* Tab switcher */}
        <div className="flex items-center gap-1 bg-gray-900 border border-white/10 rounded-xl p-1 mb-6 w-fit">
          {([
            { key: 'visao_geral', label: 'Visão Geral' },
            { key: 'melhores_horarios', label: 'Melhores dias e horários' },
          ] as const).map(tab => (
            <button
              key={tab.key}
              onClick={() => setDashTab(tab.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                dashTab === tab.key ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {dashTab === 'melhores_horarios' && (
          <BestTimesComparison
            allSales={sales.filter(s => selectedProject === 'all' || s.projetoId === selectedProject)}
            defaultAStart={bestTimesAStart}
            defaultAEnd={bestTimesAEnd}
          />
        )}

        {dashTab === 'visao_geral' && <>

        {/* Period filter */}
        <div className="flex flex-wrap items-center gap-2 mb-6">
          <span className="text-xs text-gray-500">Período:</span>
          {(['today', 'yesterday', 'week', 'month', 'custom'] as PeriodFilter[]).map(p => (
            <button
              key={p}
              onClick={() => { setPeriod(p); setMetaDatePreset(metaPresets[p]); setMetaPeriodKey(p + '_' + Date.now()) }}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                period === p ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {periodLabels[p]}
            </button>
          ))}
          {period === 'custom' && (
            <div className="flex items-center gap-2">
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                className="bg-gray-800 border border-white/10 text-xs text-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:border-indigo-500" />
              <span className="text-gray-600 text-xs">até</span>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                className="bg-gray-800 border border-white/10 text-xs text-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:border-indigo-500" />
            </div>
          )}
        </div>

        {/* Metric cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">

          {/* Faturamento bruto */}
          <div className="bg-gray-900 rounded-xl border border-white/10 p-4">
            <div className="flex items-start justify-between mb-3">
              <p className="text-xs text-gray-400 font-medium">Faturamento Bruto</p>
              <DollarSign className="w-4 h-4 text-gray-500" />
            </div>
            <p className="text-2xl font-bold text-white">{formatCurrency(faturamentoBruto)}</p>
            <p className="text-xs text-gray-500 mt-1">{salesLoading ? 'Carregando...' : `${periodSales.length} vendas`}</p>
          </div>

          {/* Faturamento líquido */}
          <div className="bg-gray-900 rounded-xl border border-emerald-500/30 p-4">
            <div className="flex items-start justify-between mb-3">
              <p className="text-xs text-gray-400 font-medium">Faturamento Líquido</p>
              <TrendingUp className="w-4 h-4 text-gray-500" />
            </div>
            <p className="text-2xl font-bold text-white">{formatCurrency(faturamentoLiquido)}</p>
            <p className="text-xs text-gray-500 mt-1">Após taxas da plataforma</p>
          </div>

          {/* Meta Ads — componente autônomo, busca ao montar e ao mudar período */}
          <MetaAdsCard
            datePreset={metaDatePreset}
            customDateStart={customStart}
            customDateEnd={customEnd}
            projectId={metaProjId}
            onTotalChange={setMetaAdsTotal}
            periodKey={metaPeriodKey}
          />

          {/* ROAS */}
          <div className={`bg-gray-900 rounded-xl border p-4 ${
            roas === null ? 'border-white/10' : roas >= 1 ? 'border-emerald-500/30' : 'border-red-500/30'
          }`}>
            <div className="flex items-start justify-between mb-3">
              <p className="text-xs text-gray-400 font-medium">ROAS</p>
              {roas !== null && (roas >= 1
                ? <TrendingUp className="w-4 h-4 text-gray-500" />
                : <TrendingDown className="w-4 h-4 text-gray-500" />
              )}
            </div>
            <p className={`text-2xl font-bold ${
              roas === null ? 'text-gray-500' : roas >= 1 ? 'text-green-500' : 'text-red-500'
            }`}>
              {roas === null ? '—' : roas >= 1 ? `${roas.toFixed(2)}x` : `-${roas.toFixed(2)}x`}
            </p>
            <p className="text-xs text-gray-500 mt-1">Líquido ÷ Meta Ads</p>
          </div>

        </div>

        {/* Faturamento detail */}
        <div className="bg-gray-900 rounded-xl border border-white/10 mb-6">
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <h3 className="text-sm font-semibold text-white">Detalhamento do Faturamento</h3>
            <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-0.5">
              {(['produto', 'plataforma'] as const).map(t => (
                <button key={t} onClick={() => setFaturamentoToggle(t)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    faturamentoToggle === t ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'
                  }`}>
                  Por {t === 'produto' ? 'Produto' : 'Plataforma'}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            {faturamentoToggle === 'produto' ? (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/5 bg-gray-800/30">
                    <th className="text-left px-4 py-2.5 text-gray-500 font-medium">Produto</th>
                    <th className="text-left px-4 py-2.5 text-gray-500 font-medium">Plataforma</th>
                    <th className="text-right px-4 py-2.5 text-gray-500 font-medium">Qtd</th>
                    <th className="text-right px-4 py-2.5 text-gray-500 font-medium">Fat. Bruto</th>
                    <th className="text-right px-4 py-2.5 text-gray-500 font-medium">Alíquota</th>
                    <th className="text-right px-4 py-2.5 text-gray-500 font-medium">Imposto</th>
                    <th className="text-right px-4 py-2.5 text-gray-500 font-medium">Fat. Líq. Plataforma</th>
                    <th className="text-right px-4 py-2.5 text-gray-500 font-medium">Líquido Pós-Impostos</th>
                  </tr>
                </thead>
                <tbody>
                  {byProduct.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-8 text-gray-600">Nenhuma venda no período</td></tr>
                  ) : byProduct.map((row, i) => (
                    <tr key={i} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                      <td className="px-4 py-3 text-gray-200 font-medium">{row.produto}</td>
                      <td className="px-4 py-3"><PlatformBadge platform={row.plataforma} /></td>
                      <td className="px-4 py-3 text-right text-gray-300">{row.qtd}</td>
                      <td className="px-4 py-3 text-right text-gray-300">{formatCurrency(row.bruto)}</td>
                      <td className="px-4 py-3 text-right text-amber-400">{row.aliquota}%</td>
                      <td className="px-4 py-3 text-right text-red-400">-{formatCurrency(row.imposto)}</td>
                      <td className="px-4 py-3 text-right text-emerald-400 font-semibold">{formatCurrency(row.liquido)}</td>
                      <td className="px-4 py-3 text-right font-semibold" style={{ color: '#22c55e' }}>{formatCurrency(row.liquido_pos_impostos)}</td>
                    </tr>
                  ))}
                </tbody>
                {byProduct.length > 1 && (
                  <tfoot>
                    <tr className="border-t border-white/10 bg-gray-800/20">
                      <td className="px-4 py-3 text-gray-300 font-semibold" colSpan={2}>Total</td>
                      <td className="px-4 py-3 text-right text-gray-300 font-semibold">{byProduct.reduce((a, r) => a + r.qtd, 0)}</td>
                      <td className="px-4 py-3 text-right text-gray-300 font-semibold">{formatCurrency(byProduct.reduce((a, r) => a + r.bruto, 0))}</td>
                      <td />
                      <td className="px-4 py-3 text-right text-red-400 font-semibold">-{formatCurrency(byProduct.reduce((a, r) => a + r.imposto, 0))}</td>
                      <td className="px-4 py-3 text-right text-emerald-400 font-semibold">{formatCurrency(byProduct.reduce((a, r) => a + r.liquido, 0))}</td>
                      <td className="px-4 py-3 text-right font-semibold" style={{ color: '#22c55e' }}>{formatCurrency(byProduct.reduce((a, r) => a + r.liquido_pos_impostos, 0))}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/5 bg-gray-800/30">
                    <th className="text-left px-4 py-2.5 text-gray-500 font-medium">Plataforma</th>
                    <th className="text-right px-4 py-2.5 text-gray-500 font-medium">Qtd Vendas</th>
                    <th className="text-right px-4 py-2.5 text-gray-500 font-medium">Fat. Bruto</th>
                    <th className="text-right px-4 py-2.5 text-gray-500 font-medium">Fat. Líquido</th>
                    <th className="text-right px-4 py-2.5 text-gray-500 font-medium">% do total</th>
                  </tr>
                </thead>
                <tbody>
                  {byPlatform.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-8 text-gray-600">Nenhuma venda no período</td></tr>
                  ) : byPlatform.map((row, i) => (
                    <tr key={i} className="border-b border-white/5 hover:bg-white/2">
                      <td className="px-4 py-3"><PlatformBadge platform={row.plataforma} /></td>
                      <td className="px-4 py-3 text-right text-gray-300">{row.qtd}</td>
                      <td className="px-4 py-3 text-right text-gray-300">{formatCurrency(row.bruto)}</td>
                      <td className="px-4 py-3 text-right text-emerald-400 font-semibold">{formatCurrency(row.liquido)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-gray-400">{row.pct.toFixed(1)}%</span>
                        <div className="w-16 h-1 bg-gray-800 rounded-full mt-1 ml-auto">
                          <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${row.pct}%` }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Custos — mês de referência (compartilhado entre Fixos e Variáveis) */}
        <div className="flex items-center gap-2 mb-3">
          <label className="text-xs text-gray-400">Mês de referência dos custos:</label>
          <input type="month" value={custosMesRef} onChange={e => setCustosMesRef(e.target.value)}
            className="bg-gray-800 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500/50" />
        </div>

        {/* Costs */}
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          {/* Fixed costs */}
          <div className="bg-gray-900 rounded-xl border border-white/10 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Custos Fixos</h3>
              {canEdit && (
                <button onClick={() => setAddingFixed(true)}
                  className="flex items-center gap-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-2.5 py-1 rounded-lg transition-colors">
                  <Plus className="w-3 h-3" /> Adicionar
                </button>
              )}
            </div>
            <div className="space-y-2">
              {fixedCostsFiltered.length === 0 && !addingFixed && (
                <p className="text-xs text-gray-600">Nenhum custo fixo lançado neste mês</p>
              )}
              {fixedCostsFiltered.map(c => (
                <div key={c.id} className="group">
                  {editingFixedId === c.id ? (
                    <div className="flex items-center gap-2">
                      <input value={editFixedForm.descricao}
                        onChange={e => setEditFixedForm(p => ({ ...p, descricao: e.target.value }))}
                        className="flex-1 bg-gray-800 border border-indigo-500 rounded px-2 py-1 text-xs text-white focus:outline-none"
                      />
                      <input type="number" step="0.01" value={editFixedForm.valor}
                        onChange={e => setEditFixedForm(p => ({ ...p, valor: e.target.value }))}
                        className="w-24 bg-gray-800 border border-indigo-500 rounded px-2 py-1 text-xs text-white text-right focus:outline-none"
                      />
                      <input type="month" value={editFixedForm.data}
                        onChange={e => setEditFixedForm(p => ({ ...p, data: e.target.value }))}
                        className="bg-gray-800 border border-indigo-500 rounded px-2 py-1 text-xs text-white focus:outline-none"
                      />
                      <button onClick={() => saveEditFixed(c.id)} className="text-emerald-400 hover:text-emerald-300">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setEditingFixedId(null)} className="text-gray-500 hover:text-gray-300">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-400 flex-1">{c.descricao}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-200 font-medium">{formatCurrency(c.valor)}</span>
                        {canEdit && (
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => startEditFixed(c)} className="text-gray-600 hover:text-gray-300">
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button onClick={() => deleteFixed(c.id)} className="text-gray-600 hover:text-red-400">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {addingFixed && (
                <form onSubmit={handleAddFixed} className="flex items-center gap-2 pt-1">
                  <input required value={newFixedForm.descricao} placeholder="Descrição"
                    onChange={e => setNewFixedForm(p => ({ ...p, descricao: e.target.value }))}
                    className="flex-1 bg-gray-800 border border-indigo-500 rounded px-2 py-1 text-xs text-white focus:outline-none placeholder-gray-600"
                  />
                  <input required type="number" step="0.01" value={newFixedForm.valor} placeholder="R$"
                    onChange={e => setNewFixedForm(p => ({ ...p, valor: e.target.value }))}
                    className="w-24 bg-gray-800 border border-indigo-500 rounded px-2 py-1 text-xs text-white text-right focus:outline-none placeholder-gray-600"
                  />
                  <button type="submit" className="text-emerald-400 hover:text-emerald-300">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => setAddingFixed(false)} className="text-gray-500 hover:text-gray-300">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </form>
              )}

              <div className="border-t border-white/10 pt-2 flex items-center justify-between text-xs font-semibold">
                <span className="text-gray-300">Total</span>
                <span className="text-red-400">{formatCurrency(fixedCostsTotal)}</span>
              </div>
            </div>
          </div>

          {/* Variable costs */}
          <div className="bg-gray-900 rounded-xl border border-white/10 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Custos Variáveis</h3>
              {canEdit && (
                <button onClick={() => { setVarForm({ descricao: '', valor: '', data: custosMesRef }); setShowVarModal(true) }}
                  className="flex items-center gap-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-2.5 py-1 rounded-lg transition-colors">
                  <Plus className="w-3 h-3" /> Lançar
                </button>
              )}
            </div>
            <div className="space-y-2">
              {varCostsFiltered.length === 0 ? (
                <p className="text-xs text-gray-600">Nenhum custo variável lançado neste mês</p>
              ) : varCostsFiltered.map(c => (
                <div key={c.id} className="group">
                  {editingVarId === c.id ? (
                    <div className="space-y-1.5">
                      <div className="flex gap-2">
                        <input value={editVarForm.descricao}
                          onChange={e => setEditVarForm(p => ({ ...p, descricao: e.target.value }))}
                          className="flex-1 bg-gray-800 border border-indigo-500 rounded px-2 py-1 text-xs text-white focus:outline-none"
                        />
                        <input type="number" step="0.01" value={editVarForm.valor}
                          onChange={e => setEditVarForm(p => ({ ...p, valor: e.target.value }))}
                          className="w-24 bg-gray-800 border border-indigo-500 rounded px-2 py-1 text-xs text-white text-right focus:outline-none"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <input type="month" value={editVarForm.data}
                          onChange={e => setEditVarForm(p => ({ ...p, data: e.target.value }))}
                          className="bg-gray-800 border border-indigo-500 rounded px-2 py-1 text-xs text-white focus:outline-none"
                        />
                        <button onClick={() => saveEditVar(c.id)} className="text-emerald-400 hover:text-emerald-300">
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setEditingVarId(null)} className="text-gray-500 hover:text-gray-300">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between text-xs">
                      <div>
                        <span className="text-gray-400">{c.descricao}</span>
                        <span className="text-gray-600 ml-2">{formatDate(c.data)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-200 font-medium">{formatCurrency(c.valor)}</span>
                        {canEdit && (
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => startEditVar(c)} className="text-gray-600 hover:text-gray-300">
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button onClick={() => deleteVar(c.id)} className="text-gray-600 hover:text-red-400">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {varCostsFiltered.length > 0 && (
                <div className="border-t border-white/10 pt-2 flex items-center justify-between text-xs font-semibold">
                  <span className="text-gray-300">Total</span>
                  <span className="text-red-400">{formatCurrency(varCostsTotal)}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Balanço */}
        <div className="bg-gray-900 rounded-xl border border-white/10">
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <h3 className="text-sm font-semibold text-white">Balanço Financeiro</h3>
            <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-0.5">
              {(['completo', 'sem_fixos'] as const).map(t => (
                <button key={t} onClick={() => setBalancoToggle(t)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    balancoToggle === t ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'
                  }`}>
                  {t === 'completo' ? 'Completo' : 'Sem custos fixos'}
                </button>
              ))}
            </div>
          </div>
          <div className="p-4 space-y-2.5 text-sm">
            <BalancoRow label="Faturamento bruto" value={faturamentoBruto} plus />
            <BalancoRow label="(-) Impostos por produto" value={impostoTotal} negative />
            <BalancoRow label="(-) Investimento Meta Ads" value={metaAdsTotal} negative />
            {balancoToggle === 'completo' && (
              <BalancoRow label="(-) Custos fixos" value={fixedCostsTotal} negative />
            )}
            <BalancoRow label="(-) Custos variáveis" value={varCostsTotal} negative />
            <div className="border-t-2 border-white/10 pt-2.5">
              <BalancoRow
                label="= Resultado"
                value={balancoToggle === 'completo' ? resultadoCompleto : resultadoSemFixos}
                bold result
              />
            </div>
          </div>
        </div>
        </>}
      </main>
      <MobileNav />

      {/* Modal variável */}
      <Modal open={showVarModal} onClose={() => setShowVarModal(false)} title="Lançar Custo Variável" size="sm">
        <form onSubmit={handleAddVar} className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Descrição</label>
            <input required value={varForm.descricao}
              onChange={e => setVarForm(p => ({ ...p, descricao: e.target.value }))}
              className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Valor (R$)</label>
            <input required type="number" step="0.01" min="0" value={varForm.valor}
              onChange={e => setVarForm(p => ({ ...p, valor: e.target.value }))}
              className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Mês de referência</label>
            <input required type="month" value={varForm.data}
              onChange={e => setVarForm(p => ({ ...p, data: e.target.value }))}
              className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={() => setShowVarModal(false)}
              className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm py-2 rounded-lg transition-colors">
              Cancelar
            </button>
            <button type="submit"
              className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-sm py-2 rounded-lg transition-colors">
              Salvar
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

function BalancoRow({ label, value, negative, plus, bold, result }: {
  label: string; value: number; negative?: boolean; plus?: boolean; bold?: boolean; result?: boolean
}) {
  const isNeg = value < 0
  const color = result
    ? isNeg ? 'text-red-400' : 'text-emerald-400'
    : negative ? 'text-red-400' : plus ? 'text-emerald-400' : 'text-gray-200'

  const displayVal = negative ? `-${formatCurrency(value)}` : formatCurrency(value)

  return (
    <div className={`flex items-center justify-between ${bold ? 'font-bold text-base' : 'text-sm'}`}>
      <span className={bold ? 'text-white' : 'text-gray-400'}>{label}</span>
      <span className={color}>{displayVal}</span>
    </div>
  )
}
