'use client'

import { useState } from 'react'
import { Space_Grotesk, Inter } from 'next/font/google'
import { Plus, TrendingUp, TrendingDown, Info, Video, Image as ImageIcon, Images, Trophy, RotateCcw } from 'lucide-react'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import ProtectedRoute from '@/components/ProtectedRoute'
import { LineChart, Line, ReferenceLine, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] })
const ui = Inter({ subsets: ['latin'], weight: ['400', '500', '600'] })

// ---------------------------------------------------------------------------
// DADOS FICTÍCIOS (Fase 1 — só pra ver layout/design). Nada vem do banco ainda.
// ---------------------------------------------------------------------------
type Formato = 'Vídeo' | 'Imagem' | 'Carrossel'
type Criativo = {
  id: string
  nome: string
  formato: Formato
  investido: number
  vendas: number
  roas: number
  ctr: number
}
type Funil = {
  id: string
  nome: string
  produto: string
  trafego: number
  cliques: number
  visualizacoes: number
  checkout: number
  vendas: number
  faturamento: number
  taxas: number
  imposto: number
  repasse: number
  repasseLabel: string
  criativos: Criativo[]
}

const FUNIS: Funil[] = [
  {
    id: 'f1',
    nome: 'Como Ser Perdoado',
    produto: 'Como Ser Perdoado · R$ 169',
    trafego: 6480,
    cliques: 9752,
    visualizacoes: 7216,
    checkout: 665,
    vendas: 135,
    faturamento: 22877.22,
    taxas: 1830.18,
    imposto: 2939.72,
    repasse: 7000,
    repasseLabel: 'Repasse terapeuta',
    criativos: [
      { id: 'c1', nome: 'Depoimento · O perdão que liberta', formato: 'Vídeo', investido: 2650, vendas: 71, roas: 4.2, ctr: 3.1 },
      { id: 'c2', nome: 'Carta aberta ao ressentimento', formato: 'Imagem', investido: 1980, vendas: 41, roas: 3.3, ctr: 2.4 },
      { id: 'c3', nome: '3 sinais de que você precisa perdoar', formato: 'Vídeo', investido: 1200, vendas: 18, roas: 2.6, ctr: 1.9 },
      { id: 'c4', nome: 'Prova social · alunos', formato: 'Carrossel', investido: 650, vendas: 5, roas: 1.4, ctr: 1.2 },
    ],
  },
  {
    id: 'f2',
    nome: 'Diagnóstico Guiado',
    produto: 'Diagnóstico Guiado · R$ 199',
    trafego: 11200,
    cliques: 14200,
    visualizacoes: 9600,
    checkout: 980,
    vendas: 210,
    faturamento: 41790,
    taxas: 3343.2,
    imposto: 5370.02,
    repasse: 12000,
    repasseLabel: 'Repasse terapeuta',
    criativos: [
      { id: 'c1', nome: 'Você se sente travado?', formato: 'Vídeo', investido: 4200, vendas: 98, roas: 3.9, ctr: 2.8 },
      { id: 'c2', nome: 'Diagnóstico em 7 dias', formato: 'Imagem', investido: 3600, vendas: 71, roas: 3.4, ctr: 2.2 },
      { id: 'c3', nome: 'Antes e depois · jornada', formato: 'Carrossel', investido: 2100, vendas: 30, roas: 2.6, ctr: 1.7 },
      { id: 'c4', nome: 'Bônus revelado', formato: 'Vídeo', investido: 1300, vendas: 11, roas: 1.8, ctr: 1.3 },
    ],
  },
  {
    id: 'f3',
    nome: 'Mentoria Pedro Roncada',
    produto: 'Mentoria Particular · R$ 4.997',
    trafego: 22000,
    cliques: 5300,
    visualizacoes: 3820,
    checkout: 190,
    vendas: 24,
    faturamento: 119928,
    taxas: 4797.12,
    imposto: 15411.25,
    repasse: 45000,
    repasseLabel: 'Repasse sócio (Pedro)',
    criativos: [
      { id: 'c1', nome: 'Bastidores · mentoria de perto', formato: 'Vídeo', investido: 9500, vendas: 12, roas: 5.9, ctr: 2.1 },
      { id: 'c2', nome: 'O método do Pedro', formato: 'Imagem', investido: 7200, vendas: 8, roas: 5.1, ctr: 1.6 },
      { id: 'c3', nome: 'Vagas limitadas · última chamada', formato: 'Vídeo', investido: 5300, vendas: 4, roas: 3.8, ctr: 1.2 },
    ],
  },
]

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------
// Cadencia diaria do resultado liquido (ficticio), 30 dias por funil. Geracao
// DETERMINISTICA (data de referencia fixa + padrao de dia da semana + onda
// suave) - sem Math.random nem Date.now, pra nao dar mismatch de hidratacao.
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const FATOR_SEMANA = [0.70, 0.92, 1.00, 0.96, 1.12, 1.25, 0.88] // dom..sab
const HOJE_REF = new Date('2026-10-02T12:00:00')

