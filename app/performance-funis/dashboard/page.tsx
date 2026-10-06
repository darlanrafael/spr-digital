'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Space_Grotesk, Inter } from 'next/font/google'
import { Trophy, Video, Image as ImageIcon, ChevronRight } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import ProtectedRoute from '@/components/ProtectedRoute'
import PerfFunisTabs from '@/components/PerfFunisTabs'
import { formatCurrency } from '@/lib/formatters'

export const dynamic = 'force-dynamic'

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] })
const ui = Inter({ subsets: ['latin'], weight: ['400', '500', '600'] })

type FunilPerf = {
  id: string; nome: string; organico: boolean
  investido: number; impressoes: number; cliques: number; visitas: number; checkouts: number
  ctr: number | null; hookRate: number | null; custoPorCheckout: number | null; alcanceAprox: number
}
type Criativo = {
  anuncio: string; criativo: string; campanha: string; thumbnail: string | null
  spend: number; inlineLinkClicks: number; isVideo: boolean
  ctr: number | null; hookRate: number | null
}
type PontoDia = { data: string; investido: number; cliques: number }

const CARD = 'rounded-2xl border border-white/10 bg-[#15171D]'
const fmtNum = (n: number) => new Intl.NumberFormat('pt-BR').format(Math.round(n))
const fmtPct = (n: number | null) => (n == null ? '—' : `${n.toFixed(2).replace('.', ',')}%`)
const fmtMoeda = (n: number | null) => (n == null ? '—' : formatCurrency(n))
const fmtDiaBR = (iso: string) => (iso ? iso.slice(5).split('-').reverse().join('/') : '')
const TOP_CRIATIVOS = 15

const PRESETS = [
  { value: 'today', label: 'Hoje' },
  { value: 'last_7d', label: '7 dias' },
  { value: 'last_30d', label: '30 dias' },
] as const

