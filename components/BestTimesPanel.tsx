'use client'

import { useMemo, useState } from 'react'
import { Sale } from '@/types'
import {
  calcDayStats, calcHourStats, formatCurrency,
  getPrevMonthRange, DayStat, HourStat,
} from '@/lib/formatters'

interface PanelProps {
  label: string
  sales: Sale[]
  start: string
  end: string
  onStartChange: (v: string) => void
  onEndChange: (v: string) => void
  compareBestDay?: number | null
  compareBestHour?: string | null
}

function Panel({ label, sales, start, end, onStartChange, onEndChange, compareBestDay, compareBestHour }: PanelProps) {
  const dayStats = useMemo(() => calcDayStats(sales), [sales])
  const hourStats = useMemo(() => calcHourStats(sales), [sales])

  const bestDay = dayStats[0]?.dayIndex ?? null
  const bestHour = hourStats[0]?.rangeLabel ?? null
  const maxDayBruto = dayStats[0]?.bruto ?? 1
  const maxHourBruto = hourStats[0]?.bruto ?? 1

  const dayChanged = compareBestDay !== undefined && compareBestDay !== null && bestDay !== null && bestDay !== compareBestDay
  const hourChanged = compareBestHour !== undefined && compareBestHour !== null && bestHour !== null && bestHour !== compareBestHour

  return (
    <div className="bg-gray-900 rounded-xl border border-white/10 p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-semibold text-white">{label}</h4>
        <div className="flex items-center gap-1.5">
          <input
            type="date" value={start} onChange={e => onStartChange(e.target.value)}
            className="bg-gray-800 border border-white/10 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-indigo-500"
          />
          <span className="text-gray-600 text-xs">–</span>
          <input
            type="date" value={end} onChange={e => onEndChange(e.target.value)}
            className="bg-gray-800 border border-white/10 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {sales.length === 0 ? (
        <p className="text-xs text-gray-600 text-center py-6">Nenhuma venda no período</p>
      ) : (
        <div className="space-y-4">
          {/* Best days */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500 font-medium">Melhores dias da semana</span>
              {compareBestDay !== undefined && bestDay !== null && (
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                  dayChanged
                    ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                    : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                }`}>
                  {dayChanged ? 'Mudou' : 'Manteve'}
                </span>
              )}
            </div>
            <div className="space-y-1.5">
              {dayStats.map((d, i) => (
                <div key={d.dayIndex} className="flex items-center gap-2">
                  <span className={`w-5 text-[10px] font-bold ${i === 0 ? 'text-amber-400' : 'text-gray-600'}`}>
                    {i === 0 ? '🥇' : `${i + 1}°`}
                  </span>
                  <span className="w-8 text-xs text-gray-400">{d.label}</span>
                  <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${i === 0 ? 'bg-amber-400' : 'bg-indigo-600/50'}`}
                      style={{ width: `${maxDayBruto > 0 ? (d.bruto / maxDayBruto) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-400 w-12 text-right">{d.qtd}v</span>
                  <span className="text-xs text-gray-300 w-24 text-right">{formatCurrency(d.bruto)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Best hours */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500 font-medium">Melhores horários</span>
              {compareBestHour !== undefined && bestHour !== null && (
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                  hourChanged
                    ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                    : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                }`}>
                  {hourChanged ? 'Mudou' : 'Manteve'}
                </span>
              )}
            </div>
            <div className="space-y-1.5">
              {hourStats.map((h, i) => (
                <div key={h.rangeLabel} className="flex items-center gap-2">
                  <span className={`w-5 text-[10px] font-bold ${i === 0 ? 'text-amber-400' : 'text-gray-600'}`}>
                    {i === 0 ? '🥇' : `${i + 1}°`}
                  </span>
                  <span className="w-16 text-xs text-gray-400">{h.rangeLabel}</span>
                  <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${i === 0 ? 'bg-amber-400' : 'bg-purple-600/50'}`}
                      style={{ width: `${maxHourBruto > 0 ? (h.bruto / maxHourBruto) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-400 w-12 text-right">{h.qtd}v</span>
                  <span className="text-xs text-gray-300 w-24 text-right">{formatCurrency(h.bruto)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface BestTimesComparisonProps {
  allSales: Sale[]
  defaultAStart: string
  defaultAEnd: string
}

export default function BestTimesComparison({ allSales, defaultAStart, defaultAEnd }: BestTimesComparisonProps) {
  const [aStart, setAStart] = useState(defaultAStart)
  const [aEnd, setAEnd] = useState(defaultAEnd)
  const prev = getPrevMonthRange()
  const [bStart, setBStart] = useState(prev.start)
  const [bEnd, setBEnd] = useState(prev.end)

  const salesA = useMemo(() =>
    allSales.filter(s => s.status === 'aprovado' && s.data_hora.slice(0, 10) >= aStart && s.data_hora.slice(0, 10) <= aEnd),
    [allSales, aStart, aEnd]
  )
  const salesB = useMemo(() =>
    allSales.filter(s => s.status === 'aprovado' && s.data_hora.slice(0, 10) >= bStart && s.data_hora.slice(0, 10) <= bEnd),
    [allSales, bStart, bEnd]
  )

  const dayStatsA = useMemo(() => calcDayStats(salesA), [salesA])
  const dayStatsB = useMemo(() => calcDayStats(salesB), [salesB])
  const hourStatsA = useMemo(() => calcHourStats(salesA), [salesA])
  const hourStatsB = useMemo(() => calcHourStats(salesB), [salesB])

  const bestDayA = dayStatsA[0]?.dayIndex ?? null
  const bestDayB = dayStatsB[0]?.dayIndex ?? null
  const bestHourA = hourStatsA[0]?.rangeLabel ?? null
  const bestHourB = hourStatsB[0]?.rangeLabel ?? null

  return (
    <div className="bg-gray-900 rounded-xl border border-white/10 mb-6">
      <div className="p-4 border-b border-white/10">
        <h3 className="text-sm font-semibold text-white">Melhores Dias e Horários de Venda</h3>
        <p className="text-xs text-gray-500 mt-0.5">Compare dois períodos — cada painel tem seletor independente</p>
      </div>
      <div className="p-4 grid md:grid-cols-2 gap-4">
        <Panel
          label="Período A"
          sales={salesA}
          start={aStart} end={aEnd}
          onStartChange={setAStart} onEndChange={setAEnd}
          compareBestDay={bestDayB}
          compareBestHour={bestHourB}
        />
        <Panel
          label="Período B"
          sales={salesB}
          start={bStart} end={bEnd}
          onStartChange={setBStart} onEndChange={setBEnd}
          compareBestDay={bestDayA}
          compareBestHour={bestHourA}
        />
      </div>
    </div>
  )
}
