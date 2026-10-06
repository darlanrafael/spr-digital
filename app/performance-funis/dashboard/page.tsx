'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Space_Grotesk, Inter } from 'next/font/google'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import ProtectedRoute from '@/components/ProtectedRoute'
import PerfFunisTabs from '@/components/PerfFunisTabs'
import { formatCurrency } from '@/lib/formatters'

export const dynamic = 'force-dynamic'

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] })
const ui = Inter({ subsets: ['latin'], weight: ['400', '500', '600'] })

type FunilPerf = {
  id: string
  nome: string
  organico: boolean
  investido: number
  impressoes: number
  cliques: number
  visitas: number
  checkouts: number
  ctr: number | null
  hookRate: number | null
  custoPorCheckout: number | null
  alcanceAprox: number
}

const PRESETS = [
  { value: 'today', label: 'Hoje' },
  { value: 'last_7d', label: '7 dias' },
  { value: 'last_30d', label: '30 dias' },
] as const

const fmtNum = (n: number) => new Intl.NumberFormat('pt-BR').format(n)
const fmtPct = (n: number | null) => (n == null ? '-' : `${n.toFixed(2).replace('.', ',')}%`)
const fmtMoeda = (n: number | null) => (n == null ? '-' : formatCurrency(n))

function DashboardConteudo() {
  const router = useRouter()
  const sp = useSearchParams()
  const dateStart = sp.get('dateStart') || ''
  const dateEnd = sp.get('dateEnd') || ''
  const custom = !!(dateStart && dateEnd)
  const datePreset = custom ? '' : sp.get('datePreset') || 'last_7d'

  const [de, setDe] = useState(dateStart)
  const [ate, setAte] = useState(dateEnd)
  const [funis, setFunis] = useState<FunilPerf[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const query = custom
    ? `dateStart=${dateStart}&dateEnd=${dateEnd}`
    : `datePreset=${datePreset}`

  useEffect(() => {
    let cancelado = false
    setCarregando(true)
    setErro(null)
    fetch(`/api/funis/performance?${query}`)
      .then(async r => {
        const j = await r.json()
        if (!r.ok) throw new Error(j?.error || 'Falha ao carregar performance')
        return j
      })
      .then(j => { if (!cancelado) setFunis((j.funis || []) as FunilPerf[]) })
      .catch(e => { if (!cancelado) setErro(e instanceof Error ? e.message : 'Falha ao carregar') })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [query])

  function escolherPreset(p: string) {
    router.push(`/performance-funis/dashboard?datePreset=${p}`)
  }

  function aplicarPersonalizado() {
    if (!de || !ate) return
    const [a, b] = de <= ate ? [de, ate] : [ate, de]
    router.push(`/performance-funis/dashboard?dateStart=${a}&dateEnd=${b}`)
  }

  function abrirFunil(id: string) {
    router.push(`/performance-funis/dashboard?funilId=${id}&${query}`)
  }

  const btn = (ativo: boolean) =>
    `px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
      ativo ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-white/10 text-[#9CA3AF] hover:text-white'
    }`

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {PRESETS.map(p => (
          <button key={p.value} onClick={() => escolherPreset(p.value)} className={btn(!custom && datePreset === p.value)}>
            {p.label}
          </button>
        ))}
        <div className="flex items-center gap-2 ml-0 sm:ml-2">
          <input type="date" value={de} onChange={e => setDe(e.target.value)}
            className="bg-[#16181D] border border-white/10 rounded-lg px-2 py-1.5 text-sm" />
          <span className="text-[#9CA3AF] text-sm">até</span>
          <input type="date" value={ate} onChange={e => setAte(e.target.value)}
            className="bg-[#16181D] border border-white/10 rounded-lg px-2 py-1.5 text-sm" />
          <button onClick={aplicarPersonalizado} disabled={!de || !ate} className={`${btn(custom)} disabled:opacity-40`}>
            Aplicar
          </button>
        </div>
      </div>

      {erro && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{erro}</div>}

      {carregando ? (
        <p className="text-sm text-[#9CA3AF]">Carregando...</p>
      ) : funis.length === 0 && !erro ? (
        <p className="text-sm text-[#9CA3AF]">Nenhum funil cadastrado.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#16181D]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[#9CA3AF] border-b border-white/10">
                <th className="px-3 py-2 font-medium">Funil</th>
                <th className="px-3 py-2 font-medium text-right">Investido</th>
                <th className="px-3 py-2 font-medium text-right">Impressões</th>
                <th className="px-3 py-2 font-medium text-right">Cliques</th>
                <th className="px-3 py-2 font-medium text-right">CTR</th>
                <th className="px-3 py-2 font-medium text-right">Visitas</th>
                <th className="px-3 py-2 font-medium text-right">Checkouts</th>
                <th className="px-3 py-2 font-medium text-right">Custo/checkout</th>
              </tr>
            </thead>
            <tbody>
              {funis.map(f => (
                <tr key={f.id} onClick={() => abrirFunil(f.id)}
                  className="border-b border-white/5 last:border-0 cursor-pointer hover:bg-white/5">
                  <td className="px-3 py-2 font-medium">{f.nome}</td>
                  {f.organico ? (
                    <td colSpan={7} className="px-3 py-2 text-right text-[#9CA3AF]">sem investimento</td>
                  ) : (
                    <>
                      <td className="px-3 py-2 text-right">{fmtMoeda(f.investido)}</td>
                      <td className="px-3 py-2 text-right">{fmtNum(f.impressoes)}</td>
                      <td className="px-3 py-2 text-right">{fmtNum(f.cliques)}</td>
                      <td className="px-3 py-2 text-right">{fmtPct(f.ctr)}</td>
                      <td className="px-3 py-2 text-right">{fmtNum(f.visitas)}</td>
                      <td className="px-3 py-2 text-right">{fmtNum(f.checkouts)}</td>
                      <td className="px-3 py-2 text-right">{fmtMoeda(f.custoPorCheckout)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

export default function DashboardFunisPage() {
  return (
    <ProtectedRoute>
      <div className={`min-h-screen bg-[#0E0F13] text-[#F4F5F7] ${ui.className}`}>
        <Header />
        <main className="max-w-screen-xl mx-auto px-4 pt-6 pb-24 md:pb-10">
          <PerfFunisTabs />
          <h1 className={`text-xl font-semibold mb-4 ${display.className}`}>Visão geral</h1>
          <Suspense fallback={<p className="text-sm text-[#9CA3AF]">Carregando...</p>}>
            <DashboardConteudo />
          </Suspense>
        </main>
        <MobileNav />
      </div>
    </ProtectedRoute>
  )
}
