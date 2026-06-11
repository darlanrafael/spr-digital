'use client'

import { useState, useMemo } from 'react'
import { AlertCircle, CheckCircle, ChevronRight, ChevronDown, ChevronUp, Clock, Download } from 'lucide-react'
import { useApp } from '@/contexts/AppContext'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import PlatformBadge from '@/components/PlatformBadge'
import ProtectedRoute from '@/components/ProtectedRoute'
import { formatCurrency, formatDate, formatDateTime, getSaleBruto, getAliquotaByPreco } from '@/lib/formatters'
import { Closing, ClosingBuyer, CashflowEntry } from '@/types'
import { addClosing as svcAddClosing, addCashflowEntry as svcAddCashflow } from '@/lib/services'

type Step = 1 | 2 | 3 | 4
type PageTab = 'novo' | 'historico'

const SOCIO_NAMES = ['SPR DIGITAL LTDA', 'Pedro Roncada']

function parsePercent(val: string): number {
  return parseFloat(val.replace(',', '.')) || 0
}

export default function FechamentosPage() {
  return (
    <ProtectedRoute>
      <FechamentosContent />
    </ProtectedRoute>
  )
}

function FechamentosContent() {
  const { sales, costs, products, closings, setClosings, cashflow, setCashflow, selectedProject, user } = useApp()

  const [pageTab, setPageTab] = useState<PageTab>('novo')
  const [activeStep, setActiveStep] = useState<Step>(1)
  const [periodo, setPeriodo] = useState({ inicio: '', fim: '' })
  const [selectedProducts, setSelectedProducts] = useState<string[]>([])
  const [socioInputs, setSocioInputs] = useState(['50', '50'])
  const [confirmed, setConfirmed] = useState(false)
  const [confirmedClosing, setConfirmedClosing] = useState<Closing | null>(null)
  const [successMsg, setSuccessMsg] = useState('')

  const canEdit = user?.role === 'admin'
  const productMap = useMemo(() => Object.fromEntries(products.map(p => [p.id, p])), [products])

  const fixedTotal = useMemo(() => costs.fixos.filter(c => c.ativo).reduce((a, c) => a + c.valor, 0), [costs.fixos])
  const varTotal = useMemo(() => costs.variaveis.reduce((a, v) => a + v.valor, 0), [costs.variaveis])
  const totalCosts = fixedTotal + varTotal

  const periodSales = useMemo(() => {
    if (!periodo.inicio || !periodo.fim) return []
    return sales.filter(s => {
      const matchProject = selectedProject === 'all' || s.projetoId === selectedProject
      const d = s.data_hora.slice(0, 10)
      const matchPeriod = d >= periodo.inicio && d <= periodo.fim
      const matchProduct = selectedProducts.length === 0 || selectedProducts.includes(s.produto)
      return s.status === 'aprovada' && matchProject && matchPeriod && matchProduct
    })
  }, [sales, periodo, selectedProject, selectedProducts])

  const byProduct = useMemo(() => {
    const map: Record<string, {
      id: string; nome: string; plataforma: string; qtd: number
      bruto: number; taxas: number; aliquota: number; imposto: number; liquido: number
    }> = {}
    for (const s of periodSales) {
      const prod = productMap[s.produto]
      const aliquota = getAliquotaByPreco(s.preco_base)
      if (!map[s.produto]) {
        map[s.produto] = { id: s.produto, nome: prod?.nome ?? s.produto, plataforma: s.plataforma, qtd: 0, bruto: 0, taxas: 0, aliquota, imposto: 0, liquido: 0 }
      }
      const bruto = getSaleBruto(s)
      map[s.produto].qtd++
      map[s.produto].bruto += bruto
      map[s.produto].taxas += bruto - s.valor_liquido
      map[s.produto].imposto += bruto * (aliquota / 100)
      map[s.produto].liquido += s.valor_liquido
    }
    return Object.values(map)
  }, [periodSales, productMap])

  const faturamentoBruto = byProduct.reduce((a, p) => a + p.bruto, 0)
  const impostoTotal = byProduct.reduce((a, p) => a + p.imposto, 0)
  const taxasPlat = byProduct.reduce((a, p) => a + p.taxas, 0)
  const faturamentoLiquido = faturamentoBruto - taxasPlat - impostoTotal

  const lucroBruto = faturamentoLiquido - totalCosts
  const reservaCaixa = Math.max(0, lucroBruto * 0.3)
  const lucroReal = Math.max(0, lucroBruto * 0.7)

  const socioPercents = socioInputs.map(parsePercent)
  const socioTotal = socioPercents[0] + socioPercents[1]
  const isDistributionValid = Math.abs(socioTotal - 100) <= 0.01
  const socioValues = socioPercents.map(pct => lucroReal * (pct / 100))

  const availableProducts = useMemo(() => {
    const ids = new Set(sales.filter(s => selectedProject === 'all' || s.projetoId === selectedProject).map(s => s.produto))
    return products.filter(p => ids.has(p.id))
  }, [sales, products, selectedProject])

  const lastClosed = closings[closings.length - 1]
  const alertas = lastClosed?.alertas ?? []
  const alertasTotal = alertas.reduce((a, x) => a + x.valor, 0)

  const efectivaAliquota = faturamentoBruto > 0
    ? ((impostoTotal / faturamentoBruto) * 100).toFixed(2)
    : null

  function toggleProduct(id: string) {
    setSelectedProducts(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id])
  }

  async function handleConfirm() {
    if (!canEdit) return
    const buyers: ClosingBuyer[] = periodSales.map(s => ({
      id: s.id,
      nome: s.nome,
      email: s.email,
      cpf: '***.***.***-**',
      telefone: s.telefone,
      produto: productMap[s.produto]?.nome ?? s.produto,
      plataforma: s.plataforma,
      valor: getSaleBruto(s),
      valor_bruto: getSaleBruto(s),
      valor_liquido: s.valor_liquido,
      data_hora: s.data_hora,
      status: 'ok',
    }))

    const sociosData = SOCIO_NAMES.map((nome, i) => ({
      nome,
      percentual: socioPercents[i],
      valor: socioValues[i],
      repasse_original: socioValues[i],
      deducoes: alertasTotal * (socioPercents[i] / 100),
      repasse_final: socioValues[i] - alertasTotal * (socioPercents[i] / 100),
    }))

    const productNames = selectedProducts.length > 0
      ? selectedProducts.map(id => productMap[id]?.nome ?? id)
      : byProduct.map(p => p.nome)

    const now = new Date()

    const newClosing: Closing = {
      id: `close_${Date.now()}`,
      data: now.toISOString().split('T')[0],
      data_confirmacao: now.toISOString(),
      periodo,
      produtos_incluidos: productNames,
      faturamentoBruto,
      impostos: impostoTotal,
      taxasPlataforma: taxasPlat,
      faturamentoLiquido,
      custosTotais: totalCosts,
      custos_fixos_total: fixedTotal,
      custos_variaveis_total: varTotal,
      lucroBruto,
      reservaCaixa,
      lucroReal,
      socios: sociosData,
      compradores: buyers,
      alertas: [],
      byProduct: byProduct.map(p => ({
        nome: p.nome,
        plataforma: p.plataforma,
        qtd: p.qtd,
        bruto: p.bruto,
        taxas: p.taxas,
        aliquota: p.aliquota,
        imposto: p.imposto,
        liquido: p.liquido,
      })),
    }
    try { await svcAddClosing(newClosing, selectedProject) } catch (e) { console.error(e) }
    setClosings(prev => [...prev, newClosing])

    const lastBalance = cashflow.length > 0 ? cashflow[cashflow.length - 1].saldoAcumulado : 0
    const cfEntry: CashflowEntry = {
      id: `cf_${Date.now()}`,
      data: now.toISOString().split('T')[0],
      descricao: `Reserva de caixa — Fechamento ${formatDate(periodo.inicio)} a ${formatDate(periodo.fim)}`,
      origem: 'Fechamento Automático',
      tipo: 'entrada_automatica',
      valor: reservaCaixa,
      saldoAcumulado: lastBalance + reservaCaixa,
    }
    try { await svcAddCashflow(cfEntry, selectedProject) } catch (e) { console.error(e) }
    setCashflow(prev => [...prev, cfEntry])

    setConfirmedClosing(newClosing)
    setConfirmed(true)
    setSuccessMsg(`Fechamento confirmado com sucesso! A reserva de ${formatCurrency(reservaCaixa)} foi lançada automaticamente no Caixa.`)
  }

  const steps = [
    { n: 1, label: 'Custos' },
    { n: 2, label: 'Faturamento' },
    { n: 3, label: 'Repasse' },
    { n: 4, label: 'Confirmar' },
  ]

  return (
    <div className="min-h-screen bg-gray-950">
      <Header />
      <main className="max-w-screen-xl mx-auto px-4 py-6 pb-20 md:pb-6">

        {/* Page tab switcher */}
        <div className="flex items-center gap-1 bg-gray-900 border border-white/10 rounded-xl p-1 mb-6 w-fit">
          {([
            { key: 'novo', label: 'Novo Fechamento' },
            { key: 'historico', label: 'Histórico de Fechamento' },
          ] as const).map(tab => (
            <button
              key={tab.key}
              onClick={() => setPageTab(tab.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                pageTab === tab.key ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════════════════
            ABA: NOVO FECHAMENTO
        ══════════════════════════════════════════════ */}
        {pageTab === 'novo' && (
          <>
            {/* Step bar */}
            <div className="flex items-center gap-0 mb-8">
              {steps.map((step, idx) => (
                <div key={step.n} className="flex items-center flex-1">
                  <button onClick={() => setActiveStep(step.n as Step)} className="flex flex-col items-center gap-1 w-full">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                      activeStep > step.n ? 'bg-emerald-500 text-white'
                        : activeStep === step.n ? 'bg-indigo-600 text-white'
                        : 'bg-gray-800 text-gray-500'
                    }`}>
                      {activeStep > step.n ? <CheckCircle className="w-4 h-4" /> : step.n}
                    </div>
                    <span className={`text-xs ${activeStep === step.n ? 'text-indigo-400' : 'text-gray-500'}`}>{step.label}</span>
                  </button>
                  {idx < steps.length - 1 && (
                    <div className={`h-0.5 flex-1 -mt-5 ${activeStep > step.n ? 'bg-emerald-500' : 'bg-gray-800'}`} />
                  )}
                </div>
              ))}
            </div>

            {/* ── STEP 1 — Custos ── */}
            {activeStep === 1 && (
              <div className="space-y-4">
                <div className="bg-gray-900 rounded-xl border border-white/10 p-4">
                  <h3 className="text-sm font-semibold text-white mb-4">Custos Fixos</h3>
                  <div className="space-y-2">
                    {costs.fixos.filter(c => c.ativo).map(c => (
                      <div key={c.id} className="flex justify-between text-xs">
                        <span className="text-gray-400">{c.descricao}</span>
                        <span className="text-gray-200">{formatCurrency(c.valor)}</span>
                      </div>
                    ))}
                    <div className="border-t border-white/10 pt-2 flex justify-between text-xs font-semibold">
                      <span className="text-gray-300">Subtotal Fixos</span>
                      <span className="text-red-400">{formatCurrency(fixedTotal)}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-900 rounded-xl border border-white/10 p-4">
                  <h3 className="text-sm font-semibold text-white mb-4">Custos Variáveis</h3>
                  <div className="space-y-2">
                    {costs.variaveis.length === 0 ? (
                      <p className="text-xs text-gray-600">Nenhum custo variável</p>
                    ) : costs.variaveis.map(c => (
                      <div key={c.id} className="flex justify-between text-xs">
                        <span className="text-gray-400">{c.descricao} <span className="text-gray-600">({formatDate(c.data)})</span></span>
                        <span className="text-gray-200">{formatCurrency(c.valor)}</span>
                      </div>
                    ))}
                    {costs.variaveis.length > 0 && (
                      <div className="border-t border-white/10 pt-2 flex justify-between text-xs font-semibold">
                        <span className="text-gray-300">Subtotal Variáveis</span>
                        <span className="text-red-400">{formatCurrency(varTotal)}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-gray-800 rounded-xl p-4 flex justify-between items-center">
                  <span className="text-sm font-semibold text-white">Total de Custos</span>
                  <span className="text-xl font-bold text-red-400">{formatCurrency(totalCosts)}</span>
                </div>

                <button onClick={() => setActiveStep(2)}
                  className="flex items-center gap-2 ml-auto bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-4 py-2 rounded-lg transition-colors">
                  Próximo <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* ── STEP 2 — Faturamento ── */}
            {activeStep === 2 && (
              <div className="space-y-4">
                <div className="bg-gray-900 rounded-xl border border-white/10 p-4">
                  <h3 className="text-sm font-semibold text-white mb-4">Período do Fechamento</h3>
                  <div className="flex flex-wrap gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Data início</label>
                      <input type="date" value={periodo.inicio}
                        onChange={e => setPeriodo(p => ({ ...p, inicio: e.target.value }))}
                        className="bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-300 focus:outline-none focus:border-indigo-500" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Data fim</label>
                      <input type="date" value={periodo.fim}
                        onChange={e => setPeriodo(p => ({ ...p, fim: e.target.value }))}
                        className="bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-300 focus:outline-none focus:border-indigo-500" />
                    </div>
                  </div>
                </div>

                <div className="bg-gray-900 rounded-xl border border-white/10 p-4">
                  <h3 className="text-sm font-semibold text-white mb-3">Produtos incluídos</h3>
                  <p className="text-xs text-gray-500 mb-3">Deixe vazio para incluir todos</p>
                  <div className="flex flex-wrap gap-2">
                    {availableProducts.map(p => (
                      <button key={p.id} onClick={() => toggleProduct(p.id)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                          selectedProducts.includes(p.id) || selectedProducts.length === 0
                            ? 'bg-indigo-600/30 border-indigo-500/50 text-indigo-300'
                            : 'bg-gray-800 border-white/10 text-gray-500'
                        }`}>
                        {p.nome}
                      </button>
                    ))}
                  </div>
                </div>

                {byProduct.length > 0 && (
                  <div className="bg-gray-900 rounded-xl border border-white/10 overflow-hidden">
                    <div className="p-4 border-b border-white/10">
                      <h3 className="text-sm font-semibold text-white">Detalhamento de Faturamento</h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-white/5 bg-gray-800/40">
                            <th className="text-left px-4 py-2.5 text-gray-500 font-medium">Produto</th>
                            <th className="text-center px-4 py-2.5 text-gray-500 font-medium">Qtd. vendas</th>
                            <th className="text-right px-4 py-2.5 text-gray-500 font-medium">Faturamento bruto</th>
                            <th className="text-right px-4 py-2.5 text-gray-500 font-medium">Taxas da plataforma</th>
                            <th className="text-center px-4 py-2.5 text-gray-500 font-medium">Alíquota</th>
                            <th className="text-right px-4 py-2.5 text-gray-500 font-medium">Imposto</th>
                            <th className="text-right px-4 py-2.5 text-gray-500 font-medium">Faturamento líquido</th>
                          </tr>
                        </thead>
                        <tbody>
                          {byProduct.map(row => (
                            <tr key={row.id} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                              <td className="px-4 py-3 text-gray-200 font-medium">{row.nome}</td>
                              <td className="px-4 py-3 text-center text-gray-300">{row.qtd}</td>
                              <td className="px-4 py-3 text-right text-gray-300">{formatCurrency(row.bruto)}</td>
                              <td className="px-4 py-3 text-right text-red-400">-{formatCurrency(row.taxas)}</td>
                              <td className="px-4 py-3 text-center text-amber-400">{row.aliquota}%</td>
                              <td className="px-4 py-3 text-right text-red-400">-{formatCurrency(row.imposto)}</td>
                              <td className="px-4 py-3 text-right text-emerald-400 font-semibold">{formatCurrency(row.liquido)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-white/10 bg-gray-800/30">
                            <td className="px-4 py-3 text-gray-200 font-semibold">Total</td>
                            <td className="px-4 py-3 text-center text-gray-200 font-semibold">
                              {byProduct.reduce((a, r) => a + r.qtd, 0)}
                            </td>
                            <td className="px-4 py-3 text-right text-gray-200 font-semibold">{formatCurrency(faturamentoBruto)}</td>
                            <td className="px-4 py-3 text-right text-red-400 font-semibold">-{formatCurrency(taxasPlat)}</td>
                            <td className="px-4 py-3 text-center text-gray-500 text-[10px]">
                              {efectivaAliquota ? `(${efectivaAliquota}%*)` : ''}
                            </td>
                            <td className="px-4 py-3 text-right text-red-400 font-semibold">-{formatCurrency(impostoTotal)}</td>
                            <td className="px-4 py-3 text-right text-emerald-400 font-semibold">{formatCurrency(faturamentoLiquido)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}

                <div className="flex gap-2 justify-end">
                  <button onClick={() => setActiveStep(1)}
                    className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm px-4 py-2 rounded-lg transition-colors">
                    Voltar
                  </button>
                  <button onClick={() => setActiveStep(3)} disabled={!periodo.inicio || !periodo.fim}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors">
                    Próximo <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 3 — Repasse ── */}
            {activeStep === 3 && (
              <div className="space-y-4">
                <div className="grid md:grid-cols-3 gap-4">
                  <div className="bg-gray-900 rounded-xl border border-white/10 p-4 text-center">
                    <p className="text-xs text-gray-500 mb-2">Lucro Bruto</p>
                    <p className={`text-2xl font-bold ${lucroBruto >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {formatCurrency(lucroBruto)}
                    </p>
                    <p className="text-xs text-gray-600 mt-1">Faturamento líquido - Custos</p>
                  </div>
                  <div className="bg-gray-900 rounded-xl border border-purple-500/30 p-4 text-center">
                    <p className="text-xs text-gray-500 mb-2">Reserva de Caixa (30%)</p>
                    <p className="text-2xl font-bold text-purple-400">{formatCurrency(reservaCaixa)}</p>
                    <p className="text-xs text-gray-600 mt-1">Lançada automaticamente ao confirmar</p>
                  </div>
                  <div className="bg-gray-900 rounded-xl border border-emerald-500/30 p-4 text-center">
                    <p className="text-xs text-gray-500 mb-2">Lucro Real (70%)</p>
                    <p className="text-2xl font-bold text-emerald-400">{formatCurrency(lucroReal)}</p>
                    <p className="text-xs text-gray-600 mt-1">Para divisão entre sócios</p>
                  </div>
                </div>

                <div className="bg-gray-900 rounded-xl border border-white/10 p-4">
                  <h3 className="text-sm font-semibold text-white mb-4">Divisão entre Sócios</h3>
                  <div className="space-y-3 mb-4">
                    {SOCIO_NAMES.map((nome, i) => (
                      <div key={nome} className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center shrink-0">
                          <span className="text-white text-xs font-semibold">{nome[0]}</span>
                        </div>
                        <div className="flex-1">
                          <p className="text-sm text-white font-medium">{nome}</p>
                          <p className="text-xs text-emerald-400">{formatCurrency(socioValues[i])}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={socioInputs[i]}
                            onChange={e => {
                              const next = [...socioInputs]
                              next[i] = e.target.value
                              setSocioInputs(next)
                            }}
                            className="w-20 bg-gray-800 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white text-right focus:outline-none focus:border-indigo-500"
                          />
                          <span className="text-gray-400 text-sm">%</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {isDistributionValid ? (
                    <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <p className="text-xs text-emerald-400 font-medium">✓ Distribuição válida (100%)</p>
                    </div>
                  ) : socioTotal > 100.01 ? (
                    <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                      <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      <p className="text-xs text-red-400">Soma: {socioTotal.toFixed(2)}% — excedeu em {(socioTotal - 100).toFixed(2)}%</p>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <p className="text-xs text-amber-400">Soma: {socioTotal.toFixed(2)}% — faltam {(100 - socioTotal).toFixed(2)}%</p>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 justify-end">
                  <button onClick={() => setActiveStep(2)}
                    className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm px-4 py-2 rounded-lg transition-colors">
                    Voltar
                  </button>
                  <button onClick={() => setActiveStep(4)} disabled={!isDistributionValid || lucroBruto <= 0}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors">
                    Revisar <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 4 — Confirmação ── */}
            {activeStep === 4 && (
              <div className="space-y-4">
                {confirmed && confirmedClosing ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
                      <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-emerald-400">Fechamento confirmado!</p>
                        <p className="text-xs text-gray-400">{successMsg}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setPageTab('historico')}
                      className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-4 py-2 rounded-lg transition-colors"
                    >
                      <Clock className="w-4 h-4" /> Ver histórico →
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">

                    {/* Bloco 1 — Resumo */}
                    <div className="bg-gray-900 rounded-xl border border-white/10 p-4">
                      <h3 className="text-sm font-semibold text-white mb-4">Resumo do fechamento</h3>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between">
                          <span className="text-gray-500">Período</span>
                          <span className="text-gray-200">{formatDate(periodo.inicio)} até {formatDate(periodo.fim)}</span>
                        </div>
                        {byProduct.length > 0 && (
                          <div className="flex justify-between items-start gap-4">
                            <span className="text-gray-500 shrink-0">Produtos incluídos</span>
                            <div className="flex flex-wrap gap-1 justify-end">
                              {byProduct.map(p => (
                                <span key={p.id} className="bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full text-[10px]">{p.nome}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="border-t border-white/5 pt-2 space-y-2">
                          <div className="flex justify-between">
                            <span className="text-gray-500">Faturamento bruto total</span>
                            <span className="text-emerald-400 font-medium">{formatCurrency(faturamentoBruto)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Taxas da plataforma</span>
                            <span className="text-red-400">-{formatCurrency(taxasPlat)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Impostos por produto</span>
                            <span className="text-red-400">-{formatCurrency(impostoTotal)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Faturamento líquido total</span>
                            <span className="text-emerald-400 font-medium">{formatCurrency(faturamentoLiquido)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Total de custos</span>
                            <span className="text-red-400">-{formatCurrency(totalCosts)}</span>
                          </div>
                          <div className="flex justify-between border-t border-white/5 pt-2">
                            <span className="text-gray-400 font-medium">Lucro bruto</span>
                            <span className={lucroBruto >= 0 ? 'text-emerald-400 font-medium' : 'text-red-400 font-medium'}>{formatCurrency(lucroBruto)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">Reserva de caixa (30%)</span>
                            <span className="text-amber-400">-{formatCurrency(reservaCaixa)}</span>
                          </div>
                          <div className="flex justify-between border-t border-white/5 pt-2">
                            <span className="text-white font-semibold">Lucro real disponível para repasse</span>
                            <span className="text-emerald-400 font-bold text-base">{formatCurrency(lucroReal)}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Bloco 2 — Repasse entre sócios */}
                    <div className="bg-gray-900 rounded-xl border border-white/10 overflow-hidden">
                      <div className="p-4 border-b border-white/10">
                        <h3 className="text-sm font-semibold text-white">Repasse entre sócios</h3>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-white/5 bg-gray-800/40">
                              <th className="text-left px-4 py-2.5 text-gray-500 font-medium">Sócio</th>
                              <th className="text-center px-4 py-2.5 text-gray-500 font-medium">Percentual</th>
                              <th className="text-right px-4 py-2.5 text-gray-500 font-medium">Valor a receber</th>
                            </tr>
                          </thead>
                          <tbody>
                            {SOCIO_NAMES.map((nome, i) => (
                              <tr key={nome} className="border-b border-white/5">
                                <td className="px-4 py-3 text-gray-200 font-medium">{nome}</td>
                                <td className="px-4 py-3 text-center text-amber-400">{socioPercents[i].toFixed(2)}%</td>
                                <td className="px-4 py-3 text-right text-emerald-400 font-semibold">{formatCurrency(socioValues[i])}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t border-white/10 bg-gray-800/20">
                              <td className="px-4 py-3 text-gray-200 font-semibold">Total</td>
                              <td className="px-4 py-3 text-center text-gray-400 font-semibold">100%</td>
                              <td className="px-4 py-3 text-right text-emerald-400 font-bold">{formatCurrency(lucroReal)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>

                    {/* Bloco 3 — Alertas pós-fechamento */}
                    {alertas.length > 0 && (
                      <div className="bg-red-500/10 border border-red-500/30 rounded-xl overflow-hidden">
                        <div className="p-4 border-b border-red-500/20">
                          <div className="flex items-center gap-2 mb-1">
                            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                            <h4 className="text-sm font-semibold text-red-400">⚠️ Reembolsos e chargebacks identificados</h4>
                          </div>
                          <p className="text-xs text-gray-400">Os seguintes compradores de fechamentos anteriores solicitaram reembolso ou chargeback após o repasse já ter sido realizado.</p>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-red-500/20 bg-red-500/5">
                                <th className="text-left px-4 py-2.5 text-gray-500">Nome</th>
                                <th className="text-left px-4 py-2.5 text-gray-500 hidden md:table-cell">Telefone</th>
                                <th className="text-left px-4 py-2.5 text-gray-500 hidden md:table-cell">Email</th>
                                <th className="text-left px-4 py-2.5 text-gray-500">Produto</th>
                                <th className="text-right px-4 py-2.5 text-gray-500">Valor</th>
                                <th className="text-center px-4 py-2.5 text-gray-500">Tipo</th>
                                <th className="text-right px-4 py-2.5 text-gray-500 hidden lg:table-cell">Data</th>
                              </tr>
                            </thead>
                            <tbody>
                              {alertas.map((a, i) => (
                                <tr key={i} className="border-b border-red-500/10">
                                  <td className="px-4 py-2.5 text-gray-300">{a.nome}</td>
                                  <td className="px-4 py-2.5 text-gray-400 hidden md:table-cell">{a.telefone ?? '—'}</td>
                                  <td className="px-4 py-2.5 text-gray-400 hidden md:table-cell">{a.email ?? '—'}</td>
                                  <td className="px-4 py-2.5 text-gray-400">{a.produto}</td>
                                  <td className="px-4 py-2.5 text-right text-red-400 font-semibold">-{formatCurrency(a.valor)}</td>
                                  <td className="px-4 py-2.5 text-center">
                                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                                      a.tipo === 'chargeback'
                                        ? 'bg-orange-500/20 text-orange-400 border-orange-500/30'
                                        : 'bg-red-500/20 text-red-400 border-red-500/30'
                                    }`}>
                                      {a.tipo === 'chargeback' ? 'Chargeback' : 'Reembolso'}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2.5 text-right text-gray-400 hidden lg:table-cell">{formatDate(a.data)}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="border-t border-red-500/20">
                                <td colSpan={4} className="px-4 py-2.5 text-right text-gray-400 font-semibold">Total a deduzir:</td>
                                <td className="px-4 py-2.5 text-right text-red-400 font-bold">-{formatCurrency(alertasTotal)}</td>
                                <td colSpan={2} />
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Bloco 4 — Repasse ajustado */}
                    {alertas.length > 0 && (
                      <div className="bg-gray-900 rounded-xl border border-white/10 overflow-hidden">
                        <div className="p-4 border-b border-white/10">
                          <h3 className="text-sm font-semibold text-white">Repasse ajustado após deduções</h3>
                          <p className="text-xs text-gray-500 mt-0.5">Valores do repasse original deduzidos proporcionalmente pelos reembolsos e chargebacks identificados.</p>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-white/5 bg-gray-800/40">
                                <th className="text-left px-4 py-2.5 text-gray-500 font-medium">Sócio</th>
                                <th className="text-right px-4 py-2.5 text-gray-500 font-medium">Repasse original</th>
                                <th className="text-right px-4 py-2.5 text-gray-500 font-medium">(-) Deduções</th>
                                <th className="text-right px-4 py-2.5 text-gray-500 font-medium">Repasse final</th>
                              </tr>
                            </thead>
                            <tbody>
                              {SOCIO_NAMES.map((nome, i) => {
                                const deducao = alertasTotal * (socioPercents[i] / 100)
                                const original = socioValues[i]
                                const final = original - deducao
                                return (
                                  <tr key={nome} className="border-b border-white/5">
                                    <td className="px-4 py-3 text-gray-200 font-medium">{nome}</td>
                                    <td className="px-4 py-3 text-right text-gray-300">{formatCurrency(original)}</td>
                                    <td className="px-4 py-3 text-right text-red-400">-{formatCurrency(deducao)}</td>
                                    <td className="px-4 py-3 text-right text-emerald-400 font-semibold">{formatCurrency(final)}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                            <tfoot>
                              <tr className="border-t border-white/10 bg-gray-800/20">
                                <td className="px-4 py-3 text-gray-200 font-semibold">Total</td>
                                <td className="px-4 py-3 text-right text-gray-200 font-semibold">{formatCurrency(lucroReal)}</td>
                                <td className="px-4 py-3 text-right text-red-400 font-semibold">-{formatCurrency(alertasTotal)}</td>
                                <td className="px-4 py-3 text-right text-emerald-400 font-bold">{formatCurrency(lucroReal - alertasTotal)}</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Bloco 5 — Botão confirmar */}
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setActiveStep(3)}
                        className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm px-4 py-2 rounded-lg transition-colors">
                        Voltar
                      </button>
                      {canEdit && (
                        <button onClick={handleConfirm} disabled={periodSales.length === 0}
                          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm px-5 py-2 rounded-lg transition-colors font-semibold">
                          <CheckCircle className="w-4 h-4" /> ✓ Confirmar fechamento
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ══════════════════════════════════════════════
            ABA: HISTÓRICO DE FECHAMENTO
        ══════════════════════════════════════════════ */}
        {pageTab === 'historico' && (
          <HistoricoTab closings={closings} />
        )}

      </main>
      <MobileNav />
    </div>
  )
}

function HistoricoTab({ closings }: { closings: Closing[] }) {
  const sorted = [...closings].sort((a, b) => {
    const da = a.data_confirmacao ?? a.data
    const db = b.data_confirmacao ?? b.data
    return db.localeCompare(da)
  })

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm text-gray-500">Todos os fechamentos confirmados com detalhamento completo</p>
        <p className="text-xs text-gray-600 mt-1">
          {sorted.length} fechamento{sorted.length !== 1 ? 's' : ''} realizado{sorted.length !== 1 ? 's' : ''}
        </p>
      </div>

      {sorted.length === 0 ? (
        <div className="bg-gray-900 rounded-xl border border-white/10 p-12 text-center">
          <Clock className="w-10 h-10 text-gray-700 mx-auto mb-3" />
          <p className="text-sm text-gray-500">Nenhum fechamento realizado ainda.</p>
          <p className="text-xs text-gray-600 mt-1">Use a aba "Novo Fechamento" para realizar o primeiro.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {sorted.map(closing => (
            <ClosingCard key={closing.id} closing={closing} />
          ))}
        </div>
      )}
    </div>
  )
}

function ClosingCard({ closing }: { closing: Closing }) {
  const [expanded, setExpanded] = useState(false)

  const confirmedAt = closing.data_confirmacao
    ? formatDateTime(closing.data_confirmacao.replace('T', ' ').slice(0, 16).replace(' ', 'T'))
    : formatDate(closing.data)

  const spr = closing.socios.find(s => s.nome === 'SPR DIGITAL LTDA' || s.nome === 'Rafael')
  const pedro = closing.socios.find(s => s.nome === 'Pedro Roncada')

  function exportCSV() {
    const header = 'Nome,Email,CPF,Telefone,Produto,Plataforma,Valor bruto,Valor líquido,Data da compra,Status'
    const rows = closing.compradores.map(b => {
      const telefone = b.telefone ?? ''
      const plataforma = b.plataforma ?? ''
      const valorBruto = b.valor_bruto ?? b.valor
      const valorLiquido = b.valor_liquido ?? b.valor
      const dataHora = b.data_hora ?? ''
      return `"${b.nome}","${b.email}","${b.cpf}","${telefone}","${b.produto}","${plataforma}",${valorBruto},${valorLiquido},"${dataHora}","${b.status}"`
    })
    const csv = '﻿' + [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `compradores-${closing.data}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-white/10 overflow-hidden">
      {/* Collapsed header */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="text-sm font-semibold text-white">
                {formatDate(closing.periodo.inicio)} → {formatDate(closing.periodo.fim)}
              </span>
              {closing.alertas.length > 0 && (
                <span className="inline-flex items-center gap-1 bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-full text-[10px] font-semibold">
                  {closing.alertas.length} reembolso{closing.alertas.length !== 1 ? 's' : ''}/chargeback{closing.alertas.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mb-3">Confirmado em {confirmedAt}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div>
                <p className="text-gray-600">Faturamento bruto</p>
                <p className="text-gray-300 font-medium">{formatCurrency(closing.faturamentoBruto)}</p>
              </div>
              <div>
                <p className="text-gray-600">Lucro real</p>
                <p className="text-emerald-400 font-medium">{formatCurrency(closing.lucroReal)}</p>
              </div>
              {spr && (
                <div>
                  <p className="text-gray-600">Repasse SPR DIGITAL LTDA</p>
                  <p className="text-gray-300 font-medium">{formatCurrency(spr.repasse_final ?? spr.valor)}</p>
                </div>
              )}
              {pedro && (
                <div>
                  <p className="text-gray-600">Repasse Pedro Roncada</p>
                  <p className="text-gray-300 font-medium">{formatCurrency(pedro.repasse_final ?? pedro.valor)}</p>
                </div>
              )}
            </div>
          </div>
          <button
            onClick={() => setExpanded(e => !e)}
            className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 shrink-0 transition-colors"
          >
            {expanded
              ? <><ChevronUp className="w-4 h-4" /> Ocultar</>
              : <><ChevronDown className="w-4 h-4" /> Ver detalhes</>}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-white/10">

          {/* Seção 1 — Resumo completo */}
          <div className="p-4 border-b border-white/5">
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Resumo completo</h4>
            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1.5 text-xs">
              {[
                { label: 'Faturamento bruto', value: closing.faturamentoBruto, color: 'text-gray-200', neg: false },
                { label: 'Taxas da plataforma', value: closing.taxasPlataforma, color: 'text-red-400', neg: true },
                { label: 'Impostos', value: closing.impostos, color: 'text-red-400', neg: true },
                { label: 'Faturamento líquido', value: closing.faturamentoLiquido, color: 'text-emerald-400', neg: false },
                { label: 'Custos fixos', value: closing.custos_fixos_total ?? 0, color: 'text-red-400', neg: true },
                { label: 'Custos variáveis', value: closing.custos_variaveis_total ?? 0, color: 'text-red-400', neg: true },
                { label: 'Lucro bruto', value: closing.lucroBruto, color: closing.lucroBruto >= 0 ? 'text-emerald-400' : 'text-red-400', neg: false },
                { label: 'Reserva de caixa (30%)', value: closing.reservaCaixa, color: 'text-amber-400', neg: true },
                { label: 'Lucro real', value: closing.lucroReal, color: 'text-emerald-400', neg: false },
              ].map(row => (
                <div key={row.label} className="flex justify-between">
                  <span className="text-gray-500">{row.label}</span>
                  <span className={`font-medium ${row.color}`}>
                    {row.neg ? `-${formatCurrency(row.value)}` : formatCurrency(row.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Seção 2 — Detalhamento por produto */}
          {closing.byProduct && closing.byProduct.length > 0 && (
            <div className="border-b border-white/5">
              <div className="px-4 pt-4 pb-2">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Detalhamento por produto</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/5 bg-gray-800/30">
                      <th className="text-left px-4 py-2 text-gray-500">Produto</th>
                      <th className="text-center px-4 py-2 text-gray-500">Qtd</th>
                      <th className="text-right px-4 py-2 text-gray-500">Bruto</th>
                      <th className="text-right px-4 py-2 text-gray-500">Taxas</th>
                      <th className="text-center px-4 py-2 text-gray-500">Alíq.</th>
                      <th className="text-right px-4 py-2 text-gray-500">Imposto</th>
                      <th className="text-right px-4 py-2 text-gray-500">Líquido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closing.byProduct.map((row, i) => (
                      <tr key={i} className="border-b border-white/5">
                        <td className="px-4 py-2.5 text-gray-200">{row.nome}</td>
                        <td className="px-4 py-2.5 text-center text-gray-400">{row.qtd}</td>
                        <td className="px-4 py-2.5 text-right text-gray-300">{formatCurrency(row.bruto)}</td>
                        <td className="px-4 py-2.5 text-right text-red-400">-{formatCurrency(row.taxas)}</td>
                        <td className="px-4 py-2.5 text-center text-amber-400">{row.aliquota}%</td>
                        <td className="px-4 py-2.5 text-right text-red-400">-{formatCurrency(row.imposto)}</td>
                        <td className="px-4 py-2.5 text-right text-emerald-400 font-medium">{formatCurrency(row.liquido)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Seção 3 — Repasse entre sócios */}
          <div className="border-b border-white/5">
            <div className="px-4 pt-4 pb-2">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Repasse entre sócios</h4>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/5 bg-gray-800/30">
                    <th className="text-left px-4 py-2 text-gray-500">Sócio</th>
                    <th className="text-center px-4 py-2 text-gray-500">%</th>
                    <th className="text-right px-4 py-2 text-gray-500">Repasse original</th>
                    <th className="text-right px-4 py-2 text-gray-500">Deduções</th>
                    <th className="text-right px-4 py-2 text-gray-500">Repasse final</th>
                  </tr>
                </thead>
                <tbody>
                  {closing.socios.map((s, i) => (
                    <tr key={i} className="border-b border-white/5">
                      <td className="px-4 py-2.5 text-gray-200 font-medium">{s.nome}</td>
                      <td className="px-4 py-2.5 text-center text-amber-400">{s.percentual.toFixed(2)}%</td>
                      <td className="px-4 py-2.5 text-right text-gray-300">{formatCurrency(s.repasse_original ?? s.valor)}</td>
                      <td className="px-4 py-2.5 text-right text-red-400">
                        {(s.deducoes ?? 0) > 0 ? `-${formatCurrency(s.deducoes!)}` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-emerald-400 font-semibold">{formatCurrency(s.repasse_final ?? s.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Seção 4 — Reembolsos e chargebacks */}
          <div className="border-b border-white/5">
            <div className="px-4 pt-4 pb-2">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Reembolsos e chargebacks</h4>
            </div>
            {closing.alertas.length === 0 ? (
              <p className="px-4 pb-4 text-xs text-gray-600">Nenhum reembolso ou chargeback registrado neste fechamento</p>
            ) : (
              <div className="overflow-x-auto pb-2">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/5 bg-gray-800/30">
                      <th className="text-left px-4 py-2 text-gray-500">Nome</th>
                      <th className="text-left px-4 py-2 text-gray-500 hidden md:table-cell">Telefone</th>
                      <th className="text-left px-4 py-2 text-gray-500 hidden md:table-cell">Email</th>
                      <th className="text-left px-4 py-2 text-gray-500">Produto</th>
                      <th className="text-right px-4 py-2 text-gray-500">Valor</th>
                      <th className="text-center px-4 py-2 text-gray-500">Tipo</th>
                      <th className="text-right px-4 py-2 text-gray-500 hidden lg:table-cell">Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closing.alertas.map((a, i) => (
                      <tr key={i} className="border-b border-white/5">
                        <td className="px-4 py-2.5 text-gray-300">{a.nome}</td>
                        <td className="px-4 py-2.5 text-gray-400 hidden md:table-cell">{a.telefone ?? '—'}</td>
                        <td className="px-4 py-2.5 text-gray-400 hidden md:table-cell">{a.email ?? '—'}</td>
                        <td className="px-4 py-2.5 text-gray-400">{a.produto}</td>
                        <td className="px-4 py-2.5 text-right text-red-400 font-semibold">-{formatCurrency(a.valor)}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                            a.tipo === 'chargeback'
                              ? 'bg-orange-500/20 text-orange-400 border-orange-500/30'
                              : 'bg-red-500/20 text-red-400 border-red-500/30'
                          }`}>
                            {a.tipo === 'chargeback' ? 'Chargeback' : 'Reembolso'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-400 hidden lg:table-cell">{formatDate(a.data)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Seção 5 — Compradores */}
          <div>
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <div>
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Lista completa de compradores</h4>
                <p className="text-[10px] text-gray-600 mt-0.5">
                  {closing.compradores.length} compradores · snapshot imutável registrado na data do fechamento
                </p>
              </div>
              <button
                onClick={exportCSV}
                className="flex items-center gap-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> Exportar CSV
              </button>
            </div>
            <div className="overflow-x-auto pb-4">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/5 bg-gray-800/30">
                    <th className="text-left px-4 py-2 text-gray-500">Nome</th>
                    <th className="text-left px-4 py-2 text-gray-500 hidden md:table-cell">Email</th>
                    <th className="text-left px-4 py-2 text-gray-500 hidden lg:table-cell">CPF</th>
                    <th className="text-left px-4 py-2 text-gray-500 hidden lg:table-cell">Telefone</th>
                    <th className="text-left px-4 py-2 text-gray-500">Produto</th>
                    <th className="text-center px-4 py-2 text-gray-500 hidden sm:table-cell">Plataforma</th>
                    <th className="text-right px-4 py-2 text-gray-500">Val. bruto</th>
                    <th className="text-right px-4 py-2 text-gray-500 hidden md:table-cell">Val. líquido</th>
                    <th className="text-right px-4 py-2 text-gray-500 hidden lg:table-cell">Data</th>
                    <th className="text-center px-4 py-2 text-gray-500">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {closing.compradores.map((b, i) => (
                    <tr key={i} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                      <td className="px-4 py-2.5 text-gray-300">{b.nome}</td>
                      <td className="px-4 py-2.5 text-gray-500 hidden md:table-cell">{b.email}</td>
                      <td className="px-4 py-2.5 text-gray-500 hidden lg:table-cell">{b.cpf}</td>
                      <td className="px-4 py-2.5 text-gray-500 hidden lg:table-cell">{b.telefone ?? '—'}</td>
                      <td className="px-4 py-2.5 text-gray-400">{b.produto}</td>
                      <td className="px-4 py-2.5 text-center hidden sm:table-cell">
                        {b.plataforma ? <PlatformBadge platform={b.plataforma as 'kiwify' | 'hubla'} /> : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-200">{formatCurrency(b.valor_bruto ?? b.valor)}</td>
                      <td className="px-4 py-2.5 text-right text-emerald-400 hidden md:table-cell">{formatCurrency(b.valor_liquido ?? b.valor)}</td>
                      <td className="px-4 py-2.5 text-right text-gray-400 hidden lg:table-cell">
                        {b.data_hora ? formatDateTime(b.data_hora) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                          b.status === 'ok'
                            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                            : b.status === 'chargeback'
                            ? 'bg-orange-500/20 text-orange-400 border-orange-500/30'
                            : 'bg-red-500/20 text-red-400 border-red-500/30'
                        }`}>
                          {b.status === 'ok' ? 'Ok' : b.status === 'chargeback' ? 'Chargeback' : 'Reembolso'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
