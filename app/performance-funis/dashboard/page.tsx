'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Space_Grotesk, Inter } from 'next/font/google'
import { Trophy, Video, Image as ImageIcon, Info, TrendingUp } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import ProtectedRoute from '@/components/ProtectedRoute'
import PerfFunisTabs from '@/components/PerfFunisTabs'
import { formatCurrency } from '@/lib/formatters'

export const dynamic = 'force-dynamic'

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] })
const ui = Inter({ subsets: ['latin'], weight: ['400', '500', '600'] })

type FunilItem = { id: string; nome: string; termos_campanha: string[] | null }
type FunilAgg = {
  id: string; nome: string; organico: boolean
  investido: number; impressoes: number; cliques: number; visitas: number; checkouts: number
  ctr: number | null; hookRate: number | null; custoPorCheckout: number | null; alcanceAprox: number
}
type Criativo = {
  anuncio: string; criativo: string; campanha: string; thumbnail: string | null
  spend: number; inlineLinkClicks: number; isVideo: boolean; ctr: number | null; hookRate: number | null
}
type PontoDia = { data: string; investido: number }

const CARD = 'rounded-2xl border border-white/10 bg-[#15171D]'
const EMPTY = '—'
const int = (n: number) => new Intl.NumberFormat('pt-BR').format(Math.round(n))
const brl = (n: number) => formatCurrency(n)
const pctN = (n: number | null) => (n == null ? EMPTY : `${n.toFixed(2).replace('.', ',')}%`)
const pctFrac = (num: number, den: number) => (den > 0 ? `${(num / den * 100).toFixed(2).replace('.', ',')}%` : EMPTY)
const fmtDiaBR = (iso: string) => (iso ? iso.slice(5).split('-').reverse().join('/') : '')
const TOP_CRIATIVOS = 15

const PRESETS = [
  { value: 'today', label: 'Hoje' },
  { value: 'last_7d', label: '7 dias' },
  { value: 'last_30d', label: '30 dias' },
] as const

