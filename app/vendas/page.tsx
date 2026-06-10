'use client'

import { useState, useMemo } from 'react'
import { Search, Filter, Clock } from 'lucide-react'
import { useApp } from '@/contexts/AppContext'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import MetricCard from '@/components/MetricCard'
import PlatformBadge from '@/components/PlatformBadge'
import ProtectedRoute from '@/components/ProtectedRoute'
import { formatCurrency, formatDateTime, getSaleBruto, daysSincePurchase, diffDays, getDateFromDateTime } from '@/lib/formatters'

const WARRANTY_DAYS = 7

function WarrantyBadge({ dataHora }: { dataHora: string }) {
  const days = daysSincePurchase(dataHora)
  const remaining = WARRANTY_DAYS - days
  if (remaining > 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 whitespace-nowrap">
        <Clock className="w-2.5 h-2.5" /> No prazo ({remaining}d)
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-700/50 text-gray-500 border border-gray-700 whitespace-nowrap">
      Expirada
    </span>
  )
}

function AccessDaysBadge({ dataHora, dataReembolso }: { dataHora: string; dataReembolso: string }) {
  const days = diffDays(getDateFromDateTime(dataHora), dataReembolso)
  if (days === 0) return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/20 text-red-400 border border-red-500/30">
      Mesmo dia
    </span>
  )
  if (days <= 3) return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-orange-500/20 text-orange-400 border border-orange-500/30">
      {days} {days === 1 ? 'dia' : 'dias'}
    </span>
  )
  if (days <= 7) return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30">
      {days} dias
    </span>
  )
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-700/50 text-gray-500 border border-gray-700">
      {days} dias
    </span>
  )
}

export default function VendasPage() {
  return (
    <ProtectedRoute>
      <VendasContent />
    </ProtectedRoute>
  )
}