function gerarCadencia(base: number, seed: number): { data: string; diaSemana: string; liquido: number }[] {
  const out: { data: string; diaSemana: string; liquido: number }[] = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(HOJE_REF)
    d.setDate(HOJE_REF.getDate() - i)
    const wd = d.getDay()
    const onda = 1 + 0.16 * Math.sin((i + seed) / 3.2)
    const liquido = Math.round(base * FATOR_SEMANA[wd] * onda)
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    out.push({ data: `${dd}/${mm}`, diaSemana: DIAS_SEMANA[wd], liquido })
  }
  return out
}

const CADENCIA: Record<string, { data: string; diaSemana: string; liquido: number }[]> = {
  f1: gerarCadencia(1500, 0),
  f2: gerarCadencia(3100, 2),
  f3: gerarCadencia(11200, 5),
}

// Reembolso diario (ficticio) do PRODUTO DE ENTRADA - bloco A PARTE, NAO muda
// por funil. Produto de entrada a definir; na Fase 2 vem do banco (reembolsos).
function gerarReembolso(base: number, seed: number): { data: string; diaSemana: string; reembolso: number }[] {
  const out: { data: string; diaSemana: string; reembolso: number }[] = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(HOJE_REF)
    d.setDate(HOJE_REF.getDate() - i)
    const wd = d.getDay()
    const onda = 1 + 0.35 * Math.sin((i + seed) / 2.1)
    const pico = i % 7 === 3 ? 1.6 : 1
    const reembolso = Math.max(0, Math.round(base * (0.6 + 0.5 * FATOR_SEMANA[wd]) * onda * pico))
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    out.push({ data: `${dd}/${mm}`, diaSemana: DIAS_SEMANA[wd], reembolso })
  }
  return out
}
const REEMBOLSO = gerarReembolso(380, 1)
type ReembolsoDia = { data: string; diaSemana: string; reembolso: number; delta: number | null }

// Melhores horarios (ficticio) por funil - na Fase 2 vem da amostra de 30d de vendas.
const MELHOR_HORARIO: Record<string, string> = { f1: '19h – 21h', f2: '12h – 14h', f3: '20h – 22h' }
const DIA_LONGO: Record<string, string> = { Seg: 'Segunda', Ter: 'Terça', Qua: 'Quarta', Qui: 'Quinta', Sex: 'Sexta', 'Sáb': 'Sábado', Dom: 'Domingo' }
type CadenciaDia = { data: string; diaSemana: string; liquido: number; delta: number | null }

const brl = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(n)
const brlCompact = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(n)
const int = (n: number) => new Intl.NumberFormat('pt-BR').format(n)
const pct = (n: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n * 100) + '%'

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------
const ymd = (d: Date) => {
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10)
}
function presetRange(dias: number): { de: string; ate: string } {
  const ate = new Date()
  const de = new Date()
  de.setDate(de.getDate() - (dias - 1))
  return { de: ymd(de), ate: ymd(ate) }
}
const PRESETS = [
  { label: 'Hoje', dias: 1 },
  { label: '7 dias', dias: 7 },
  { label: '30 dias', dias: 30 },
] as const
const fmtBR = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '—')

