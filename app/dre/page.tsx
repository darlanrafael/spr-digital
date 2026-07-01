'use client'

import { useState, useMemo } from 'react'
import { Pencil, Check, X } from 'lucide-react'
import { useApp } from '@/contexts/AppContext'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import ProtectedRoute from '@/components/ProtectedRoute'
import { formatCurrency, getMonthLabel, getSaleBruto, getAliquotaByPreco, getImpostoBase } from '@/lib/formatters'

type DREToggle = 'dre' | 'fluxo'

const MONTHS_6 = (() => {
  const result: string[] = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return result
})()

export default function DREPage() {
  return (
    <ProtectedRoute>
      <DREContent />
    </ProtectedRoute>
  )
}

function DREContent() {
  const { sales, costs, products, selectedProject, user } = useApp()
  const [toggle, setToggle] = useState<DREToggle>('dre')
  const [editingOther, setEditingOther] = useState<string | null>(null)
  const [otherValues, setOtherValues] = useState<Record<string, number>>({})
  const [editVal, setEditVal] = useState('')

  const canEdit = user?.role === 'admin' || user?.role === 'financeiro'
  const productMap = useMemo(() => Object.fromEntries(products.map(p => [p.id, p])), [products])

  const months = MONTHS_6

  function getSalesForMonth(month: string) {
    return sales.filter(s => {
      const matchProject = selectedProject === 'all' || s.projetoId === selectedProject
      return s.status === 'aprovada' && s.data_hora.startsWith(month) && matchProject
    })
  }

  const monthData = useMemo(() => months.map(month => {
    const monthSales = getSalesForMonth(month)
    const receitaBruta = monthSales.reduce((a, s) => a + getSaleBruto(s), 0)
    const impostos = monthSales.reduce((a, s) => {
      const aliquota = getAliquotaByPreco(s.preco_base)
      return a + getImpostoBase(s) * (aliquota / 100)
    }, 0)
    const taxasPlataforma = monthSales.reduce((a, s) => a + (getSaleBruto(s) - s.valor_liquido), 0) - impostos
    const receitaLiquida = receitaBruta - impostos - taxasPlataforma
    const liquidoPosImpostos = monthSales.reduce((a, s) => {
      const aliquota = getAliquotaByPreco(s.preco_base)
      return a + s.valor_liquido - getImpostoBase(s) * (aliquota / 100)
    }, 0)
    const metaAds = costs.metaAds
      .filter(m => m.mes === month && (selectedProject === 'all' || m.projetoId === selectedProject))
      .reduce((a, m) => a + m.valor, 0)
    const fixedCosts = costs.fixos.filter(c => c.ativo).reduce((a, c) => a + c.valor, 0)
    const outros = otherValues[month] ?? 0
    const resultado = receitaLiquida - metaAds - fixedCosts - outros

    // Fluxo de caixa
    const varCosts = costs.variaveis
      .filter(v => v.data.startsWith(month))
      .reduce((a, v) => a + v.valor, 0)
    const entradas = receitaBruta
    const saidaImpostos = impostos
    const saldoFinal = entradas - saidaImpostos - metaAds - fixedCosts - varCosts

    return {
      month, receitaBruta, impostos, taxasPlataforma, receitaLiquida, liquidoPosImpostos,
      metaAds, fixedCosts, outros, resultado,
      entradas, saidaImpostos, varCosts, saldoFinal,
    }
  }), [months, sales, costs, productMap, selectedProject, otherValues])

  function startEdit(month: string) {
    setEditingOther(month)
    setEditVal(String(otherValues[month] ?? 0))
  }

  function saveEdit(month: string) {
    setOtherValues(p => ({ ...p, [month]: parseFloat(editVal) || 0 }))
    setEditingOther(null)
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <Header />
      <main className="max-w-screen-xl mx-auto px-4 py-6 pb-20 md:pb-6">
        {/* Toggle */}
        <div className="flex items-center gap-2 mb-6">
          <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-1">
            {(['dre', 'fluxo'] as const).map(t => (
              <button
                key={t}
                onClick={() => setToggle(t)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  toggle === t ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                {t === 'dre' ? 'DRE' : 'Fluxo de Caixa'}
              </button>
            ))}
          </div>
        </div>

        {toggle === 'dre' ? (
          <div className="bg-gray-900 rounded-xl border border-white/10 overflow-hidden">
            <div className="p-4 border-b border-white/10">
              <h3 className="text-sm font-semibold text-white">Demonstrativo de Resultado do Exercício</h3>
              <p className="text-xs text-gray-500 mt-0.5">Últimos 6 meses</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10 bg-gray-800/40">
                    <th className="text-left px-4 py-3 text-gray-400 font-medium w-48">Linha</th>
                    {months.map(m => (
                      <th key={m} className="text-right px-4 py-3 text-gray-400 font-medium">{getMonthLabel(m)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <DRERow label="Receita bruta" data={monthData} field="receitaBruta" />
                  <DRERow label="(-) Impostos" data={monthData} field="impostos" negative />
                  <DRERow label="(-) Taxas plataforma" data={monthData} field="taxasPlataforma" negative />
                  <DRERow label="= Receita líquida" data={monthData} field="receitaLiquida" bold />
                  <DRERow label="= Líquido Pós-Impostos" data={monthData} field="liquidoPosImpostos" bold green />
                  <DRERow label="(-) Meta Ads" data={monthData} field="metaAds" negative />
                  <DRERow label="(-) Custos fixos" data={monthData} field="fixedCosts" negative />

                  {/* Outros — editável */}
                  <tr className="border-b border-white/5 hover:bg-white/2">
                    <td className="px-4 py-3 text-gray-400">(-) Outros</td>
                    {monthData.map(d => (
                      <td key={d.month} className="px-4 py-3 text-right">
                        {editingOther === d.month ? (
                          <div className="flex items-center justify-end gap-1">
                            <input
                              type="number" step="0.01"
                              value={editVal}
                              onChange={e => setEditVal(e.target.value)}
                              className="w-24 bg-gray-800 border border-indigo-500 rounded px-2 py-0.5 text-white text-xs text-right focus:outline-none"
                              autoFocus
                            />
                            <button onClick={() => saveEdit(d.month)} className="text-emerald-400 hover:text-emerald-300">
                              <Check className="w-3 h-3" />
                            </button>
                            <button onClick={() => setEditingOther(null)} className="text-red-400 hover:text-red-300">
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1 group">
                            <span className="text-red-400">{d.outros > 0 ? `-${formatCurrency(d.outros)}` : '—'}</span>
                            {canEdit && (
                              <button
                                onClick={() => startEdit(d.month)}
                                className="text-gray-600 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity ml-1"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    ))}
                  </tr>

                  {/* Resultado */}
                  <tr className="border-t-2 border-white/10 bg-gray-800/20">
                    <td className="px-4 py-3 text-white font-bold">= Resultado líquido</td>
                    {monthData.map(d => (
                      <td key={d.month} className={`px-4 py-3 text-right font-bold ${d.resultado >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {formatCurrency(d.resultado)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="bg-gray-900 rounded-xl border border-white/10 overflow-hidden">
            <div className="p-4 border-b border-white/10">
              <h3 className="text-sm font-semibold text-white">Fluxo de Caixa</h3>
              <p className="text-xs text-gray-500 mt-0.5">Últimos 6 meses</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10 bg-gray-800/40">
                    <th className="text-left px-4 py-3 text-gray-400 font-medium w-48">Linha</th>
                    {months.map(m => (
                      <th key={m} className="text-right px-4 py-3 text-gray-400 font-medium">{getMonthLabel(m)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <DRERow label="Saldo inicial" data={monthData.map(d => ({ ...d, saldoInicial: 0 }))} field="saldoInicial" />
                  <DRERow label="+ Entradas" data={monthData} field="entradas" positive />
                  <DRERow label="- Impostos pagos" data={monthData} field="saidaImpostos" negative />
                  <DRERow label="- Meta Ads" data={monthData} field="metaAds" negative />
                  <DRERow label="- Custos fixos" data={monthData} field="fixedCosts" negative />
                  <DRERow label="- Custos variáveis" data={monthData} field="varCosts" negative />
                  <tr className="border-t-2 border-white/10 bg-gray-800/20">
                    <td className="px-4 py-3 text-white font-bold">= Saldo final</td>
                    {monthData.map(d => (
                      <td key={d.month} className={`px-4 py-3 text-right font-bold ${d.saldoFinal >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {formatCurrency(d.saldoFinal)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
      <MobileNav />
    </div>
  )
}

type MonthDataItem = Record<string, number | string>

function DRERow({
  label, data, field, negative, positive, bold, green,
}: {
  label: string
  data: MonthDataItem[]
  field: string
  negative?: boolean
  positive?: boolean
  bold?: boolean
  green?: boolean
}) {
  return (
    <tr className="border-b border-white/5 hover:bg-white/2 transition-colors">
      <td className={`px-4 py-3 ${bold ? 'text-gray-200 font-semibold' : 'text-gray-400'}`}>{label}</td>
      {data.map((d, i) => {
        const val = Number(d[field] ?? 0)
        const color = negative ? 'text-red-400' : green ? '' : positive ? 'text-emerald-400' : bold ? 'text-blue-400' : 'text-gray-200'
        return (
          <td key={i} className={`px-4 py-3 text-right ${color} ${bold ? 'font-semibold' : ''}`}
            style={green ? { color: '#22c55e', fontWeight: 600 } : undefined}>
            {negative && val > 0 ? `-${formatCurrency(val)}` : formatCurrency(val)}
          </td>
        )
      })}
    </tr>
  )
}