function VendasContent() {
  const { sales, products, selectedProject } = useApp()
  const [tab, setTab] = useState<'aprovadas' | 'reembolsos'>('aprovadas')
  const [search, setSearch] = useState('')
  const [filterProduct, setFilterProduct] = useState('')
  const [filterDate, setFilterDate] = useState('')

  const productMap = useMemo(() => Object.fromEntries(products.map(p => [p.id, p])), [products])

  const baseSales = useMemo(() => {
    let base = sales
    if (selectedProject !== 'all') base = base.filter(s => s.projetoId === selectedProject)
    return base
  }, [sales, selectedProject])

  const approved = useMemo(() => baseSales.filter(s => s.status === 'aprovado'), [baseSales])
  const refunds = useMemo(() => baseSales.filter(s => s.status === 'reembolso'), [baseSales])

  const filtered = useMemo(() => {
    let list = tab === 'aprovadas' ? approved : refunds
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(s => s.nome.toLowerCase().includes(q) || s.email.toLowerCase().includes(q))
    }
    if (filterProduct) list = list.filter(s => s.produto === filterProduct)
    if (filterDate) list = list.filter(s => s.data_hora.startsWith(filterDate))
    return [...list].sort((a, b) => b.data_hora.localeCompare(a.data_hora))
  }, [tab, approved, refunds, search, filterProduct, filterDate])

  // Approved metrics
  const totalApproved = approved.length
  const brutApproved = approved.reduce((a, s) => a + getSaleBruto(s), 0)
  const liqApproved = approved.reduce((a, s) => a + s.valor_liquido, 0)
  const ticketMedio = totalApproved > 0 ? brutApproved / totalApproved : 0

  // Refund metrics
  const totalRefunds = refunds.length
  const valueRefunds = refunds.reduce((a, s) => a + getSaleBruto(s), 0)
  const refundRate = (totalApproved + totalRefunds) > 0
    ? (totalRefunds / (totalApproved + totalRefunds)) * 100 : 0
  const refundImpact = refunds.reduce((a, s) => a + s.valor_liquido, 0)

  const availableProducts = useMemo(() => {
    const ids = new Set(baseSales.map(s => s.produto))
    return products.filter(p => ids.has(p.id))
  }, [baseSales, products])

  return (
    <div className="min-h-screen bg-gray-950">
      <Header />
      <main className="max-w-screen-xl mx-auto px-4 py-6 pb-20 md:pb-6">
        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <button onClick={() => setTab('aprovadas')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'aprovadas' ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
            }`}>
            Aprovadas
            <span className={`px-1.5 py-0.5 rounded-full text-xs ${tab === 'aprovadas' ? 'bg-white/20' : 'bg-emerald-600/30 text-emerald-400'}`}>
              {approved.length}
            </span>
          </button>
          <button onClick={() => setTab('reembolsos')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'reembolsos' ? 'bg-red-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
            }`}>
            Reembolsos
            <span className={`px-1.5 py-0.5 rounded-full text-xs ${tab === 'reembolsos' ? 'bg-white/20' : 'bg-red-600/30 text-red-400'}`}>
              {refunds.length}
            </span>
          </button>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {tab === 'aprovadas' ? (
            <>
              <MetricCard title="Total de Vendas" value={totalApproved.toString()} color="default" />
              <MetricCard title="Faturamento Bruto" value={formatCurrency(brutApproved)} color="green" />
              <MetricCard title="Faturamento Líquido" value={formatCurrency(liqApproved)} color="green" />
              <MetricCard title="Ticket Médio" value={formatCurrency(ticketMedio)} color="blue" />
            </>
          ) : (
            <>
              <MetricCard title="Total Reembolsos" value={totalRefunds.toString()} color="red" />
              <MetricCard title="Valor Reembolsado" value={formatCurrency(valueRefunds)} color="red" />
              <MetricCard title="Taxa de Reembolso" value={`${refundRate.toFixed(1)}%`} color="red" />
              <MetricCard title="Impacto no Líquido" value={formatCurrency(refundImpact)} color="red" />
            </>
          )}
        </div>

        {/* Filters — approved only */}
        {tab === 'aprovadas' && (
          <div className="flex flex-wrap gap-3 mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
              <input placeholder="Buscar por nome ou e-mail..."
                value={search} onChange={e => setSearch(e.target.value)}
                className="bg-gray-800 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500 w-64" />
            </div>
            <select value={filterProduct} onChange={e => setFilterProduct(e.target.value)}
              className="bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-300 focus:outline-none focus:border-indigo-500">
              <option value="">Todos os produtos</option>
              {availableProducts.map(p => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </select>
            <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)}
              className="bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-300 focus:outline-none focus:border-indigo-500" />
            {(search || filterProduct || filterDate) && (
              <button onClick={() => { setSearch(''); setFilterProduct(''); setFilterDate('') }}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded-lg transition-colors">
                <Filter className="w-3 h-3" /> Limpar
              </button>
            )}
          </div>
        )}

        {/* Table */}
        <div className="bg-gray-900 rounded-xl border border-white/10 overflow-hidden">
          <div className="overflow-x-auto">
            {tab === 'aprovadas' ? (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10 bg-gray-800/50">
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Nome</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium hidden md:table-cell">E-mail</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium hidden lg:table-cell">Telefone</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Produto</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium hidden sm:table-cell">Plataforma</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Bruto</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium hidden md:table-cell">Líquido</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Data</th>
                    <th className="text-center px-4 py-3 text-gray-500 font-medium hidden lg:table-cell">Prazo garantia</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={9} className="text-center py-12 text-gray-600">Nenhuma venda encontrada</td></tr>
                  ) : filtered.map(sale => (
                    <tr key={sale.id} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                      <td className="px-4 py-3 text-gray-200 font-medium">{sale.nome}</td>
                      <td className="px-4 py-3 text-gray-400 hidden md:table-cell">{sale.email}</td>
                      <td className="px-4 py-3 text-gray-400 hidden lg:table-cell">{sale.telefone}</td>
                      <td className="px-4 py-3 text-gray-300">{productMap[sale.produto]?.nome ?? sale.produto}</td>
                      <td className="px-4 py-3 hidden sm:table-cell"><PlatformBadge platform={sale.plataforma} /></td>
                      <td className="px-4 py-3 text-right text-gray-200">{formatCurrency(getSaleBruto(sale))}</td>
                      <td className="px-4 py-3 text-right text-emerald-400 hidden md:table-cell">{formatCurrency(sale.valor_liquido)}</td>
                      <td className="px-4 py-3 text-right text-gray-400 whitespace-nowrap">{formatDateTime(sale.data_hora)}</td>
                      <td className="px-4 py-3 text-center hidden lg:table-cell">
                        <WarrantyBadge dataHora={sale.data_hora} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10 bg-gray-800/50">
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Nome</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium hidden md:table-cell">E-mail</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium">Produto</th>
                    <th className="text-left px-4 py-3 text-gray-500 font-medium hidden sm:table-cell">Plataforma</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Valor</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium">Data compra</th>
                    <th className="text-right px-4 py-3 text-gray-500 font-medium hidden md:table-cell">Data reembolso</th>
                    <th className="text-center px-4 py-3 text-gray-500 font-medium">Dias de acesso</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-12 text-gray-600">Nenhum reembolso encontrado</td></tr>
                  ) : filtered.map(sale => (
                    <tr key={sale.id} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                      <td className="px-4 py-3 text-gray-200 font-medium">{sale.nome}</td>
                      <td className="px-4 py-3 text-gray-400 hidden md:table-cell">{sale.email}</td>
                      <td className="px-4 py-3 text-gray-300">{productMap[sale.produto]?.nome ?? sale.produto}</td>
                      <td className="px-4 py-3 hidden sm:table-cell"><PlatformBadge platform={sale.plataforma} /></td>
                      <td className="px-4 py-3 text-right text-red-400 font-semibold">{formatCurrency(getSaleBruto(sale))}</td>
                      <td className="px-4 py-3 text-right text-gray-400 whitespace-nowrap">{formatDateTime(sale.data_hora)}</td>
                      <td className="px-4 py-3 text-right text-gray-400 hidden md:table-cell">
                        {sale.data_reembolso ? sale.data_reembolso.split('-').reverse().join('/') : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {sale.data_reembolso
                          ? <AccessDaysBadge dataHora={sale.data_hora} dataReembolso={sale.data_reembolso} />
                          : <span className="text-gray-600">—</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>
      <MobileNav />

    </div>
  )
}
