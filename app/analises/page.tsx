'use client'

import { useState } from 'react'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import ProtectedRoute from '@/components/ProtectedRoute'

type Inputs = {
  investimento: string
  cpm: string
  ctr: string
  connectRate: string
  taxaConversao: string
  ticketMedio: string
}

type Metrics = {
  impressoes: number | null
  cliques: number | null
  cpc: number | null
  visitasReais: number | null
  compras: number | null
  cpa: number | null
  faturamento: number | null
  roas: number | null
}

const EMPTY: Inputs = {
  investimento: '',
  cpm: '',
  ctr: '',
  connectRate: '',
  taxaConversao: '',
  ticketMedio: '',
}

function parseNum(val: string): number | null {
  const s = val.trim()
  if (!s) return null
  const normalized = s.includes(',')
    ? s.replace(/\./g, '').replace(',', '.')
    : s
  const n = parseFloat(normalized)
  return isNaN(n) || !isFinite(n) ? null : n
}

function calcMetrics(inp: Inputs): Metrics {
  const inv = parseNum(inp.investimento)
  const cpm = parseNum(inp.cpm)
  const ctr = parseNum(inp.ctr)
  const cr = parseNum(inp.connectRate)
  const tc = parseNum(inp.taxaConversao)
  const tm = parseNum(inp.ticketMedio)

  const impressoes = inv !== null && cpm !== null && cpm > 0 ? (inv / cpm) * 1000 : null
  const cliques = impressoes !== null && ctr !== null ? impressoes * (ctr / 100) : null
  const cpc = inv !== null && cliques !== null && cliques > 0 ? inv / cliques : null
  const visitasReais = cliques !== null && cr !== null ? cliques * (cr / 100) : null
  const compras = visitasReais !== null && tc !== null ? Math.floor(visitasReais * (tc / 100)) : null
  const cpa = inv !== null && compras !== null && compras > 0 ? inv / compras : null
  const faturamento = compras !== null && tm !== null ? compras * tm : null
  const roas = faturamento !== null && inv !== null && inv > 0 ? faturamento / inv : null

  return { impressoes, cliques, cpc, visitasReais, compras, cpa, faturamento, roas }
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('pt-BR')
}

