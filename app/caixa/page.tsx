'use client'

import { useState, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'
import { Plus, ArrowUpRight, ArrowDownRight, Wallet, Clock } from 'lucide-react'
import { useApp } from '@/contexts/AppContext'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import MetricCard from '@/components/MetricCard'
import Modal from '@/components/Modal'
import ProtectedRoute from '@/components/ProtectedRoute'
import { formatCurrency, formatDate, getMonthLabel } from '@/lib/formatters'
import { addCashflowEntry as svcAddCashflow } from '@/lib/services'
import { CashflowType } from '@/types'

type CashTab = 'extrato' | 'entradas' | 'saidas'

const TYPE_CONFIG: Record<CashflowType, { label: string; colorClass: string; bg: string }> = {
  entrada_manual: { label: 'Entrada manual', colorClass: 'text-emerald-400', bg: 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400' },
  entrada_automatica: { label: 'Entrada automática', colorClass: 'text-purple-400', bg: 'bg-purple-500/20 border-purple-500/30 text-purple-400' },
  saida_reembolso: { label: 'Saída por reembolso', colorClass: 'text-red-400', bg: 'bg-red-500/20 border-red-500/30 text-red-400' },
  saida_manual: { label: 'Saída manual', colorClass: 'text-amber-400', bg: 'bg-amber-500/20 border-amber-500/30 text-amber-400' },
}

export default function CaixaPage() {
  return (
    <ProtectedRoute>
      <CaixaContent />
    </ProtectedRoute>
  )
}

function CaixaContent() {
  const { cashflow, setCashflow, user } = useApp()
  const [tab, setTab] = useState<CashTab>('extrato')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ tipo: 'entrada_manual' as CashflowType, descricao: '', valor: '', data: '' })

  const canEdit = user?.role === 'admin'

  const totalEntradas = useMemo(
    () => cashflow.filter(c => c.tipo.startsWith('entrada')).reduce((a, c) => a + c.valor, 0),
    [cashflow]
  )
  const totalSaidas = useMemo(
    () => cashflow.filter(c => c.tipo.startsWith('saida')).reduce((a, c) => a + c.valor, 0),
    [cashflow]
  )
  const saldoAtual = totalEntradas - totalSaidas
  const ultimaMov = cashflow.length > 0 ? cashflow[cashflow.length - 1] : null

  const filtered = useMemo(() => {
    if (tab === 'entradas') return cashflow.filter(c => c.tipo.startsWith('entrada'))
    if (tab === 'saidas') return cashflow.filter(c => c.tipo.startsWith('saida'))
    return cashflow
  }, [cashflow, tab])

  // Monthly chart data
  const chartData = useMemo(() => {
    const map: Record<string, { entradas: number; saidas: number }> = {}
    for (const entry of cashflow) {
      const month = entry.data.slice(0, 7)
      if (!map[month]) map[month] = { entradas: 0, saidas: 0 }
      if (entry.tipo.startsWith('entrada')) map[month].entradas += entry.valor
      else map[month].saidas += entry.valor
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ name: getMonthLabel(month), ...v }))
  }, [cashflow])

  const { selectedProject } = useApp()

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const lastBalance = cashflow.length > 0 ? cashflow[cashflow.length - 1].saldoAcumulado : 0
    const val = parseFloat(form.valor)
    const isEntrada = form.tipo.startsWith('entrada')
    const newEntry = {
      id: `cf_${Date.now()}`,
      data: form.data,
      descricao: form.descricao,
      origem: 'Manual',
      tipo: form.tipo,
      valor: val,
      saldoAcumulado: isEntrada ? lastBalance + val : lastBalance - val,
    }
    try { await svcAddCashflow(newEntry, selectedProject) } catch (e) { console.error(e) }
    setCashflow(prev => [...prev, newEntry])
    setForm({ tipo: 'entrada_manual', descricao: '', valor: '', data: '' })
    setShowModal(false)
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <Header />
      <main className="max-w-screen-xl mx-auto px-4 py-6 pb-20 md:pb-6">

        {/* Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <MetricCard title="Total Entradas" value={formatCurrency(totalEntradas)} color="green" icon={<ArrowUpRight className="w-4 h-4" />} />
          <MetricCard title="Total Saídas" value={formatCurrency(totalSaidas)} color="red" icon={<ArrowDownRight className="w-4 h-4" />} />
          <MetricCard
            title="Saldo Atual"
            value={formatCurrency(saldoAtual)}
            color={saldoAtual >= 0 ? 'green' : 'red'}
            icon={<Wallet className="w-4 h-4" />}
          />
          <MetricCard
            title="Última Movimentação"
            value={ultimaMov ? formatCurrency(ultimaMov.valor) : '—'}
            subtitle={ultimaMov ? formatDate(ultimaMov.data) : undefined}
            color="default"
            icon={<Clock className="w-4 h-4" />}
          />
        </div>

        {/* Chart */}
        {chartData.length > 0 && (
          <div className="bg-gray-900 rounded-xl border border-white/10 p-4 mb-6">
            <h3 className="text-sm font-semibold text-white mb-4">Movimentações Mensais</h3>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#9ca3af' }}
                    formatter={(value) => formatCurrency(Number(value))}
                  />
                  <Legend formatter={(val) => val === 'entradas' ? 'Entradas' : 'Saídas'} wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="entradas" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="saidas" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Tabs + button */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
            {(['extrato', 'entradas', 'saidas'] as CashTab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  tab === t ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                {t === 'extrato' ? 'Extrato completo' : t === 'entradas' ? 'Entradas' : 'Saídas'}
              </button>
            ))}
          </div>
          {canEdit && (
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3 py-2 rounded-lg transition-colors font-medium"
            >
              <Plus className="w-3.5 h-3.5" /> Nova movimentação
            </button>
          )}
        </div>

        {/* Table */}
        <div className="bg-gray-900 rounded-xl border border-white/10 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10 bg-gray-800/50">
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Data</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Descrição</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium hidden md:table-cell">Origem</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Tipo</th>
                  <th className="text-right px-4 py-3 text-gray-500 font-medium">Valor</th>
                  <th className="text-right px-4 py-3 text-gray-500 font-medium hidden lg:table-cell">Saldo Acumulado</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-gray-600">
                      Nenhuma movimentação
                    </td>
                  </tr>
                ) : [...filtered].reverse().map(entry => {
                  const cfg = TYPE_CONFIG[entry.tipo]
                  const isEntrada = entry.tipo.startsWith('entrada')
                  return (
                    <tr key={entry.id} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                      <td className="px-4 py-3 text-gray-400">{formatDate(entry.data)}</td>
                      <td className="px-4 py-3 text-gray-200 font-medium">{entry.descricao}</td>
                      <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{entry.origem}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cfg.bg}`}>
                          {cfg.label}
                        </span>
                      </td>
                      <td className={`px-4 py-3 text-right font-semibold ${isEntrada ? 'text-emerald-400' : 'text-red-400'}`}>
                        {isEntrada ? '+' : '-'}{formatCurrency(entry.valor)}
                      </td>
                      <td className={`px-4 py-3 text-right hidden lg:table-cell ${entry.saldoAcumulado >= 0 ? 'text-gray-300' : 'text-red-400'}`}>
                        {formatCurrency(entry.saldoAcumulado)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </main>
      <MobileNav />

      {/* Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Nova Movimentação" size="sm">
        <form onSubmit={handleAdd} className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Tipo</label>
            <select
              value={form.tipo}
              onChange={e => setForm(p => ({ ...p, tipo: e.target.value as CashflowType }))}
              className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
            >
              <option value="entrada_manual">Entrada manual</option>
              <option value="saida_manual">Saída manual</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Descrição</label>
            <input
              required value={form.descricao}
              onChange={e => setForm(p => ({ ...p, descricao: e.target.value }))}
              className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Valor (R$)</label>
            <input
              required type="number" step="0.01" min="0"
              value={form.valor}
              onChange={e => setForm(p => ({ ...p, valor: e.target.value }))}
              className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Data</label>
            <input
              required type="date"
              value={form.data}
              onChange={e => setForm(p => ({ ...p, data: e.target.value }))}
              className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={() => setShowModal(false)}
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
