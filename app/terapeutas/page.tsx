'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Users, CheckCircle, Clock, DollarSign, TrendingUp,
  BarChart2, Award, Calendar, CalendarDays,
} from 'lucide-react'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'

// ─── Types ─────────────────────────────────────────────────────────────────
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

type PorTerapeuta = {
  id: string
  nome: string
  sessoes_vendidas: number
  sessoes_entregues: number
  sessoes_futuras: number
  faturamento_bruto: number
  comissao_gerada: number
  comissao_futura: number
  proxima_consulta: string | null
}

type ConsultaHoje = {
  id: string
  horario: string
  paciente_nome: string
  terapeuta_nome: string
  link_meet: string | null
  status: string
  status_consulta: string
}

const STATUS_CONSULTA_BADGE: Record<string, { label: string; cls: string }> = {
  aguardando:     { label: 'Aguardando',    cls: 'text-amber-400 bg-amber-400/10' },
  em_atendimento: { label: 'Em atendimento', cls: 'text-blue-400 bg-blue-400/10 animate-pulse' },
  concluida:      { label: 'Concluída',     cls: 'text-green-500 bg-green-500/10' },
  cancelada:      { label: 'Cancelada',     cls: 'text-red-400 bg-red-400/10' },
  remarcada:      { label: 'Remarcada',     cls: 'text-purple-400 bg-purple-400/10' },
}

type TerapeutaFiltro = { id: string; nome: string }

// ─── Formatação ─────────────────────────────────────────────────────────────
function fmtBRL(n: number) {
  return 'R$ ' + new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}
function fmtDt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}

const PRESET_LABELS: Record<Preset, string> = {
  today: 'Hoje',
  yesterday: 'Ontem',
  last_7d: '7 dias',
  this_month: 'Este mês',
  custom: 'Personalizado',
}

const METRICAS_VAZIA: Metricas = {
  sessoes_vendidas: 0, sessoes_entregues: 0, sessoes_futuras: 0,
  faturamento_bruto: 0, faturamento_liquido_spr: 0, total_impostos: 0,
  ticket_medio: 0, comissao_gerada: 0, comissao_futura: 0,
  faturamento_liquido_terapeutas: 0,
}