function SeletorPeriodo({
  datePreset, custom, de, ate, onDe, onAte,
}: { datePreset: string; custom: boolean; de: string; ate: string; onDe: (v: string) => void; onAte: (v: string) => void }) {
  const router = useRouter()
  const sp = useSearchParams()
  const funilId = sp.get('funilId')
  const base = funilId ? `?funilId=${funilId}&` : '?'
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-lg border border-white/10 bg-[#181A20] p-0.5">
        {PRESETS.map(p => (
          <button key={p.value}
            onClick={() => router.push(`/performance-funis/dashboard${base}datePreset=${p.value}`)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              !custom && datePreset === p.value ? 'bg-white/10 text-white' : 'text-[#9CA3AF] hover:text-white'}`}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input type="date" value={de} onChange={e => onDe(e.target.value)}
          className="bg-[#181A20] border border-white/10 rounded-lg px-2 py-1.5 text-xs" />
        <span className="text-[#9CA3AF] text-xs">até</span>
        <input type="date" value={ate} onChange={e => onAte(e.target.value)}
          className="bg-[#181A20] border border-white/10 rounded-lg px-2 py-1.5 text-xs" />
        <button disabled={!de || !ate}
          onClick={() => { const [a, b] = de <= ate ? [de, ate] : [ate, de]; router.push(`/performance-funis/dashboard${base}dateStart=${a}&dateEnd=${b}`) }}
          className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors disabled:opacity-40 ${
            custom ? 'bg-white/10 border-white/10 text-white' : 'border-white/10 text-[#9CA3AF] hover:text-white'}`}>
          Aplicar
        </button>
      </div>
    </div>
  )
}

function Banner({ aviso }: { aviso: string | null }) {
  if (!aviso) return null
  return <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">{aviso}</div>
}

// ---------------------------------------------------------------------------
// Visão geral (lista de funis)
// ---------------------------------------------------------------------------
function VisaoGeral() {
  const router = useRouter()
  const sp = useSearchParams()
  const dateStart = sp.get('dateStart') || ''
  const dateEnd = sp.get('dateEnd') || ''
  const custom = !!(dateStart && dateEnd)
  const datePreset = custom ? '' : sp.get('datePreset') || 'last_7d'
  const query = custom ? `dateStart=${dateStart}&dateEnd=${dateEnd}` : `datePreset=${datePreset}`

  const [de, setDe] = useState(dateStart)
  const [ate, setAte] = useState(dateEnd)
  const [funis, setFunis] = useState<FunilPerf[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    setCarregando(true); setErro(null)
    fetch(`/api/funis/performance?${query}`)
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Falha ao carregar'); return j })
      .then(j => { if (cancelado) return; setFunis((j.funis || []) as FunilPerf[]); setAviso(j.aviso ?? null) })
      .catch(e => { if (!cancelado) setErro(e instanceof Error ? e.message : 'Falha ao carregar') })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [query])

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className={`${display.className} text-2xl font-bold tracking-tight`}>Performance de Funis</h1>
        <SeletorPeriodo datePreset={datePreset} custom={custom} de={de} ate={ate} onDe={setDe} onAte={setAte} />
      </div>
      <p className="mt-1 text-sm text-[#9CA3AF]">Do clique no anúncio ao checkout, por funil.</p>

      <div className="mt-5"><Banner aviso={aviso} /></div>
      {erro && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{erro}</div>}

      {carregando ? (
        <div className={`${CARD} p-10 text-center text-sm text-[#9CA3AF]`}>Carregando os dados da Meta...</div>
      ) : funis.length === 0 ? (
        <div className={`${CARD} p-10 text-center text-sm text-[#9CA3AF]`}>Nenhum funil cadastrado. Crie um na aba Funis.</div>
      ) : (
        <div className={`${CARD} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase tracking-wide text-[#8A90A0]">
                <th className="py-3 px-4 text-left font-medium">Funil</th>
                <th className="py-3 px-3 text-right font-medium">Investido</th>
                <th className="py-3 px-3 text-right font-medium">Impressões</th>
                <th className="py-3 px-3 text-right font-medium">Cliques</th>
                <th className="py-3 px-3 text-right font-medium">CTR</th>
                <th className="py-3 px-3 text-right font-medium">Visitas</th>
                <th className="py-3 px-3 text-right font-medium">Checkouts</th>
                <th className="py-3 px-3 text-right font-medium">Custo/checkout</th>
                <th className="py-3 px-3 w-8"></th>
              </tr>
            </thead>
            <tbody className={display.className}>
              {funis.map(f => (
                <tr key={f.id} onClick={() => router.push(`/performance-funis/dashboard?funilId=${f.id}&${query}`)}
                  className="border-b border-white/5 last:border-0 cursor-pointer hover:bg-white/[0.03] transition-colors">
                  <td className={`${ui.className} py-3.5 px-4 font-medium text-white`}>{f.nome}</td>
                  {f.organico ? (
                    <td colSpan={7} className={`${ui.className} py-3.5 px-3 text-right text-[#6B7280]`}>sem investimento em ads</td>
                  ) : (
                    <>
                      <td className="py-3.5 px-3 text-right tabular-nums font-semibold text-white">{fmtMoeda(f.investido)}</td>
                      <td className="py-3.5 px-3 text-right tabular-nums text-[#C9CED8]">{fmtNum(f.impressoes)}</td>
                      <td className="py-3.5 px-3 text-right tabular-nums text-[#C9CED8]">{fmtNum(f.cliques)}</td>
                      <td className="py-3.5 px-3 text-right tabular-nums text-[#C9CED8]">{fmtPct(f.ctr)}</td>
                      <td className="py-3.5 px-3 text-right tabular-nums text-[#C9CED8]">{fmtNum(f.visitas)}</td>
                      <td className="py-3.5 px-3 text-right tabular-nums font-semibold text-emerald-300">{fmtNum(f.checkouts)}</td>
                      <td className="py-3.5 px-3 text-right tabular-nums text-[#C9CED8]">{fmtMoeda(f.custoPorCheckout)}</td>
                    </>
                  )}
                  <td className="py-3.5 px-3 text-right"><ChevronRight className="w-4 h-4 text-[#4B5563] inline" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Detalhe do funil
// ---------------------------------------------------------------------------
function CardMetrica({ label, valor, destaque }: { label: string; valor: string; destaque?: boolean }) {
  return (
    <div className={`${CARD} p-4`}>
      <div className="text-xs text-[#9CA3AF]">{label}</div>
      <div className={`${display.className} mt-1 text-2xl font-bold ${destaque ? 'text-emerald-300' : 'text-white'}`}>{valor}</div>
    </div>
  )
}

function Etapa({ nome, valor, sub }: { nome: string; valor: string; sub?: string }) {
  return (
    <div className="flex-1 min-w-[120px] rounded-xl border border-white/10 bg-[#181A20] p-4">
      <div className="text-xs text-[#9CA3AF]">{nome}</div>
      <div className={`${display.className} mt-1 text-xl font-bold text-white`}>{valor}</div>
      {sub && <div className="mt-0.5 text-[11px] text-orange-300/70">{sub}</div>}
    </div>
  )
}

function DetalheFunil({ funilId }: { funilId: string }) {
  const router = useRouter()
  const sp = useSearchParams()
  const dateStart = sp.get('dateStart') || ''
  const dateEnd = sp.get('dateEnd') || ''
  const custom = !!(dateStart && dateEnd)
  const datePreset = custom ? '' : sp.get('datePreset') || 'last_7d'
  const query = custom ? `dateStart=${dateStart}&dateEnd=${dateEnd}` : `datePreset=${datePreset}`

  const [de, setDe] = useState(dateStart)
  const [ate, setAte] = useState(dateEnd)
  const [funil, setFunil] = useState<FunilPerf | null>(null)
  const [criativos, setCriativos] = useState<Criativo[]>([])
  const [cadencia, setCadencia] = useState<PontoDia[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [verTudo, setVerTudo] = useState(false)

  useEffect(() => {
    let cancelado = false
    setCarregando(true); setErro(null); setVerTudo(false)
    fetch(`/api/funis/performance?funilId=${funilId}&${query}`)
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Falha ao carregar'); return j })
      .then(j => { if (cancelado) return; setFunil(j.funil); setCriativos(j.criativos || []); setCadencia(j.cadencia || []); setAviso(j.aviso ?? null) })
      .catch(e => { if (!cancelado) setErro(e instanceof Error ? e.message : 'Falha ao carregar') })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [funilId, query])

  const voltar = `/performance-funis/dashboard?${query}`
  const criativosVisiveis = verTudo ? criativos : criativos.slice(0, TOP_CRIATIVOS)
  const passagem = (num: number, den: number) => (den > 0 ? `${(num / den * 100).toFixed(1).replace('.', ',')}% da etapa anterior` : undefined)

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button onClick={() => router.push(voltar)}
          className="inline-flex items-center gap-1.5 text-sm text-[#9CA3AF] hover:text-white transition-colors">
          <ChevronRight className="w-4 h-4 rotate-180" /> Voltar para a visão geral
        </button>
        <SeletorPeriodo datePreset={datePreset} custom={custom} de={de} ate={ate} onDe={setDe} onAte={setAte} />
      </div>

      <h1 className={`${display.className} mt-4 text-2xl font-bold tracking-tight`}>{funil?.nome ?? 'Funil'}</h1>

      <div className="mt-5"><Banner aviso={aviso} /></div>
      {erro && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{erro}</div>}

      {carregando ? (
        <div className={`${CARD} p-10 text-center text-sm text-[#9CA3AF]`}>Carregando os dados da Meta...</div>
      ) : !funil ? null : funil.organico ? (
        <div className={`${CARD} p-10 text-center text-sm text-[#9CA3AF]`}>Este funil é orgânico (sem termos de campanha), então não há dados de anúncios.</div>
      ) : (
        <>
          {/* Cartões principais */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <CardMetrica label="Investido" valor={fmtMoeda(funil.investido)} />
            <CardMetrica label="CTR" valor={fmtPct(funil.ctr)} />
            <CardMetrica label="Hook Rate" valor={fmtPct(funil.hookRate)} />
            <CardMetrica label="Custo / checkout" valor={fmtMoeda(funil.custoPorCheckout)} />
          </div>

          {/* Etapas do funil */}
          <section className={`${CARD} mt-5 p-5 sm:p-6`}>
            <div className={`${display.className} text-lg font-semibold`}>Etapas do funil</div>
            <div className="mt-4 flex flex-wrap items-stretch gap-2">
              <Etapa nome="Impressões" valor={fmtNum(funil.impressoes)} sub={`Alcance aprox.: ${fmtNum(funil.alcanceAprox)}`} />
              <div className="flex items-center text-[#4B5563]"><ChevronRight className="w-5 h-5" /></div>
              <Etapa nome="Cliques" valor={fmtNum(funil.cliques)} sub={passagem(funil.cliques, funil.impressoes)} />
              <div className="flex items-center text-[#4B5563]"><ChevronRight className="w-5 h-5" /></div>
              <Etapa nome="Visitas" valor={fmtNum(funil.visitas)} sub={passagem(funil.visitas, funil.cliques)} />
              <div className="flex items-center text-[#4B5563]"><ChevronRight className="w-5 h-5" /></div>
              <Etapa nome="Checkouts" valor={fmtNum(funil.checkouts)} sub={passagem(funil.checkouts, funil.visitas)} />
            </div>
          </section>

          {/* Criativos */}
          <section className={`${CARD} mt-5 p-5 sm:p-6`}>
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-400" />
              <div className={`${display.className} text-lg font-semibold`}>Criativos</div>
            </div>
            <div className="text-xs text-[#9CA3AF]">Anúncios do funil, do maior investimento para o menor.</div>

            {criativos.length === 0 ? (
              <div className="mt-4 text-sm text-[#9CA3AF]">Nenhum anúncio no período.</div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-[11px] uppercase tracking-wide text-[#8A90A0]">
                      <th className="py-2 pr-2 text-left font-medium w-8">#</th>
                      <th className="py-2 px-2 text-left font-medium">Anúncio</th>
                      <th className="py-2 px-3 text-left font-medium">Formato</th>
                      <th className="py-2 px-3 text-right font-medium">Investido</th>
                      <th className="py-2 px-3 text-right font-medium">CTR</th>
                      <th className="py-2 px-3 text-right font-medium">Hook Rate</th>
                      <th className="py-2 pl-3 text-right font-medium">Cliques</th>
                    </tr>
                  </thead>
                  <tbody className={display.className}>
                    {criativosVisiveis.map((cr, i) => {
                      const top = i === 0
                      return (
                        <tr key={`${cr.anuncio}-${i}`} className="border-b border-white/5 last:border-0"
                          style={top ? { background: 'rgba(245,158,11,0.05)' } : undefined}>
                          <td className="py-3 pr-2">
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
                                <div className={`${ui.className} font-medium text-white truncate max-w-[280px]`}>{cr.anuncio || cr.criativo || '-'}</div>
                                <div className={`${ui.className} text-[11px] text-[#6B7280] truncate max-w-[280px]`}>{cr.campanha}</div>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <span className={`${ui.className} inline-flex items-center gap-1.5 text-[#9CA3AF]`}>
                              {cr.isVideo ? <Video className="w-3.5 h-3.5 text-orange-300/70" /> : <ImageIcon className="w-3.5 h-3.5 text-sky-300/70" />}
                              {cr.isVideo ? 'Vídeo' : 'Imagem'}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums text-[#C9CED8]">{fmtMoeda(cr.spend)}</td>
                          <td className="py-3 px-3 text-right tabular-nums text-[#C9CED8]">{fmtPct(cr.ctr)}</td>
                          <td className="py-3 px-3 text-right tabular-nums text-[#C9CED8]">{fmtPct(cr.hookRate)}</td>
                          <td className="py-3 pl-3 text-right tabular-nums font-semibold text-white">{fmtNum(cr.inlineLinkClicks)}</td>
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

          {/* Cadência */}
          <section className={`${CARD} mt-5 p-5 sm:p-6`}>
            <div className={`${display.className} text-lg font-semibold`}>Investido por dia</div>
            <div className="text-xs text-[#9CA3AF]">A cadência do investimento em anúncios, dia a dia.</div>
            {cadencia.length === 0 ? (
              <div className="mt-4 text-sm text-[#9CA3AF]">Sem dados no período.</div>
            ) : (
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={cadencia} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="data" tickFormatter={fmtDiaBR} tick={{ fontSize: 11, fill: '#8A90A0' }} tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
                    <YAxis domain={[0, 'auto']} width={72} tick={{ fontSize: 11, fill: '#8A90A0' }} tickLine={false} axisLine={false}
                      tickFormatter={(v: number) => formatCurrency(v)} />
                    <Tooltip
                      contentStyle={{ background: '#15171D', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, fontSize: 12 }}
                      labelFormatter={(l) => fmtDiaBR(String(l))}
                      formatter={(v) => [formatCurrency(Number(v)), 'Investido'] as [string, string]} />
                    <Line type="monotone" dataKey="investido" stroke="#34D399" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
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

function Conteudo() {
  const funilId = useSearchParams().get('funilId')
  return funilId ? <DetalheFunil funilId={funilId} /> : <VisaoGeral />
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