export default function PerformanceFunisPage() {
  const [ativo, setAtivo] = useState(FUNIS[0].id)
  const inicial = presetRange(30)
  const [de, setDe] = useState(inicial.de)
  const [ate, setAte] = useState(inicial.ate)
  const [presetAtivo, setPresetAtivo] = useState<number | null>(30)

  const f = FUNIS.find(x => x.id === ativo) ?? FUNIS[0]

  function aplicarPreset(dias: number) {
    const r = presetRange(dias)
    setDe(r.de)
    setAte(r.ate)
    setPresetAtivo(dias)
  }

  // Derivados (consistentes com os números-base)
  const c1 = f.visualizacoes / f.cliques
  const c2 = f.checkout / f.visualizacoes
  const c3 = f.vendas / f.checkout
  const trafegoComIOF = f.trafego * 1.1385        // tráfego + IOF de 13,85%
  const impostosOperacao = f.faturamento * 0.135  // impostos operação (13,5%)
  const liquido = f.faturamento - f.taxas - trafegoComIOF - impostosOperacao
  const roas = f.faturamento / f.trafego
  const margem = liquido / f.faturamento
  const positivo = liquido >= 0
  const criativos = [...f.criativos].sort((a, b) => b.vendas - a.vendas)
  const cadenciaBase = CADENCIA[f.id] ?? []
  const cadencia: CadenciaDia[] = cadenciaBase.map((d, i) => ({
    ...d,
    delta: i === 0 ? null : d.liquido - cadenciaBase[i - 1].liquido,
  }))
  // Melhor DIA DA SEMANA na amostra de 30d: maior media de liquido por dia da semana.
  const porSemana: Record<string, number[]> = {}
  for (const d of cadencia) (porSemana[d.diaSemana] ??= []).push(d.liquido)
  const mediasSemana = Object.entries(porSemana).map(([dia, vs]) => ({ dia, media: vs.reduce((a, b) => a + b, 0) / vs.length }))
  const melhorDia = mediasSemana.reduce((b, d) => (d.media > b.media ? d : b), mediasSemana[0] ?? { dia: '-', media: 0 })
  const melhorHorario = MELHOR_HORARIO[f.id] ?? '-'
  // Folga extra no eixo Y pra aproximar visualmente as 2 linhas (liquido alto x
  // oscilacao perto do zero) num eixo so - nao muda os valores, so o zoom.
  const valsCadencia = cadencia.flatMap(d => (d.delta === null ? [d.liquido] : [d.liquido, d.delta]))
  const yMin = Math.min(0, ...valsCadencia)
  const yMax = Math.max(...valsCadencia)
  const yPad = (yMax - yMin) * 0.35
  const yDomain: [number, number] = [Math.round(yMin - yPad), Math.round(yMax + yPad)]

  // Reembolso (produto de entrada) - a parte, FIXO (nao muda por funil)
  const reembolsoBase = REEMBOLSO
  const reembolso: ReembolsoDia[] = reembolsoBase.map((d, i) => ({ ...d, delta: i === 0 ? null : d.reembolso - reembolsoBase[i - 1].reembolso }))
  const totalReembolso = reembolso.reduce((a, d) => a + d.reembolso, 0)
  const porSemanaR: Record<string, number[]> = {}
  for (const d of reembolso) (porSemanaR[d.diaSemana] ??= []).push(d.reembolso)
  const mediasSemanaR = Object.entries(porSemanaR).map(([dia, vs]) => ({ dia, media: vs.reduce((a, b) => a + b, 0) / vs.length }))
  const piorDia = mediasSemanaR.reduce((b, d) => (d.media > b.media ? d : b), mediasSemanaR[0] ?? { dia: '-', media: 0 })
  const valsR = reembolso.flatMap(d => (d.delta === null ? [d.reembolso] : [d.reembolso, d.delta]))
  const yMinR = Math.min(0, ...valsR)
  const yMaxR = Math.max(...valsR)
  const yPadR = (yMaxR - yMinR) * 0.35
  const yDomainR: [number, number] = [Math.round(yMinR - yPadR), Math.round(yMaxR + yPadR)]

  return (
    <ProtectedRoute>
      <div className={`min-h-screen bg-[#0E0F13] text-[#F4F5F7] ${ui.className}`}>
        <Header />
        <main className="max-w-screen-xl mx-auto px-4 pt-6 pb-24 md:pb-10">
          {/* Cabeçalho da página */}
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className={`${display.className} text-2xl font-bold tracking-tight`}>Performance de Funis</h1>
              <p className="mt-1 text-sm text-[#9CA3AF]">Do clique no anúncio ao que sobra no bolso, por produto.</p>
            </div>

            {/* Seletor de datas — presets + janela De/Até */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border border-white/10 bg-[#181A20] p-0.5">
                {PRESETS.map(p => (
                  <button
                    key={p.label}
                    onClick={() => aplicarPreset(p.dias)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      presetAtivo === p.dias ? 'bg-white/10 text-white' : 'text-[#9CA3AF] hover:text-white'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#181A20] px-2 py-1">
                <input
                  type="date"
                  value={de}
                  max={ate || undefined}
                  onChange={e => { setDe(e.target.value); setPresetAtivo(null) }}
                  className="bg-transparent text-xs text-white [color-scheme:dark] outline-none"
                />
                <span className="text-[#6b7280] text-xs">→</span>
                <input
                  type="date"
                  value={ate}
                  min={de || undefined}
                  onChange={e => { setAte(e.target.value); setPresetAtivo(null) }}
                  className="bg-transparent text-xs text-white [color-scheme:dark] outline-none"
                />
              </div>
            </div>
          </div>

          {/* Abas de funis + adicionar */}
          <div className="mt-6 flex flex-wrap items-center gap-2">
            {FUNIS.map(x => (
              <button
                key={x.id}
                onClick={() => setAtivo(x.id)}
                className={`px-3.5 py-2 text-sm font-medium rounded-lg border transition-colors ${
                  x.id === ativo
                    ? 'border-orange-500/60 bg-orange-500/10 text-orange-300'
                    : 'border-white/10 bg-[#181A20] text-[#9CA3AF] hover:text-white hover:border-white/20'
                }`}
              >
                {x.nome}
              </button>
            ))}
            <button
              className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-lg border border-dashed border-white/15 text-[#9CA3AF] hover:text-white hover:border-white/30 transition-colors"
              title="(fictício) Adicionar funil"
            >
              <Plus className="w-4 h-4" />
              Adicionar funil
            </button>
          </div>

          {/* Corpo: funil (esquerda) + resultado (direita) */}
          <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[1.15fr_1fr]">
            {/* ---------------- FUNIL ---------------- */}
            <section className="rounded-2xl border border-white/10 bg-[#15171D] p-5 sm:p-7">
              <div className="flex items-center justify-between">
                <div>
                  <div className={`${display.className} text-lg font-semibold`}>Funil de vendas</div>
                  <div className="text-xs text-[#9CA3AF]">{f.produto}</div>
                </div>
                <span className="text-[11px] text-orange-400/70">{fmtBR(de)} – {fmtBR(ate)}</span>
              </div>

              {/* silhueta + faixas */}
              <div className="relative mt-6">
                <svg
                  className="absolute inset-0 h-full w-full"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <defs>
                    <linearGradient id="funnelFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.10" />
                      <stop offset="100%" stopColor="#EA580C" stopOpacity="0.20" />
                    </linearGradient>
                  </defs>
                  <polygon points="3,0 97,0 63,100 37,100" fill="url(#funnelFill)" stroke="rgba(249,115,22,0.22)" strokeWidth="0.4" />
                </svg>

                <div className="relative z-10 flex flex-col items-center gap-2">
                  <FunnelStage label="Cliques no link" value={int(f.cliques)} width={100} />
                  <ConvPill rate={pct(c1)} name="Tx de carregamento da página" width={90} tone={0} />
                  <FunnelStage label="Visualizações da página de destino" value={int(f.visualizacoes)} width={80} />
                  <ConvPill rate={pct(c2)} name="Tx de conversão da página" width={68} tone={1} />
                  <FunnelStage label="Acessos ao checkout" value={int(f.checkout)} width={58} />
                  <ConvPill rate={pct(c3)} name="Tx de conversão do checkout" width={48} tone={2} />
                  <FunnelStage label="Vendas" value={int(f.vendas)} width={46} venda />

                  <div
                    className="mt-2 rounded-xl px-6 py-4 text-center shadow-lg shadow-orange-900/30"
                    style={{ width: '44%', minWidth: 190, background: 'linear-gradient(135deg,#F59E0B,#EA580C)' }}
                  >
                    <div className="text-[11px] font-medium text-orange-950/80">Faturamento bruto</div>
                    <div className={`${display.className} text-2xl font-bold text-[#1a0f00]`}>{brl(f.faturamento)}</div>
                  </div>
                </div>
              </div>
            </section>

            {/* ---------------- RESULTADO ---------------- */}
            <section className="rounded-2xl border border-white/10 bg-[#15171D] p-5 sm:p-7 flex flex-col">
              <div className={`${display.className} text-lg font-semibold`}>Resultado</div>
              <div className="text-xs text-[#9CA3AF]">O que o funil deixa depois de tudo</div>

              <div className="mt-5 space-y-1.5">
                <WaterRow label="Faturamento bruto" value={brl(f.faturamento)} strong />
                <WaterRow label="− Taxas da plataforma" value={`− ${brl(f.taxas)}`} deduz />
                <WaterRow label="− Investimento em tráfego" value={`− ${brl(trafegoComIOF)}`} deduz />
                <WaterRow label="− Impostos operação" value={`− ${brl(impostosOperacao)}`} deduz />
                <div className="my-2 h-px bg-white/10" />
                <WaterRow label="= Total líquido após todas as deduções" value={brl(liquido)} strong />
              </div>

              <div
                className="mt-4 rounded-xl border p-4"
                style={{
                  background: positivo ? 'rgba(52,211,153,0.08)' : 'rgba(251,113,133,0.08)',
                  borderColor: positivo ? 'rgba(52,211,153,0.3)' : 'rgba(251,113,133,0.3)',
                }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#C9CED8]">Resultado líquido</span>
                  {positivo ? <TrendingUp className="w-4 h-4 text-emerald-400" /> : <TrendingDown className="w-4 h-4 text-rose-400" />}
                </div>
                <div className={`${display.className} mt-1 text-3xl font-bold`} style={{ color: positivo ? '#34D399' : '#FB7185' }}>
                  {brl(liquido)}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3">
                <Kpi label="ROAS" value={`${roas.toFixed(2).replace('.', ',')}x`} hint="Bruto ÷ tráfego" />
                <Kpi label="Margem líquida" value={pct(margem)} hint="Líquido ÷ bruto" />
                <Kpi label="Investido" value={brlCompact(f.trafego)} hint="Tráfego Meta" />
              </div>

              <div className="mt-4 flex items-start gap-2 rounded-lg bg-white/[0.03] px-3 py-2 text-[11px] text-[#8A90A0]">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  Números fictícios só para validar o layout. Vendas e faturamento virão do banco; o topo do funil
                  (cliques, visualizações, checkout) e os criativos virão do Meta.
                </span>
              </div>
            </section>
          </div>

          {/* ---------------- TODOS OS CRIATIVOS ---------------- */}
          <section className="mt-5 rounded-2xl border border-white/10 bg-[#15171D] p-5 sm:p-7">
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-400" />
              <div className={`${display.className} text-lg font-semibold`}>Criativos</div>
            </div>
            <div className="text-xs text-[#9CA3AF]">Todos os anúncios do funil, do maior volume de vendas para o menor.</div>

            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-[11px] uppercase tracking-wide text-[#8A90A0]">
                    <th className="py-2 pr-3 text-left font-medium">#</th>
                    <th className="py-2 pr-3 text-left font-medium">Criativo</th>
                    <th className="py-2 px-3 text-left font-medium">Formato</th>
                    <th className="py-2 px-3 text-right font-medium">Investido</th>
                    <th className="py-2 px-3 text-right font-medium">Vendas</th>
                    <th className="py-2 px-3 text-right font-medium">Faturamento</th>
                    <th className="py-2 px-3 text-right font-medium">ROAS</th>
                    <th className="py-2 px-3 text-right font-medium">CPA</th>
                    <th className="py-2 px-3 text-right font-medium">CTR</th>
                    <th className="py-2 pl-3 text-right font-medium">Hook Rate</th>
                  </tr>
                </thead>
                <tbody className={display.className}>
                  {criativos.map((cr, i) => {
                    const top = i === 0
                    const fat = cr.roas * cr.investido
                    const cpa = cr.investido / cr.vendas
                    // Hook Rate (ficticio no prototipo; so video). Na Fase 2 vem do Meta: 3s video views / impressoes.
                    const hookRate = cr.formato === 'Vídeo' ? Math.round((cr.ctr * 11 + 12) * 10) / 10 : null
                    const FormatoIcon = cr.formato === 'Vídeo' ? Video : cr.formato === 'Imagem' ? ImageIcon : Images
                    return (
                      <tr
                        key={cr.id}
                        className="border-b border-white/5 last:border-0"
                        style={top ? { background: 'rgba(245,158,11,0.05)' } : undefined}
                      >
                        <td className="py-3 pr-3">
                          <span
                            className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold"
                            style={{
                              background: top ? 'linear-gradient(135deg,#FBBF24,#EA580C)' : 'rgba(255,255,255,0.08)',
                              color: top ? '#1a0f00' : '#C9CED8',
                            }}
                          >
                            {i + 1}
                          </span>
                        </td>
                        <td className="py-3 pr-3">
                          <span className={`${ui.className} font-medium text-white`}>{cr.nome}</span>
                        </td>
                        <td className="py-3 px-3">
                          <span className={`${ui.className} inline-flex items-center gap-1.5 text-[#9CA3AF]`}>
                            <FormatoIcon className="w-3.5 h-3.5 text-orange-300/70" />
                            {cr.formato}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums text-[#C9CED8]">{brlCompact(cr.investido)}</td>
                        <td className="py-3 px-3 text-right tabular-nums font-bold text-white">{int(cr.vendas)}</td>
                        <td className="py-3 px-3 text-right tabular-nums text-[#C9CED8]">{brlCompact(fat)}</td>
                        <td className="py-3 px-3 text-right tabular-nums font-bold text-emerald-300">
                          {cr.roas.toFixed(2).replace('.', ',')}x
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums text-[#C9CED8]">{brlCompact(cpa)}</td>
                        <td className="py-3 px-3 text-right tabular-nums text-[#C9CED8]">
                          {cr.ctr.toFixed(1).replace('.', ',')}%
                        </td>
                        <td className="py-3 pl-3 text-right tabular-nums text-[#C9CED8]">
                          {hookRate !== null ? `${hookRate.toFixed(1).replace('.', ',')}%` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* ---------------- CADÊNCIA DO RESULTADO LÍQUIDO ---------------- */}
          <section className="mt-5 rounded-2xl border border-white/10 bg-[#15171D] p-5 sm:p-7">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <div className={`${display.className} text-lg font-semibold`}>Resultado líquido diário</div>
            </div>
            <div className="text-xs text-[#9CA3AF]">A cadência do que o funil deixou, dia a dia.</div>

            <div className="mt-5 h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={cadencia} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="data" tick={{ fill: '#8A90A0', fontSize: 10 }} tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} minTickGap={20} />
                  <YAxis
                    tick={{ fill: '#8A90A0', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={52}
                    domain={yDomain}
                    tickFormatter={(v) => { const n = Number(v); const a = Math.abs(n); const s = a >= 1000 ? `${(a / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k` : String(a); return (n < 0 ? '-' : '') + s }}
                  />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
                  <Tooltip
                    cursor={{ stroke: 'rgba(255,255,255,0.15)', strokeWidth: 1 }}
                    content={(props) => {
                      const p = props as unknown as { active?: boolean; payload?: Array<{ payload: CadenciaDia }> }
                      if (!p.active || !p.payload?.length) return null
                      const d = p.payload[0].payload
                      const up = (d.delta ?? 0) >= 0
                      return (
                        <div className="rounded-lg border border-white/10 bg-[#0E0F13] px-3 py-2 shadow-lg">
                          <div className="text-[11px] text-[#9CA3AF]">{DIA_LONGO[d.diaSemana] ?? d.diaSemana} · {d.data}</div>
                          <div className={`${display.className} text-sm font-bold text-emerald-300`}>Líquido {brl(d.liquido)}</div>
                          {d.delta !== null && (
                            <div className="mt-0.5 text-[11px]" style={{ color: up ? '#34D399' : '#FB7185' }}>
                              Oscilação {up ? '▲' : '▼'} {brl(Math.abs(d.delta))}
                            </div>
                          )}
                        </div>
                      )
                    }}
                  />
                  <Legend iconType="plainline" formatter={(value) => <span style={{ color: '#9CA3AF', fontSize: 12 }}>{value}</span>} />
                  <Line type="monotone" name="Líquido diário" dataKey="liquido" stroke="#34D399" strokeWidth={2} dot={false} activeDot={{ r: 5, fill: '#34D399', stroke: '#15171D', strokeWidth: 2 }} />
                  <Line type="monotone" name="Oscilação vs dia anterior" dataKey="delta" stroke="#F59E0B" strokeWidth={2} dot={false} activeDot={{ r: 5, fill: '#F59E0B', stroke: '#15171D', strokeWidth: 2 }} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <div className="text-[11px] text-[#9CA3AF]">Melhor dia (amostra 30d)</div>
                <div className={`${display.className} mt-0.5 text-lg font-bold text-emerald-300`}>{DIA_LONGO[melhorDia.dia] ?? melhorDia.dia}</div>
                <div className="mt-0.5 text-[10px] text-[#6b7280]">~{brl(melhorDia.media)}/dia</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <div className="text-[11px] text-[#9CA3AF]">Melhores horários</div>
                <div className={`${display.className} mt-0.5 text-lg font-bold text-white`}>{melhorHorario}</div>
                <div className="mt-0.5 text-[10px] text-[#6b7280]">maior volume de vendas</div>
              </div>
            </div>
          </section>

          {/* ---------------- REEMBOLSO (PRODUTO DE ENTRADA) — bloco à parte ---------------- */}
          <section className="mt-5 rounded-2xl border border-white/10 bg-[#15171D] p-5 sm:p-7">
            <div className="flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-rose-400" />
              <div className={`${display.className} text-lg font-semibold`}>Reembolsos · produto de entrada</div>
            </div>
            <div className="text-xs text-[#9CA3AF]">Monitoramento à parte do reembolso do produto de entrada (produto a definir; dado fictício).</div>

            <div className="mt-5 h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={reembolso} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="data" tick={{ fill: '#8A90A0', fontSize: 10 }} tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} minTickGap={20} />
                  <YAxis
                    tick={{ fill: '#8A90A0', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={52}
                    domain={yDomainR}
                    tickFormatter={(v) => { const n = Number(v); const a = Math.abs(n); const s = a >= 1000 ? `${(a / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k` : String(a); return (n < 0 ? '-' : '') + s }}
                  />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
                  <Tooltip
                    cursor={{ stroke: 'rgba(255,255,255,0.15)', strokeWidth: 1 }}
                    content={(props) => {
                      const p = props as unknown as { active?: boolean; payload?: Array<{ payload: ReembolsoDia }> }
                      if (!p.active || !p.payload?.length) return null
                      const d = p.payload[0].payload
                      const subiu = (d.delta ?? 0) >= 0
                      return (
                        <div className="rounded-lg border border-white/10 bg-[#0E0F13] px-3 py-2 shadow-lg">
                          <div className="text-[11px] text-[#9CA3AF]">{DIA_LONGO[d.diaSemana] ?? d.diaSemana} · {d.data}</div>
                          <div className={`${display.className} text-sm font-bold text-rose-300`}>Reembolso {brl(d.reembolso)}</div>
                          {d.delta !== null && (
                            <div className="mt-0.5 text-[11px]" style={{ color: subiu ? '#FB7185' : '#34D399' }}>
                              Oscilação {subiu ? '▲' : '▼'} {brl(Math.abs(d.delta))}
                            </div>
                          )}
                        </div>
                      )
                    }}
                  />
                  <Legend iconType="plainline" formatter={(value) => <span style={{ color: '#9CA3AF', fontSize: 12 }}>{value}</span>} />
                  <Line type="monotone" name="Reembolso diário" dataKey="reembolso" stroke="#FB7185" strokeWidth={2} dot={false} activeDot={{ r: 5, fill: '#FB7185', stroke: '#15171D', strokeWidth: 2 }} />
                  <Line type="monotone" name="Oscilação vs dia anterior" dataKey="delta" stroke="#F59E0B" strokeWidth={2} dot={false} activeDot={{ r: 5, fill: '#F59E0B', stroke: '#15171D', strokeWidth: 2 }} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <div className="text-[11px] text-[#9CA3AF]">Total reembolsado (30d)</div>
                <div className={`${display.className} mt-0.5 text-lg font-bold text-rose-300`}>{brl(totalReembolso)}</div>
                <div className="mt-0.5 text-[10px] text-[#6b7280]">produto de entrada (fictício)</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                <div className="text-[11px] text-[#9CA3AF]">Pior dia (amostra 30d)</div>
                <div className={`${display.className} mt-0.5 text-lg font-bold text-white`}>{DIA_LONGO[piorDia.dia] ?? piorDia.dia}</div>
                <div className="mt-0.5 text-[10px] text-[#6b7280]">~{brl(piorDia.media)}/dia</div>
              </div>
            </div>
          </section>
        </main>
        <MobileNav />
      </div>
    </ProtectedRoute>
  )
}

// ---------------------------------------------------------------------------
// Componentes visuais
// ---------------------------------------------------------------------------
function FunnelStage({ label, value, width, venda }: { label: string; value: string; width: number; venda?: boolean }) {
  return (
    <div
      className="rounded-xl px-5 py-3 text-center backdrop-blur-sm"
      style={{
        width: `${width}%`,
        minWidth: 200,
        background: venda ? 'rgba(249,115,22,0.10)' : 'rgba(20,22,28,0.72)',
        border: venda ? '1px solid rgba(249,115,22,0.35)' : '1px solid rgba(255,255,255,0.07)',
      }}
    >
      <div className="text-[11px] text-[#9CA3AF]">{label}</div>
      <div className={`${display.className} text-xl font-bold ${venda ? 'text-orange-300' : 'text-white'}`}>{value}</div>
    </div>
  )
}

function ConvPill({ rate, name, width, tone }: { rate: string; name: string; width: number; tone: number }) {
  const grads = [
    'linear-gradient(135deg,#FBBF24,#F59E0B)',
    'linear-gradient(135deg,#F59E0B,#F97316)',
    'linear-gradient(135deg,#F97316,#EA580C)',
  ]
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
      <span className={`text-sm tabular-nums ${strong ? 'text-white font-semibold' : deduz ? 'text-[#C89B9B]' : 'text-[#C9CED8]'} ${display.className}`}>
        {value}
      </span>
    </div>
  )
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="text-[11px] text-[#9CA3AF]">{label}</div>
      <div className={`${display.className} mt-0.5 text-lg font-bold text-white`}>{value}</div>
      <div className="text-[10px] text-[#6b7280] mt-0.5">{hint}</div>
    </div>
  )
}