// ─── Componente ──────────────────────────────────────────────────────────────
export default function TerapeutasDashboard() {
  const [preset, setPreset] = useState<Preset>('this_month')
  const [dateStart, setDateStart] = useState('')
  const [dateEnd, setDateEnd] = useState('')
  const [terapeutaId, setTerapeutaId] = useState('all')

  const [metricas, setMetricas] = useState<Metricas>(METRICAS_VAZIA)
  const [porTerapeuta, setPorTerapeuta] = useState<PorTerapeuta[]>([])
  const [consultasHoje, setConsultasHoje] = useState<ConsultaHoje[]>([])
  const [terapeutasFiltro, setTerapeutasFiltro] = useState<TerapeutaFiltro[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')

  // Buscar lista de terapeutas para o filtro (uma vez)
  useEffect(() => {
    fetch('/api/terapeutas/admin/terapeutas')
      .then(r => r.json())
      .then(j => {
        const ativos = ((j.terapeutas ?? []) as { id: string; nome: string; ativo: boolean }[])
          .filter(t => t.ativo)
        setTerapeutasFiltro(ativos)
      })
      .catch(() => {})
  }, [])

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    setErro('')
    try {
      const params = new URLSearchParams({ datePreset: preset, terapeutaId })
      if (preset === 'custom') {
        if (dateStart) params.set('dateStart', dateStart + 'T03:00:00.000Z')
        if (dateEnd) params.set('dateEnd', dateEnd + 'T26:59:59.000Z') // fim do dia Brasília
      }
      const res = await fetch('/api/terapeutas/dashboard?' + params.toString())
      if (!res.ok) throw new Error(await res.text())
      const json = await res.json()
      setMetricas(json.metricas ?? METRICAS_VAZIA)
      setPorTerapeuta(json.por_terapeuta ?? [])
      setConsultasHoje(json.consultas_hoje ?? [])
    } catch (e) {
      setErro(String(e))
    } finally {
      setLoading(false)
    }
  }, [preset, dateStart, dateEnd, terapeutaId])

  useEffect(() => {
    if (preset === 'custom' && (!dateStart || !dateEnd)) return
    loadDashboard()
  }, [loadDashboard, preset, dateStart, dateEnd, terapeutaId])

  // Auto-refresh consultas de hoje a cada 60 segundos
  useEffect(() => {
    const interval = setInterval(() => {
      fetch(`/api/terapeutas/dashboard?datePreset=${preset}&terapeutaId=${terapeutaId}`)
        .then(r => r.ok ? r.json() : null)
        .then(json => { if (json?.consultas_hoje) setConsultasHoje(json.consultas_hoje) })
        .catch(() => {})
    }, 60000)
    return () => clearInterval(interval)
  }, [preset, terapeutaId])

  // ── Cards ──
  const cards = [
    {
      label: 'Sessões vendidas',
      sub: 'Total de sessões contratadas',
      value: metricas.sessoes_vendidas,
      icon: Users,
      color: 'text-white',
    },
    {
      label: 'Sessões entregues',
      sub: 'Confirmadas pelos terapeutas',
      value: metricas.sessoes_entregues,
      icon: CheckCircle,
      color: 'text-green-500',
    },
    {
      label: 'Sessões futuras',
      sub: 'Agendadas e pendentes',
      value: metricas.sessoes_futuras,
      icon: Clock,
      color: 'text-yellow-400',
    },
    {
      label: 'Faturamento bruto',
      sub: '100% do valor pago pelos clientes',
      value: fmtBRL(metricas.faturamento_bruto),
      icon: DollarSign,
      color: 'text-white',
    },
    {
      label: 'Faturamento líquido SPR (70%)',
      sub: 'Após taxas e impostos — parte SPR',
      value: fmtBRL(metricas.faturamento_liquido_spr),
      icon: TrendingUp,
      color: 'text-green-500',
    },
    {
      label: 'Total de impostos',
      sub: '12,85% sobre faturamento bruto',
      value: fmtBRL(metricas.total_impostos),
      icon: BarChart2,
      color: 'text-red-400',
    },
    {
      label: 'Ticket médio',
      sub: 'Valor médio por venda',
      value: metricas.faturamento_bruto > 0 ? fmtBRL(metricas.ticket_medio) : '—',
      icon: BarChart2,
      color: 'text-white',
    },
    {
      label: 'Comissão gerada',
      sub: 'Sessões entregues — a pagar',
      value: fmtBRL(metricas.comissao_gerada),
      icon: Award,
      color: 'text-yellow-400',
    },
    {
      label: 'Comissão futura',
      sub: 'Baseado nas sessões futuras',
      value: fmtBRL(metricas.comissao_futura),
      icon: CalendarDays,
      color: 'text-gray-400',
    },
    {
      label: 'Líquido terapeutas (30%)',
      sub: 'Parte dos terapeutas após taxas e impostos',
      value: fmtBRL(metricas.faturamento_liquido_terapeutas),
      icon: Users,
      color: 'text-blue-400',
    },
  ]

  return (
    <div className="min-h-screen bg-gray-950 pb-24 md:pb-8">
      <Header />
      <main className="max-w-7xl mx-auto px-4 py-6">

        {/* Cabeçalho + filtros */}
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-white">Atendimentos · Terapeutas</h1>
          <p className="text-sm text-gray-400 mt-1">Visão geral de todos os atendimentos</p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {/* Filtro período */}
            <div className="flex items-center gap-1 flex-wrap">
              {(Object.keys(PRESET_LABELS) as Preset[]).map(p => (
                <button
                  key={p}
                  onClick={() => setPreset(p)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    preset === p
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:text-white border border-white/10'
                  }`}
                >
                  {PRESET_LABELS[p]}
                </button>
              ))}
            </div>

            {/* Datas personalizadas */}
            {preset === 'custom' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">De:</span>
                <input type="date" value={dateStart} onChange={e => setDateStart(e.target.value)}
                  className="bg-gray-800 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500/50" />
                <span className="text-xs text-gray-500">Até:</span>
                <input type="date" value={dateEnd} onChange={e => setDateEnd(e.target.value)}
                  className="bg-gray-800 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500/50" />
              </div>
            )}

            {/* Filtro terapeuta */}
            <select
              value={terapeutaId}
              onChange={e => setTerapeutaId(e.target.value)}
              className="bg-gray-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500/50"
            >
              <option value="all">Todos os terapeutas</option>
              {terapeutasFiltro.map(t => (
                <option key={t.id} value={t.id}>{t.nome}</option>
              ))}
            </select>
          </div>
        </div>

        {erro && (
          <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400">
            Erro ao carregar dados: {erro}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* 10 cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {cards.map(({ label, sub, value, icon: Icon, color }) => (
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

            {/* Tabela performance por terapeuta (somente quando filtro = todos) */}
            {terapeutaId === 'all' && (
              <div className="bg-gray-900 border border-white/10 rounded-xl mb-6">
                <div className="p-4 border-b border-white/10">
                  <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Users className="w-4 h-4 text-indigo-400" /> Performance por Terapeuta
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/5">
                        {['Nome', 'Vendidas', 'Entregues', 'Futuras', 'Fat. bruto', 'Comissão gerada', 'Comissão futura', 'Próxima consulta'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-medium whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {porTerapeuta.length === 0 ? (
                        <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-600 text-xs">Sem dados no período selecionado</td></tr>
                      ) : porTerapeuta.map(t => (
                        <tr key={t.id} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                          <td className="px-4 py-3 text-white font-medium whitespace-nowrap">{t.nome}</td>
                          <td className="px-4 py-3 text-gray-300">{t.sessoes_vendidas}</td>
                          <td className="px-4 py-3 text-green-500">{t.sessoes_entregues}</td>
                          <td className="px-4 py-3 text-yellow-400">{t.sessoes_futuras}</td>
                          <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{fmtBRL(t.faturamento_bruto)}</td>
                          <td className="px-4 py-3 text-yellow-400 whitespace-nowrap">{fmtBRL(t.comissao_gerada)}</td>
                          <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{fmtBRL(t.comissao_futura)}</td>
                          <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{fmtDt(t.proxima_consulta)}</td>
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
                  Consultas de Hoje ({consultasHoje.length})
                </h2>
                <span className="text-[10px] text-gray-600">Atualiza a cada 60s</span>
              </div>
              {consultasHoje.length === 0 ? (
                <p className="px-4 py-6 text-center text-gray-600 text-xs">Nenhuma consulta agendada para hoje</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/5">
                        {['Horário', 'Paciente', 'Terapeuta', 'Status Consulta'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {consultasHoje.map(s => {
                        const scBadge = STATUS_CONSULTA_BADGE[s.status_consulta] ?? STATUS_CONSULTA_BADGE.aguardando
                        return (
                          <tr key={s.id} className="border-b border-white/5 hover:bg-white/2">
                            <td className="px-4 py-3 text-indigo-400 font-medium">{s.horario}</td>
                            <td className="px-4 py-3 text-white">{s.paciente_nome}</td>
                            <td className="px-4 py-3 text-gray-300">{s.terapeuta_nome}</td>
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
      </main>
      <MobileNav />
    </div>
  )
}