// ---------------------------------------------------------------------------
function Conteudo() {
  const router = useRouter()
  const sp = useSearchParams()
  const dateStart = sp.get('dateStart') || ''
  const dateEnd = sp.get('dateEnd') || ''
  const custom = !!(dateStart && dateEnd)
  const datePreset = custom ? '' : sp.get('datePreset') || 'last_7d'
  const query = custom ? `dateStart=${dateStart}&dateEnd=${dateEnd}` : `datePreset=${datePreset}`
  const funilId = sp.get('funilId') || ''

  const [de, setDe] = useState(dateStart)
  const [ate, setAte] = useState(dateEnd)
  const [funis, setFunis] = useState<FunilItem[]>([])
  const [listaCarregada, setListaCarregada] = useState(false)

  const [funil, setFunil] = useState<FunilAgg | null>(null)
  const [criativos, setCriativos] = useState<Criativo[]>([])
  const [cadencia, setCadencia] = useState<PontoDia[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [verTudo, setVerTudo] = useState(false)

  // Lista de funis (chips) - do banco, instantâneo.
  useEffect(() => {
    let cancelado = false
    fetch('/api/funis')
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Falha'); return j })
      .then((lista: FunilItem[]) => {
        if (cancelado) return
        setFunis(lista); setListaCarregada(true)
        if (!funilId && lista.length) selecionar(lista[0].id)
      })
      .catch(() => { if (!cancelado) setListaCarregada(true) })
    return () => { cancelado = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Dados do funil selecionado (Meta, cacheado na rota).
  useEffect(() => {
    if (!funilId) { setFunil(null); setCriativos([]); setCadencia([]); return }
    let cancelado = false
    setCarregando(true); setErro(null); setVerTudo(false)
    fetch(`/api/funis/performance?funilId=${funilId}&${query}`)
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Falha ao carregar'); return j })
      .then(j => { if (cancelado) return; setFunil(j.funil); setCriativos(j.criativos || []); setCadencia(j.cadencia || []); setAviso(j.aviso ?? null) })
      .catch(e => { if (!cancelado) setErro(e instanceof Error ? e.message : 'Falha ao carregar') })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [funilId, query])

  function selecionar(id: string) { router.push(`/performance-funis/dashboard?funilId=${id}&${query}`) }
  function trocarPreset(p: string) { router.push(`/performance-funis/dashboard?${funilId ? `funilId=${funilId}&` : ''}datePreset=${p}`) }
  function aplicarPersonalizado() {
    if (!de || !ate) return
    const [a, b] = de <= ate ? [de, ate] : [ate, de]
    router.push(`/performance-funis/dashboard?${funilId ? `funilId=${funilId}&` : ''}dateStart=${a}&dateEnd=${b}`)
  }

  const criativosVisiveis = verTudo ? criativos : criativos.slice(0, TOP_CRIATIVOS)

  return (
    <>
      {/* Cabeçalho + período */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className={`${display.className} text-2xl font-bold tracking-tight`}>Performance de Funis</h1>
          <p className="mt-1 text-sm text-[#9CA3AF]">Do clique no anúncio ao checkout, por funil.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-white/10 bg-[#181A20] p-0.5">
            {PRESETS.map(p => (
              <button key={p.value} onClick={() => trocarPreset(p.value)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  !custom && datePreset === p.value ? 'bg-white/10 text-white' : 'text-[#9CA3AF] hover:text-white'}`}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#181A20] px-2 py-1">
            <input type="date" value={de} max={ate || undefined} onChange={e => setDe(e.target.value)}
              className="bg-transparent text-xs text-white [color-scheme:dark] outline-none" />
            <span className="text-[#6b7280] text-xs">→</span>
            <input type="date" value={ate} min={de || undefined} onChange={e => setAte(e.target.value)}
              className="bg-transparent text-xs text-white [color-scheme:dark] outline-none" />
            <button onClick={aplicarPersonalizado} disabled={!de || !ate}
              className="ml-1 text-xs font-medium text-indigo-300 disabled:opacity-40 hover:text-indigo-200">ok</button>
          </div>
        </div>
      </div>

      {/* Chips dos funis */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {funis.map(x => (
          <button key={x.id} onClick={() => selecionar(x.id)}
            className={`px-3.5 py-2 text-sm font-medium rounded-lg border transition-colors ${
              x.id === funilId
                ? 'border-orange-500/60 bg-orange-500/10 text-orange-300'
                : 'border-white/10 bg-[#181A20] text-[#9CA3AF] hover:text-white hover:border-white/20'}`}>
            {x.nome}
          </button>
        ))}
        {listaCarregada && funis.length === 0 && (
          <span className="text-sm text-[#9CA3AF]">Nenhum funil cadastrado. Crie um na aba Funis.</span>
        )}
      </div>

      {aviso && <div className="mt-5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">{aviso}</div>}
      {erro && <div className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{erro}</div>}

      {!funilId ? null : carregando ? (
        <div className={`${CARD} mt-6 p-10 text-center text-sm text-[#9CA3AF]`}>Carregando os dados da Meta...</div>
      ) : !funil ? null : funil.organico ? (
        <div className={`${CARD} mt-6 p-10 text-center text-sm text-[#9CA3AF]`}>Este funil é orgânico (sem termos de campanha), então não há dados de anúncios na Meta.</div>
      ) : (
        <>
          {/* Corpo: funil (esquerda) + resultado (direita) */}
          <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[1.15fr_1fr]">
            {/* FUNIL */}
            <section className={`${CARD} p-5 sm:p-7`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className={`${display.className} text-lg font-semibold`}>Funil de anúncios</div>
                  <div className="text-xs text-[#9CA3AF]">{funil.nome}</div>
                </div>
              </div>
              <div className="relative mt-6">
                <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  <defs>
                    <linearGradient id="funnelFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.10" />
                      <stop offset="100%" stopColor="#EA580C" stopOpacity="0.20" />
                    </linearGradient>
                  </defs>
                  <polygon points="3,0 97,0 63,100 37,100" fill="url(#funnelFill)" stroke="rgba(249,115,22,0.22)" strokeWidth="0.4" />
                </svg>
                <div className="relative z-10 flex flex-col items-center gap-2">
                  <FunnelStage label="Impressões" value={int(funil.impressoes)} width={100} />
                  <ConvPill rate={pctFrac(funil.cliques, funil.impressoes)} name="Taxa de clique" width={90} tone={0} />
                  <FunnelStage label="Cliques no link" value={int(funil.cliques)} width={78} />
                  <ConvPill rate={pctFrac(funil.visitas, funil.cliques)} name="Carregamento da página" width={64} tone={1} />
                  <FunnelStage label="Visitas à página" value={int(funil.visitas)} width={58} />
                  <ConvPill rate={pctFrac(funil.checkouts, funil.visitas)} name="Ida ao checkout" width={48} tone={2} />
                  <FunnelStage label="Checkouts" value={int(funil.checkouts)} width={46} checkout />
                </div>
              </div>
              <div className="mt-4 text-[11px] text-[#8A90A0]">Alcance aprox.: {int(funil.alcanceAprox)} pessoas (soma por campanha).</div>
            </section>

            {/* RESULTADO */}
            <section className={`${CARD} p-5 sm:p-7 flex flex-col`}>
              <div className={`${display.className} text-lg font-semibold`}>Resultado</div>
              <div className="text-xs text-[#9CA3AF]">O que o funil deixa depois de tudo</div>

              <div className="mt-5 space-y-1.5">
                <WaterRow label="Faturamento bruto" value={EMPTY} strong />
                <WaterRow label="− Taxas da plataforma" value={EMPTY} deduz />
                <WaterRow label="− Investimento em tráfego" value={`− ${brl(funil.investido)}`} deduz />
                <WaterRow label="− Impostos operação" value={EMPTY} deduz />
                <div className="my-2 h-px bg-white/10" />
                <WaterRow label="= Total líquido após deduções" value={EMPTY} strong />
              </div>

              <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#C9CED8]">Resultado líquido</span>
                  <TrendingUp className="w-4 h-4 text-[#6b7280]" />
                </div>
                <div className={`${display.className} mt-1 text-3xl font-bold text-[#6b7280]`}>{EMPTY}</div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3">
                <Kpi label="ROAS" value={EMPTY} hint="na 2C" />
                <Kpi label="Margem líquida" value={EMPTY} hint="na 2C" />
                <Kpi label="Investido" value={brl(funil.investido)} hint="Tráfego Meta" />
              </div>

              <div className="mt-4 flex items-start gap-2 rounded-lg bg-white/[0.03] px-3 py-2 text-[11px] text-[#8A90A0]">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>Faturamento, vendas, ROAS e margem entram na Fase 2C (dados reais do banco). Aqui estão os números de anúncios da Meta.</span>
              </div>
            </section>
          </div>

          {/* CRIATIVOS */}
          <section className={`${CARD} mt-5 p-5 sm:p-7`}>
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-400" />
              <div className={`${display.className} text-lg font-semibold`}>Criativos</div>
            </div>
            <div className="text-xs text-[#9CA3AF]">Anúncios do funil, do maior investimento para o menor.</div>

            {criativos.length === 0 ? (
              <div className="mt-4 text-sm text-[#9CA3AF]">Nenhum anúncio no período.</div>
            ) : (
              <div className="mt-5 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-[11px] uppercase tracking-wide text-[#8A90A0]">
                      <th className="py-2 pr-3 text-left font-medium w-8">#</th>
                      <th className="py-2 px-2 text-left font-medium">Anúncio</th>
                      <th className="py-2 px-3 text-left font-medium">Formato</th>
                      <th className="py-2 px-3 text-right font-medium">Investido</th>
                      <th className="py-2 px-3 text-right font-medium">Cliques</th>
                      <th className="py-2 px-3 text-right font-medium">CTR</th>
                      <th className="py-2 pl-3 text-right font-medium">Hook Rate</th>
                    </tr>
                  </thead>
                  <tbody className={display.className}>
                    {criativosVisiveis.map((cr, i) => {
                      const top = i === 0
                      return (
                        <tr key={`${cr.anuncio}-${i}`} className="border-b border-white/5 last:border-0"
                          style={top ? { background: 'rgba(245,158,11,0.05)' } : undefined}>
                          <td className="py-3 pr-3">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold"
                              style={{ background: top ? 'linear-gradient(135deg,#FBBF24,#EA580C)' : 'rgba(255,255,255,0.08)', color: top ? '#1a0f00' : '#C9CED8' }}>
                              {i + 1}
                            </span>
                          </td>
                          <td className="py-3 px-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              {cr.thumbnail
                                ? <img src={cr.thumbnail} alt="" className="h-9 w-9 rounded-md object-cover shrink-0 border border-white/10" />
                                : <div className="h-9 w-9 rounded-md bg-white/5 shrink-0" />}
                              <div className="min-w-0">
                                <div className={`${ui.className} font-medium text-white truncate max-w-[260px]`}>{cr.anuncio || cr.criativo || '-'}</div>
                                <div className={`${ui.className} text-[11px] text-[#6B7280] truncate max-w-[260px]`}>{cr.campanha}</div>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <span className={`${ui.className} inline-flex items-center gap-1.5 text-[#9CA3AF]`}>
                              {cr.isVideo ? <Video className="w-3.5 h-3.5 text-orange-300/70" /> : <ImageIcon className="w-3.5 h-3.5 text-sky-300/70" />}
                              {cr.isVideo ? 'Vídeo' : 'Imagem'}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums text-[#C9CED8]">{brl(cr.spend)}</td>
                          <td className="py-3 px-3 text-right tabular-nums font-semibold text-white">{int(cr.inlineLinkClicks)}</td>
                          <td className="py-3 px-3 text-right tabular-nums text-[#C9CED8]">{pctN(cr.ctr)}</td>
                          <td className="py-3 pl-3 text-right tabular-nums text-[#C9CED8]">{pctN(cr.hookRate)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {criativos.length > TOP_CRIATIVOS && (
                  <button onClick={() => setVerTudo(v => !v)} className="mt-3 text-xs font-medium text-indigo-400 hover:text-indigo-300">
                    {verTudo ? 'Mostrar só os principais' : `Ver todos os ${criativos.length} anúncios`}
                  </button>
                )}
              </div>
            )}
          </section>

          {/* CADÊNCIA */}
          <section className={`${CARD} mt-5 p-5 sm:p-7`}>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <div className={`${display.className} text-lg font-semibold`}>Investido por dia</div>
            </div>
            <div className="text-xs text-[#9CA3AF]">A cadência do investimento em anúncios, dia a dia.</div>
            {cadencia.length === 0 ? (
              <div className="mt-4 text-sm text-[#9CA3AF]">Sem dados no período.</div>
            ) : (
              <div className="mt-5 h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={cadencia} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="data" tickFormatter={fmtDiaBR} tick={{ fill: '#8A90A0', fontSize: 10 }} tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} minTickGap={20} />
                    <YAxis domain={[0, 'auto']} width={64} tick={{ fill: '#8A90A0', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => brl(Number(v))} />
                    <Tooltip
                      contentStyle={{ background: '#0E0F13', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, fontSize: 12 }}
                      labelFormatter={(l) => fmtDiaBR(String(l))}
                      formatter={(v) => [brl(Number(v)), 'Investido'] as [string, string]} />
                    <Line type="monotone" name="Investido" dataKey="investido" stroke="#34D399" strokeWidth={2} dot={false} activeDot={{ r: 5, fill: '#34D399', stroke: '#15171D', strokeWidth: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>
        </>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
function FunnelStage({ label, value, width, checkout }: { label: string; value: string; width: number; checkout?: boolean }) {
  return (
    <div className="rounded-xl px-5 py-3 text-center backdrop-blur-sm"
      style={{ width: `${width}%`, minWidth: 200,
        background: checkout ? 'rgba(249,115,22,0.10)' : 'rgba(20,22,28,0.72)',
        border: checkout ? '1px solid rgba(249,115,22,0.35)' : '1px solid rgba(255,255,255,0.07)' }}>
      <div className="text-[11px] text-[#9CA3AF]">{label}</div>
      <div className={`${display.className} text-xl font-bold ${checkout ? 'text-orange-300' : 'text-white'}`}>{value}</div>
    </div>
  )
}
function ConvPill({ rate, name, width, tone }: { rate: string; name: string; width: number; tone: number }) {
  const grads = ['linear-gradient(135deg,#FBBF24,#F59E0B)', 'linear-gradient(135deg,#F59E0B,#F97316)', 'linear-gradient(135deg,#F97316,#EA580C)']
  return (
    <div className="relative z-10" style={{ width: `${width}%`, minWidth: 168 }}>
      <div className="rounded-full px-4 py-1.5 text-center shadow-md" style={{ background: grads[tone] }}>
        <div className={`${display.className} text-sm font-bold text-[#2a1600] leading-tight`}>{rate}</div>
        <div className="text-[10px] font-medium text-[#3a2200] leading-tight">{name}</div>
      </div>
    </div>
  )
}
function WaterRow({ label, value, strong, deduz }: { label: string; value: string; strong?: boolean; deduz?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className={`text-sm ${strong ? 'text-white font-medium' : 'text-[#9CA3AF]'}`}>{label}</span>
      <span className={`text-sm tabular-nums ${strong ? 'text-white font-semibold' : deduz ? 'text-[#C89B9B]' : 'text-[#C9CED8]'} ${display.className}`}>{value}</span>
    </div>
  )
}
function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="text-[11px] text-[#9CA3AF]">{label}</div>
      <div className={`${display.className} mt-0.5 text-lg font-bold text-white`}>{value}</div>
      <div className="mt-0.5 text-[10px] text-[#6b7280]">{hint}</div>
    </div>
  )
}

export default function DashboardPerformanceFunis() {
  return (
    <ProtectedRoute>
      <div className={`min-h-screen bg-[#0E0F13] text-[#F4F5F7] ${ui.className}`}>
        <Header />
        <main className="max-w-screen-xl mx-auto px-4 pt-6 pb-24 md:pb-10">
          <PerfFunisTabs />
          <Suspense fallback={<div className="text-sm text-[#9CA3AF]">Carregando...</div>}>
            <Conteudo />
          </Suspense>
        </main>
        <MobileNav />
      </div>
    </ProtectedRoute>
  )
}