function fmtBRL(n: number): string {
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtROAS(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + 'x'
}

type VariResult = { pct: number; good: boolean } | null

function getVariacao(real: number | null, proj: number | null, lowerIsBetter: boolean): VariResult {
  if (real === null || proj === null || real === 0) return null
  const diff = proj - real
  if (Math.abs(diff) < 0.0001) return null
  const pct = (Math.abs(diff) / Math.abs(real)) * 100
  const good = lowerIsBetter ? proj < real : proj > real
  return { pct, good }
}

function VariBadge({ v }: { v: VariResult }) {
  if (!v) return <span className="text-gray-500 text-xs">–</span>
  const pct = v.pct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'
  return v.good
    ? <span className="text-green-500 text-xs">↑ {pct}</span>
    : <span className="text-red-400 text-xs">↓ {pct}</span>
}

export default function AnalisesPage() {
  return (
    <ProtectedRoute>
      <AnalisesContent />
    </ProtectedRoute>
  )
}

function AnalisesContent() {
  const [real, setReal] = useState<Inputs>(EMPTY)
  const [proj, setProj] = useState<Inputs>(EMPTY)

  const realM = calcMetrics(real)
  const projM = calcMetrics(proj)

  function setRealField(key: keyof Inputs, val: string) {
    setReal(prev => ({ ...prev, [key]: val }))
  }

  function setProjField(key: keyof Inputs, val: string) {
    setProj(prev => ({ ...prev, [key]: val }))
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-24 md:pb-8">
      <Header />
      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-white">Análises e Projeções</h1>
          <p className="text-sm text-gray-400 mt-1">Calculadora de métricas de tráfego Meta Ads</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SectionCard
            title="Dados Reais"
            subtitle="Preencha com os dados reais da sua campanha"
            inputs={real}
            onField={setRealField}
            metrics={realM}
          />
          <SectionCard
            title="Projeção"
            subtitle="Ajuste os pontos de alavanca e veja o impacto em cascata"
            inputs={proj}
            onField={setProjField}
            metrics={projM}
            realMetrics={realM}
            onCopy={() => setProj({ ...real })}
          />
        </div>
      </main>
      <MobileNav />
    </div>
  )
}

interface SectionProps {
  title: string
  subtitle: string
  inputs: Inputs
  onField: (key: keyof Inputs, val: string) => void
  metrics: Metrics
  realMetrics?: Metrics
  onCopy?: () => void
}

const INPUT_FIELDS: { key: keyof Inputs; label: string; placeholder: string }[] = [
  { key: 'investimento', label: 'Investimento (R$)', placeholder: 'Ex: 5.000,00' },
  { key: 'cpm',          label: 'CPM (R$)',           placeholder: 'Ex: 180,00' },
  { key: 'ctr',          label: 'CTR (%)',             placeholder: 'Ex: 1,80' },
  { key: 'connectRate',  label: 'Connect Rate (%)',    placeholder: 'Ex: 70' },
  { key: 'taxaConversao', label: 'Taxa de conversão (%)', placeholder: 'Ex: 3' },
  { key: 'ticketMedio',  label: 'Ticket médio (R$)',   placeholder: 'Ex: 197,00' },
]

function SectionCard({ title, subtitle, inputs, onField, metrics: m, realMetrics: r, onCopy }: SectionProps) {
  const isProj = !!r

  const roasVal = m.roas
  const roasPositive = roasVal !== null && roasVal >= 1
  const roasNegative = roasVal !== null && roasVal > 0 && roasVal < 1
  const roasColor = roasPositive ? 'text-green-500' : roasNegative ? 'text-red-400' : 'text-gray-500'
  const roasLabel = roasPositive ? 'ROAS Positivo' : roasNegative ? 'ROAS Negativo' : null

  type CardDef = {
    label: string
    value: string | null
    lowerIsBetter: boolean
    realVal: number | null
    projVal: number | null
  }

  const cards: CardDef[] = [
    { label: 'Impressões',   value: m.impressoes  !== null ? fmtInt(m.impressoes)  : null, lowerIsBetter: false, realVal: r?.impressoes  ?? null, projVal: m.impressoes },
    { label: 'Cliques',      value: m.cliques     !== null ? fmtInt(m.cliques)     : null, lowerIsBetter: false, realVal: r?.cliques     ?? null, projVal: m.cliques },
    { label: 'CPC',          value: m.cpc         !== null ? fmtBRL(m.cpc)         : null, lowerIsBetter: true,  realVal: r?.cpc         ?? null, projVal: m.cpc },
    { label: 'Visitas reais',value: m.visitasReais !== null ? fmtInt(m.visitasReais): null, lowerIsBetter: false, realVal: r?.visitasReais ?? null, projVal: m.visitasReais },
    { label: 'Compras',      value: m.compras     !== null ? m.compras.toLocaleString('pt-BR') : null, lowerIsBetter: false, realVal: r?.compras ?? null, projVal: m.compras },
    { label: 'CPA',          value: m.cpa         !== null ? fmtBRL(m.cpa)         : null, lowerIsBetter: true,  realVal: r?.cpa         ?? null, projVal: m.cpa },
    { label: 'Faturamento',  value: m.faturamento !== null ? fmtBRL(m.faturamento) : null, lowerIsBetter: false, realVal: r?.faturamento ?? null, projVal: m.faturamento },
  ]

  return (
    <div className="bg-gray-900 border border-white/10 rounded-xl p-5 flex flex-col gap-5">
      {/* Card header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
        </div>
        {onCopy && (
          <button
            onClick={onCopy}
            className="shrink-0 flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 px-3 py-1.5 rounded-lg transition-colors"
          >
            ↙ Copiar da Seção 1
          </button>
        )}
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {INPUT_FIELDS.map(({ key, label, placeholder }) => (
          <div key={key} className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">{label}</label>
            <input
              type="text"
              inputMode="decimal"
              value={inputs[key]}
              onChange={e => onField(key, e.target.value)}
              placeholder={placeholder}
              className="bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500/50 transition-colors"
            />
          </div>
        ))}
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-3">
        {cards.map(({ label, value, lowerIsBetter, realVal, projVal }) => {
          const variation = isProj ? getVariacao(realVal, projVal, lowerIsBetter) : null
          return (
            <div key={label} className="bg-gray-800/60 border border-white/10 rounded-lg p-3 flex flex-col gap-0.5">
              <span className="text-xs text-gray-500">{label}</span>
              <span className={`text-sm font-semibold ${value !== null ? 'text-white' : 'text-gray-500'}`}>
                {value ?? '–'}
              </span>
              {isProj && <VariBadge v={variation} />}
            </div>
          )
        })}

        {/* ROAS — destaque maior */}
        <div className="bg-gray-800/60 border border-white/10 rounded-lg p-3 flex flex-col gap-0.5">
          <span className="text-xs text-gray-500">ROAS</span>
          <span className={`text-2xl font-bold ${roasColor}`}>
            {roasVal !== null ? fmtROAS(roasVal) : '–'}
          </span>
          {roasLabel && (
            <span className={`text-xs ${roasColor}`}>{roasLabel}</span>
          )}
          {isProj && <VariBadge v={getVariacao(r?.roas ?? null, m.roas, false)} />}
        </div>
      </div>
    </div>
  )
}
