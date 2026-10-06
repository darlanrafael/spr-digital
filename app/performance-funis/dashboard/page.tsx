'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Space_Grotesk, Inter } from 'next/font/google'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import ProtectedRoute from '@/components/ProtectedRoute'
import PerfFunisTabs from '@/components/PerfFunisTabs'
import { formatCurrency } from '@/lib/formatters'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

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

function VisaoGeral() {
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
  const [aviso, setAviso] = useState<string | null>(null)

  const query = custom
    ? `dateStart=${dateStart}&dateEnd=${dateEnd}`
    : `datePreset=${datePreset}`

  useEffect(() => {
    let cancelado = false
    setCarregando(true)
    setErro(null)
    setAviso(null)
    fetch(`/api/funis/performance?${query}`)
      .then(async r => {
        const j = await r.json()
        if (!r.ok) throw new Error(j?.error || 'Falha ao carregar performance')
        return j
      })
      .then(j => { if (cancelado) return; setFunis((j.funis || []) as FunilPerf[]); setAviso(j.aviso ?? null) })
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

      {aviso && <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">{aviso}</div>}
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

type Criativo = {
  campanha: string
  criativo: string
  thumbnail: string | null
  spend: number
  inlineLinkClicks: number
  isVideo: boolean
  ctr: number | null
  hookRate: number | null
}
type Cadencia = { data: string; investido: number; cliques: number }

const fmtDia = (d: string) => {
  const [, m, dia] = d.slice(0, 10).split('-')
  return `${dia}/${m}`
}
const passagem = (num: number, den: number) =>
  den > 0 ? `${((num / den) * 100).toFixed(2).replace('.', ',')}%` : '-'

function DetalheFunil({ funilId }: { funilId: string }) {
  const router = useRouter()
  const sp = useSearchParams()
  const dateStart = sp.get('dateStart') || ''
  const dateEnd = sp.get('dateEnd') || ''
  const custom = !!(dateStart && dateEnd)
  const query = custom ? `dateStart=${dateStart}&dateEnd=${dateEnd}` : `datePreset=${sp.get('datePreset') || 'last_7d'}`

  const [funil, setFunil] = useState<FunilPerf | null>(null)
  const [criativos, setCriativos] = useState<Criativo[]>([])
  const [cadencia, setCadencia] = useState<Cadencia[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    setCarregando(true)
    setErro(null)
    setAviso(null)
    fetch(`/api/funis/performance?funilId=${encodeURIComponent(funilId)}&${query}`)
      .then(async r => {
        const j = await r.json()
        if (!r.ok) throw new Error(j?.error || 'Falha ao carregar o funil')
        return j
      })
      .then(j => {
        if (cancelado) return
        setFunil((j.funil || null) as FunilPerf | null)
        setCriativos((j.criativos || []) as Criativo[])
        setCadencia((j.cadencia || []) as Cadencia[])
        setAviso(j.aviso ?? null)
      })
      .catch(e => { if (!cancelado) setErro(e instanceof Error ? e.message : 'Falha ao carregar') })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [funilId, query])

  const voltar = () => router.push(`/performance-funis/dashboard?${query}`)
  const card = 'rounded-xl border border-white/10 bg-[#16181D] p-4'

  const etapas = funil
    ? [
        { nome: 'Impressões', valor: funil.impressoes, pass: null as string | null },
        { nome: 'Cliques', valor: funil.cliques, pass: passagem(funil.cliques, funil.impressoes) },
        { nome: 'Visitas', valor: funil.visitas, pass: passagem(funil.visitas, funil.cliques) },
        { nome: 'Checkouts', valor: funil.checkouts, pass: passagem(funil.checkouts, funil.visitas) },
      ]
    : []

  return (
    <>
      <button onClick={voltar} className="mb-4 px-3 py-1.5 rounded-lg text-sm font-medium border border-white/10 text-[#9CA3AF] hover:text-white">
        ← Voltar para a visão geral
      </button>
      {aviso && <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">{aviso}</div>}
      {erro && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{erro}</div>}
      {carregando ? (
        <p className="text-sm text-[#9CA3AF]">Carregando...</p>
      ) : !funil ? (
        !erro && <p className="text-sm text-[#9CA3AF]">Funil não encontrado.</p>
      ) : (
        <div className="space-y-5">
          <h2 className={`text-lg font-semibold ${display.className}`}>{funil.nome}</h2>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { l: 'Investido', v: fmtMoeda(funil.investido) },
              { l: 'CTR', v: fmtPct(funil.ctr) },
              { l: 'Hook Rate', v: fmtPct(funil.hookRate) },
              { l: 'Custo/checkout', v: fmtMoeda(funil.custoPorCheckout) },
            ].map(c => (
              <div key={c.l} className={card}>
                <div className="text-xs text-[#9CA3AF] mb-1">{c.l}</div>
                <div className={`text-xl font-semibold ${display.className}`}>{c.v}</div>
              </div>
            ))}
          </div>

          <section className={card}>
            <h3 className="text-sm font-medium text-[#9CA3AF] mb-3">Etapas do funil</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {etapas.map(e => (
                <div key={e.nome} className="rounded-lg bg-white/5 p-3">
                  <div className="text-xs text-[#9CA3AF]">{e.nome}</div>
                  <div className={`text-lg font-semibold ${display.className}`}>{fmtNum(e.valor)}</div>
                  <div className="text-xs text-[#9CA3AF] mt-1">
                    {e.pass == null ? `Alcance aprox.: ${fmtNum(funil.alcanceAprox)}` : `${e.pass} da etapa anterior`}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className={card}>
            <h3 className="text-sm font-medium text-[#9CA3AF] mb-3">Investido por dia</h3>
            {cadencia.length === 0 ? (
              <p className="text-sm text-[#9CA3AF]">Sem dados no período.</p>
            ) : (
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer>
                  <LineChart data={cadencia} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="data" tickFormatter={fmtDia} tick={{ fill: '#9CA3AF', fontSize: 12 }} stroke="rgba(255,255,255,0.1)" />
                    <YAxis domain={[0, 'auto']} tickFormatter={(v: number) => formatCurrency(v)} tick={{ fill: '#9CA3AF', fontSize: 12 }} stroke="rgba(255,255,255,0.1)" width={80} />
                    <Tooltip
                      formatter={(v: unknown) => [formatCurrency(Number(v)), 'Investido']}
                      labelFormatter={(l: unknown) => fmtDia(String(l))}
                      contentStyle={{ background: '#0E0F13', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
                      labelStyle={{ color: '#9CA3AF' }}
                    />
                    <Line type="monotone" dataKey="investido" stroke="#34D399" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          <section className="overflow-x-auto rounded-xl border border-white/10 bg-[#16181D]">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[#9CA3AF] border-b border-white/10">
                  <th className="px-3 py-2 font-medium">Criativo</th>
                  <th className="px-3 py-2 font-medium">Campanha</th>
                  <th className="px-3 py-2 font-medium text-right">Investido</th>
                  <th className="px-3 py-2 font-medium text-right">CTR</th>
                  <th className="px-3 py-2 font-medium text-right">Hook Rate</th>
                  <th className="px-3 py-2 font-medium text-right">Cliques</th>
                </tr>
              </thead>
              <tbody>
                {criativos.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-3 text-[#9CA3AF]">Nenhum criativo no período.</td></tr>
                )}
                {criativos.map((c, i) => (
                  <tr key={`${c.campanha}-${c.criativo}-${i}`} className="border-b border-white/5 last:border-0">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        {c.thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.thumbnail} alt="" className="h-10 w-10 rounded object-cover bg-white/5" />
                        ) : (
                          <div className="h-10 w-10 rounded bg-white/5 flex items-center justify-center text-[#9CA3AF] text-xs">-</div>
                        )}
                        <span className="font-medium">{c.criativo}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-[#9CA3AF]">{c.campanha}</td>
                    <td className="px-3 py-2 text-right">{fmtMoeda(c.spend)}</td>
                    <td className="px-3 py-2 text-right">{fmtPct(c.ctr)}</td>
                    <td className="px-3 py-2 text-right">{c.isVideo ? fmtPct(c.hookRate) : '-'}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(c.inlineLinkClicks)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </>
  )
}

function DashboardConteudo() {
  const funilId = useSearchParams().get('funilId')
  return funilId ? <DetalheFunil funilId={funilId} /> : <VisaoGeral />
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
