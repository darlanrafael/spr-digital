'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Space_Grotesk, Inter } from 'next/font/google'
import { Trophy, Video, Image as ImageIcon, TrendingUp, TrendingDown, RotateCcw, ExternalLink } from 'lucide-react'
import { LineChart, Line, ReferenceLine, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import ProtectedRoute from '@/components/ProtectedRoute'

export const dynamic = 'force-dynamic'

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] })
const ui = Inter({ subsets: ['latin'], weight: ['400', '500', '600'] })

type FunilItem = { id: string; nome: string; produtoLabel: string }
type Topo = { investido: number; impressoes: number; cliques: number; visitas: number; checkouts: number; alcanceAprox: number }
type Resultado = { faturamentoLiquido: number; impostos: number; trafegoComAcrescimo: number; resultadoLiquido: number; roas: number; margem: number }
type Criativo = {
  adId: string; criativo: string; formato: 'Vídeo' | 'Imagem'; thumbnail: string | null
  investido: number; vendasPrincipal: number; vendas: number; faturamento: number; roasPrincipal: number | null; roas: number | null; cpaPrincipal: number | null; cpa: number | null; ctr: number | null; hookRate: number | null
  previewUrl: string
  videoP25: number; videoP50: number; videoP75: number; videoP95: number
}
type VendaLinha = {
  id: string; nome: string; email: string; telefone: string
  produto: string; plataforma: string
  bruto: number; liquido: number
  dataHora: string; status: string; dataReembolso: string | null
}
type Detalhe = {
  funil: { id: string; nome: string; produtoLabel: string; impostoRate: number }
  topo: Topo
  vendas: number; vendasPrincipal: number; faturamentoBruto: number; taxas: number; investido: number
  resultado: Resultado
  resultadoDiario: { data: string; faturamento: number; resultadoLiquido: number }[]
  reembolsoDiario: { data: string; reembolso: number }[]
  melhorHorario: string
  totalReembolso: number
  vendasLista: VendaLinha[]
  reembolsosLista: VendaLinha[]
  esteira: { rotulo: string; vendas: number; faturamento: number }[]
  periodo: { de: string; ate: string }
  aviso: string | null
}

type PontoLinha = { data: string; valor: number; delta: number | null }
function comDelta<T extends { data: string }>(serie: T[], valorDe: (p: T) => number): PontoLinha[] {
  return serie.map((p, i) => ({
    data: p.data,
    valor: valorDe(p),
    delta: i === 0 ? null : valorDe(p) - valorDe(serie[i - 1]),
  }))
}

const DIA_LONGO: Record<string, string> = { '0': 'Domingo', '1': 'Segunda', '2': 'Terça', '3': 'Quarta', '4': 'Quinta', '5': 'Sexta', '6': 'Sábado' }
// O dia da semana com a MAIOR média do valor (melhor dia de resultado; pior dia de reembolso).
function diaDeMaiorMedia<T extends { data: string }>(serie: T[], valorDe: (p: T) => number): { dia: string; media: number } | null {
  const porDia: Record<number, number[]> = {}
  for (const p of serie) { const wd = new Date(`${p.data}T12:00:00`).getDay(); (porDia[wd] ||= []).push(valorDe(p)) }
  const medias = Object.entries(porDia).map(([wd, vs]) => ({ wd: Number(wd), media: vs.reduce((a, b) => a + b, 0) / vs.length }))
  if (!medias.length) return null
  const best = medias.reduce((b, d) => (d.media > b.media ? d : b))
  return { dia: DIA_LONGO[String(best.wd)] ?? '', media: best.media }
}

// V2 (vídeo "Dashboard V14"): card bem arredondado, com GRADIENTE sutil (não mais
// chapado), brilho no topo (inset) + sombra funda = profundidade "glass" na paleta
// escura atual. Mudança visível vs o card chapado do dashboard atual.
const CARD = 'rounded-[30px] border border-white/[0.08] bg-gradient-to-b from-[#1B1E27] to-[#121319] shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_24px_60px_-28px_rgba(0,0,0,0.9)]'
const EMPTY = '—'
const int = (n: number) => new Intl.NumberFormat('pt-BR').format(Math.round(n))
const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(n)
const brlCompact = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(n)
const pctFrac = (num: number, den: number) => (den > 0 ? `${(num / den * 100).toFixed(2).replace('.', ',')}%` : EMPTY)
const pctN = (n: number | null) => (n == null ? EMPTY : `${n.toFixed(2).replace('.', ',')}%`)
const roasFmt = (n: number) => `${n.toFixed(2).replace('.', ',')}x`
const fmtDiaBR = (iso: string) => (iso ? iso.slice(5).split('-').reverse().join('/') : '')
const fmtBR = (iso: string) => (iso ? iso.split('-').reverse().join('/') : EMPTY)
// data_hora é ISO em BRT ("2025-10-21T09:14:..."): mostra "21/10 09:14".
const fmtDataHora = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${iso.slice(11, 16)}` : EMPTY)
const POR_PAGINA = 10
const VENDAS_POR_PAGINA = 15

const PRESETS = [
  { value: 'today', label: 'Hoje' },
  { value: 'yesterday', label: 'Ontem' },
  { value: 'last_7d', label: '7 dias' },
  { value: 'last_30d', label: '30 dias' },
] as const

function Conteudo() {
  const router = useRouter()
  const sp = useSearchParams()
  const dateStart = sp.get('dateStart') || ''
  const dateEnd = sp.get('dateEnd') || ''
  const custom = !!(dateStart && dateEnd)
  const datePreset = custom ? '' : sp.get('datePreset') || 'last_30d'
  const query = custom ? `dateStart=${dateStart}&dateEnd=${dateEnd}` : `datePreset=${datePreset}`
  const funilId = sp.get('funilId') || ''

  const [de, setDe] = useState(dateStart)
  const [ate, setAte] = useState(dateEnd)
  const [funis, setFunis] = useState<FunilItem[]>([])
  const [listaCarregada, setListaCarregada] = useState(false)

  const [d, setD] = useState<Detalhe | null>(null)
  const [criativos, setCriativos] = useState<Criativo[]>([])
  const [naoAtribuido, setNaoAtribuido] = useState<{ vendas: number; faturamento: number }>({ vendas: 0, faturamento: 0 })
  const [carregandoCriativos, setCarregandoCriativos] = useState(false)
  const [somenteAtivos, setSomenteAtivos] = useState(true)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [pagina, setPagina] = useState(0)
  // Botao "Atualizar": cada clique incrementa e refaz as buscas com nocache=1
  // (dado do momento, furando o cache de 2min). Navegar zera (volta a usar cache).
  const [refresh, setRefresh] = useState(0)
  const noCache = refresh > 0 ? '&nocache=1' : ''
  // Abas dentro do funil: visão geral (funil + resultado + criativos + gráficos)
  // e vendas (lista como no setor de Vendas do DRE).
  const [abaInterna, setAbaInterna] = useState<'geral' | 'vendas'>('geral')
  const [subVendas, setSubVendas] = useState<'aprovadas' | 'reembolsos'>('aprovadas')
  const [pagVendas, setPagVendas] = useState(0)

  // Lista de funis (abas) - do config no código, instantâneo.
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

  // Limpa a tela só quando TROCA de funil (aí sim mostra o "carregando" cheio).
  // Mudar só o PERÍODO não limpa: mantém os números atuais e troca quando chegam.
  useEffect(() => {
    setD(null); setCriativos([]); setNaoAtribuido({ vendas: 0, faturamento: 0 }); setPagVendas(0)
  }, [funilId])

  // Dados do funil selecionado. Duas buscas: o RESUMO (rápido: funil, resultado,
  // gráficos) e os CRIATIVOS (lento: todos os anúncios da Meta) em paralelo, pra
  // a tela não ficar travada esperando a Meta. NÃO limpa os dados atuais no
  // refetch de período - só marca "carregando" e substitui quando chega.
  useEffect(() => {
    if (!funilId) return
    let cancelado = false
    setCarregando(true); setErro(null); setPagina(0)
    fetch(`/api/funis/performance?funilId=${funilId}&${query}${noCache}`)
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Falha ao carregar'); return j })
      .then((j: Detalhe) => { if (!cancelado) setD(j) })
      .catch(e => { if (!cancelado) setErro(e instanceof Error ? e.message : 'Falha ao carregar') })
      .finally(() => { if (!cancelado) setCarregando(false) })
    return () => { cancelado = true }
  }, [funilId, query, refresh])

  // Criativos num efeito à parte: recarrega também quando liga/desliga "Somente
  // ativos" (ativos = só os que gastaram no período, busca rápida; todos = pesada).
  useEffect(() => {
    if (!funilId) return
    let cancelado = false
    setCriativos([]); setNaoAtribuido({ vendas: 0, faturamento: 0 }); setCarregandoCriativos(true); setPagina(0)
    fetch(`/api/funis/performance?funilId=${funilId}&${query}&criativos=1${somenteAtivos ? '' : '&todos=1'}${noCache}`)
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j?.error || 'Falha'); return j })
      .then((j: { criativos: Criativo[]; naoAtribuido: { vendas: number; faturamento: number } }) => {
        if (cancelado) return
        setCriativos(j.criativos || [])
        setNaoAtribuido(j.naoAtribuido || { vendas: 0, faturamento: 0 })
      })
      .catch(() => {})
      .finally(() => { if (!cancelado) setCarregandoCriativos(false) })
    return () => { cancelado = true }
  }, [funilId, query, somenteAtivos, refresh])

  // Navegar (funil/período/data) volta a usar o cache: zera o refresh.
  function selecionar(id: string) { setRefresh(0); router.push(`/performance-funis/dashboard?funilId=${id}&${query}`) }
  function trocarPreset(p: string) {
    setRefresh(0); setDe(''); setAte('')
    router.push(`/performance-funis/dashboard?${funilId ? `funilId=${funilId}&` : ''}datePreset=${p}`)
  }
  // Sem botão "ok": aplica assim que as duas datas estão preenchidas.
  function mudarData(novoDe: string, novoAte: string) {
    setRefresh(0); setDe(novoDe); setAte(novoAte)
    if (novoDe && novoAte) {
      const [a, b] = novoDe <= novoAte ? [novoDe, novoAte] : [novoAte, novoDe]
      router.push(`/performance-funis/dashboard?${funilId ? `funilId=${funilId}&` : ''}dateStart=${a}&dateEnd=${b}`)
    }
  }
  // Botão "Atualizar": busca o dado do momento (fura o cache), sem recarregar a página.
  function atualizar() { if (funilId) setRefresh(n => n + 1) }

  const totalPaginas = Math.max(1, Math.ceil(criativos.length / POR_PAGINA))
  const paginaSegura = Math.min(pagina, totalPaginas - 1)
  const inicio = paginaSegura * POR_PAGINA
  const criativosVisiveis = criativos.slice(inicio, inicio + POR_PAGINA)
  const positivo = (d?.resultado.resultadoLiquido ?? 0) >= 0
  const serieRes = comDelta(d?.resultadoDiario ?? [], p => p.resultadoLiquido)
  const serieReemb = comDelta(d?.reembolsoDiario ?? [], p => p.reembolso)
  const melhorDiaRes = diaDeMaiorMedia(d?.resultadoDiario ?? [], p => p.resultadoLiquido)
  const piorDiaReemb = diaDeMaiorMedia(d?.reembolsoDiario ?? [], p => p.reembolso)
  const listaVendas = !d ? [] : (subVendas === 'aprovadas' ? d.vendasLista : d.reembolsosLista)
  const totalPagVendas = Math.max(1, Math.ceil(listaVendas.length / VENDAS_POR_PAGINA))
  const pagVendasSegura = Math.min(pagVendas, totalPagVendas - 1)
  const vendasVisiveis = listaVendas.slice(pagVendasSegura * VENDAS_POR_PAGINA, pagVendasSegura * VENDAS_POR_PAGINA + VENDAS_POR_PAGINA)

  return (
    <>
      {/* V2: brilho ambiente sutil no topo (atmosfera, estilo do vídeo) */}
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[380px]"
        style={{ background: 'radial-gradient(55% 100% at 50% 0%, rgba(249,115,22,0.12), transparent 72%)' }} />
      {/* Cabeçalho + período */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className={`${display.className} text-[2.6rem] font-bold leading-[1.05] tracking-tight`}>Performance de Funis</h1>
          <p className="mt-2 text-sm text-[#9CA3AF]">Do clique no anúncio ao que sobra no bolso, por produto.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full border border-white/[0.07] bg-[#181A20] p-1">
            {PRESETS.map(p => (
              <button key={p.value} onClick={() => trocarPreset(p.value)}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                  !custom && datePreset === p.value ? 'bg-white/10 text-white' : 'text-[#9CA3AF] hover:text-white'}`}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-[#181A20] px-3.5 py-2">
            <input type="date" value={de} max={ate || undefined} onChange={e => mudarData(e.target.value, ate)}
              className="bg-transparent text-xs text-white [color-scheme:dark] outline-none" />
            <span className="text-[#6b7280] text-xs">→</span>
            <input type="date" value={ate} min={de || undefined} onChange={e => mudarData(de, e.target.value)}
              className="bg-transparent text-xs text-white [color-scheme:dark] outline-none" />
          </div>
          <button onClick={atualizar} disabled={!funilId || carregando || carregandoCriativos}
            title="Atualizar com os dados deste momento"
            className="inline-flex items-center gap-1.5 rounded-full border border-orange-500/60 bg-orange-500/10 px-4 py-2 text-xs font-medium text-orange-300 transition-colors hover:bg-orange-500/20 hover:text-orange-200 disabled:cursor-not-allowed disabled:opacity-50">
            <RotateCcw size={14} className={carregando || carregandoCriativos ? 'animate-spin' : ''} />
            Atualizar
          </button>
        </div>
      </div>

      {/* Seletor de funil + abas (Visão geral / Vendas) ao lado */}
      <div className="mt-6">
        <label htmlFor="seletor-funil" className="block text-sm text-[#9CA3AF]">Selecione o funil</label>
        {listaCarregada && funis.length === 0 ? (
          <span className="mt-2 block text-sm text-[#9CA3AF]">Nenhum funil configurado.</span>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <div className="relative w-full max-w-xs">
              {/* Borda laranja FIXA (não é o anel de foco, que sumia ao clicar fora) */}
              <select id="seletor-funil" value={funilId ?? ''} onChange={e => selecionar(e.target.value)}
                className="w-full appearance-none rounded-2xl border-2 border-orange-500/70 bg-[#181A20] px-5 py-3.5 pr-11 text-sm font-semibold text-white outline-none focus:border-orange-400">
                {funis.map(x => <option key={x.id} value={x.id}>{x.nome}</option>)}
              </select>
              <svg className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-orange-300" width="16" height="16"
                fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg>
            </div>
            <div className="inline-flex rounded-full border border-white/[0.07] bg-[#181A20] p-1">
              {([['geral', 'Visão geral'], ['vendas', 'Vendas']] as const).map(([k, lbl]) => (
                <button key={k} onClick={() => setAbaInterna(k)}
                  className={`rounded-full px-5 py-2 text-sm font-semibold transition-colors ${
                    abaInterna === k ? 'bg-orange-500 text-[#140a00] shadow-[0_6px_16px_-6px_rgba(249,115,22,0.6)]' : 'text-[#9CA3AF] hover:text-white'}`}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {d?.aviso && <div className="mt-5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">{d.aviso}</div>}
      {erro && <div className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{erro}</div>}

      {!funilId ? null : (!d && carregando) ? (
        <div className={`${CARD} mt-6 p-10 text-center text-sm text-[#9CA3AF]`}>Carregando os dados...</div>
      ) : !d ? null : (
        <div className={`transition-opacity duration-200 ${carregando ? 'opacity-50' : 'opacity-100'}`}>
          {abaInterna === 'geral' && (<>
          {/* V2: fileira de cards de métrica no topo (estrutura do vídeo) */}
          <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className={`${CARD} p-5`}>
              <div className="text-xs text-[#9CA3AF]">Faturamento bruto</div>
              <div className={`${display.className} mt-2 text-[1.85rem] font-bold leading-none`}>{brl(d.faturamentoBruto)}</div>
              <div className="mt-2.5 text-[11px] text-[#6B7280]">{int(d.vendasPrincipal)} únicas · {int(d.vendas)} total</div>
            </div>
            <div className={`${CARD} p-5`}>
              <div className="flex items-center justify-between">
                <div className="text-xs text-[#9CA3AF]">Resultado líquido</div>
                {positivo ? <TrendingUp className="h-4 w-4 text-emerald-400" /> : <TrendingDown className="h-4 w-4 text-rose-400" />}
              </div>
              <div className={`${display.className} mt-2 text-[1.85rem] font-bold leading-none`} style={{ color: positivo ? '#34D399' : '#FB7185' }}>{brl(d.resultado.resultadoLiquido)}</div>
              <div className="mt-2.5 text-[11px] text-[#6B7280]">margem {pctN(d.resultado.margem * 100)}</div>
            </div>
            <div className={`${CARD} p-5`}>
              <div className="text-xs text-[#9CA3AF]">ROAS</div>
              <div className={`${display.className} mt-2 text-[1.85rem] font-bold leading-none text-orange-300`}>{roasFmt(d.resultado.roas)}</div>
              <div className="mt-2.5 text-[11px] text-[#6B7280]">retorno sobre o tráfego</div>
            </div>
            <div className={`${CARD} p-5`}>
              <div className="text-xs text-[#9CA3AF]">Investido (Meta)</div>
              <div className={`${display.className} mt-2 text-[1.85rem] font-bold leading-none`}>{brl(d.investido)}</div>
              <div className="mt-2.5 text-[11px] text-[#6B7280]">tráfego no período</div>
            </div>
          </div>
          {/* Corpo: funil (esquerda) + resultado (direita) */}
          <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[1.15fr_1fr]">
            {/* FUNIL */}
            <section className={`${CARD} p-6 sm:p-8`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className={`${display.className} text-lg font-semibold`}>Funil de vendas</div>
                  <div className="text-xs text-[#9CA3AF]">{d.funil.produtoLabel}</div>
                </div>
                <span className="text-[11px] text-orange-400/70">{fmtBR(d.periodo.de)} – {fmtBR(d.periodo.ate)}</span>
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
                  <FunnelStage label="Cliques no link" value={int(d.topo.cliques)} width={100} />
                  <ConvPill rate={pctFrac(d.topo.visitas, d.topo.cliques)} name="Tx de carregamento da página" width={90} tone={0} />
                  <FunnelStage label="Visualizações da página de destino" value={int(d.topo.visitas)} width={80} />
                  <ConvPill rate={pctFrac(d.topo.checkouts, d.topo.visitas)} name="Tx de conversão da página" width={68} tone={1} />
                  <FunnelStage label="Acessos ao checkout" value={int(d.topo.checkouts)} width={58} />
                  <ConvPill rate={pctFrac(d.vendasPrincipal, d.topo.checkouts)} name="Tx de conversão do checkout" width={48} tone={2} />
                  <FunnelStage label="Vendas únicas" value={int(d.vendasPrincipal)} width={46} venda
                    sub={`+ ${int(d.vendas - d.vendasPrincipal)} agregados · ${int(d.vendas)} total`} />
                  <div className="mt-2 rounded-xl px-6 py-4 text-center shadow-lg shadow-orange-900/30"
                    style={{ width: '44%', minWidth: 190, background: 'linear-gradient(135deg,#F59E0B,#EA580C)' }}>
                    <div className="text-[11px] font-medium text-orange-950/80">Faturamento bruto</div>
                    <div className={`${display.className} text-2xl font-bold text-[#1a0f00]`}>{brl(d.faturamentoBruto)}</div>
                  </div>
                </div>
              </div>
              <div className="mt-4 text-[11px] text-[#8A90A0]">Topo do funil (cliques, visualizações, checkout) vem da Meta; vendas e faturamento, do banco por produto.</div>
            </section>

            {/* RESULTADO */}
            <section className={`${CARD} p-6 sm:p-8 flex flex-col`}>
              <div className={`${display.className} text-lg font-semibold`}>Resultado</div>
              <div className="text-xs text-[#9CA3AF]">O que o funil deixa depois de tudo</div>

              <div className="mt-5 space-y-1.5">
                <WaterRow label="Faturamento bruto" value={brl(d.faturamentoBruto)} strong />
                <WaterRow label="− Taxas da plataforma" value={`− ${brl(d.taxas)}`} deduz />
                <WaterRow label="− Investimento em tráfego" value={`− ${brl(d.resultado.trafegoComAcrescimo)}`} deduz />
                <WaterRow label="− Impostos" value={`− ${brl(d.resultado.impostos)}`} deduz />
                <div className="my-2 h-px bg-white/10" />
                <WaterRow label="= Total líquido após todas as deduções" value={brl(d.resultado.resultadoLiquido)} strong />
              </div>

              <div className="mt-5 rounded-2xl border p-5"
                style={{
                  background: positivo ? 'rgba(52,211,153,0.08)' : 'rgba(251,113,133,0.08)',
                  borderColor: positivo ? 'rgba(52,211,153,0.3)' : 'rgba(251,113,133,0.3)',
                }}>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#C9CED8]">Resultado líquido</span>
                  {positivo ? <TrendingUp className="w-4 h-4 text-emerald-400" /> : <TrendingDown className="w-4 h-4 text-rose-400" />}
                </div>
                <div className={`${display.className} mt-1.5 text-[2.6rem] font-bold leading-none`} style={{ color: positivo ? '#34D399' : '#FB7185' }}>
                  {brl(d.resultado.resultadoLiquido)}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-3">
                <Kpi label="ROAS" value={roasFmt(d.resultado.roas)} hint="Bruto ÷ tráfego" />
                <Kpi label="Margem líquida" value={pctN(d.resultado.margem * 100)} hint="Líquido ÷ bruto" />
                <Kpi label="Investido" value={brlCompact(d.investido)} hint="Tráfego Meta" />
              </div>
            </section>
          </div>

          {/* CRIATIVOS */}
          <section className={`${CARD} mt-5 p-5 sm:p-7`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Trophy className="w-4 h-4 text-amber-400" />
                <div className={`${display.className} text-lg font-semibold`}>Criativos</div>
              </div>
              <button onClick={() => setSomenteAtivos(v => !v)} title={somenteAtivos ? 'Mostrando só os anúncios ATIVOS agora (que gastaram no período)' : 'Mostrando todos que gastaram no período (ativos e pausados)'}
                className={`flex items-center gap-2 rounded-full border px-1 py-1 pl-2.5 text-xs font-medium transition-colors ${somenteAtivos ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-white/10 bg-[#181A20] text-[#9CA3AF] hover:text-white hover:border-white/20'}`}>
                Somente ativos
                <span className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${somenteAtivos ? 'bg-emerald-500' : 'bg-white/15'}`}>
                  <span className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${somenteAtivos ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                </span>
              </button>
            </div>
            <div className="text-xs text-[#9CA3AF]">
              {somenteAtivos
                ? 'Anúncios ATIVOS agora que gastaram no período, do maior volume de vendas para o menor. Vendas atribuídas pela UTM.'
                : 'Todos que gastaram no período (ativos e pausados).'}
            </div>

            {carregandoCriativos && criativos.length === 0 ? (
              <div className="mt-4 flex items-center gap-2 text-sm text-[#9CA3AF]">
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
                Carregando os anúncios da Meta...
              </div>
            ) : criativos.length === 0 ? (
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
                      <th className="py-2 px-3 text-right font-medium">Vendas</th>
                      <th className="py-2 px-3 text-right font-medium">Com agregados</th>
                      <th className="py-2 px-3 text-right font-medium">Faturamento</th>
                      <th className="py-2 px-3 text-right font-medium">ROAS</th>
                      <th className="py-2 px-3 text-right font-medium">ROAS c/ agreg.</th>
                      <th className="py-2 px-3 text-right font-medium">CPA</th>
                      <th className="py-2 px-3 text-right font-medium">CPA c/ agreg.</th>
                      <th className="py-2 px-3 text-right font-medium">CTR</th>
                      <th className="py-2 px-3 text-right font-medium">Hook</th>
                      <th className="py-2 px-3 text-right font-medium">Viu 25%</th>
                      <th className="py-2 px-3 text-right font-medium">Viu 50%</th>
                      <th className="py-2 px-3 text-right font-medium">Viu 75%</th>
                      <th className="py-2 pl-3 text-right font-medium">Viu 95%</th>
                    </tr>
                  </thead>
                  <tbody className={display.className}>
                    {criativosVisiveis.map((cr, i) => {
                      const n = inicio + i
                      const top = n === 0 && cr.vendas > 0
                      return (
                        <tr key={cr.adId || n} className="border-b border-white/5 last:border-0"
                          style={top ? { background: 'rgba(245,158,11,0.05)' } : undefined}>
                          <td className="py-3 pr-3">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold"
                              style={{ background: top ? 'linear-gradient(135deg,#FBBF24,#EA580C)' : 'rgba(255,255,255,0.08)', color: top ? '#1a0f00' : '#C9CED8' }}>
                              {n + 1}
                            </span>
                          </td>
                          <td className="py-3 px-2">
                            {cr.previewUrl ? (
                              <a href={cr.previewUrl} target="_blank" rel="noopener noreferrer" title="Ver o anúncio"
                                className={`${ui.className} group flex items-center gap-2.5 min-w-0`}>
                                {cr.thumbnail
                                  ? <img src={cr.thumbnail} alt="" className="h-9 w-9 rounded-md object-cover shrink-0 border border-white/10" />
                                  : <div className="h-9 w-9 rounded-md bg-white/5 shrink-0" />}
                                <span className="font-medium text-white truncate max-w-[230px] group-hover:underline">{cr.criativo || '-'}</span>
                                <ExternalLink className="w-3.5 h-3.5 text-[#6B7280] shrink-0 group-hover:text-[#9CA3AF]" />
                              </a>
                            ) : (
                              <div className={`${ui.className} flex items-center gap-2.5 min-w-0`}>
                                {cr.thumbnail
                                  ? <img src={cr.thumbnail} alt="" className="h-9 w-9 rounded-md object-cover shrink-0 border border-white/10" />
                                  : <div className="h-9 w-9 rounded-md bg-white/5 shrink-0" />}
                                <span className="font-medium text-white truncate max-w-[260px]">{cr.criativo || '-'}</span>
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            <span className={`${ui.className} inline-flex items-center gap-1.5 text-[#9CA3AF]`}>
                              {cr.formato === 'Vídeo' ? <Video className="w-3.5 h-3.5 text-orange-300/70" /> : <ImageIcon className="w-3.5 h-3.5 text-sky-300/70" />}
                              {cr.formato}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right tabular-nums text-[#C9CED8]">{brl(cr.investido)}</td>
                          <td className="py-3 px-3 text-right tabular-nums font-bold text-white">{int(cr.vendasPrincipal)}</td>
                          <td className="py-3 px-3 text-right tabular-nums text-[#C9CED8]">{int(cr.vendas)}</td>
                          <td className="py-3 px-3 text-right tabular-nums text-[#C9CED8]">{brlCompact(cr.faturamento)}</td>
                          <td className="py-3 px-3 text-right tabular-nums font-bold text-emerald-300">{cr.roasPrincipal == null ? EMPTY : roasFmt(cr.roasPrincipal)}</td>
                          <td className="py-3 px-3 text-right tabular-nums text-emerald-300/70">{cr.roas == null ? EMPTY : roasFmt(cr.roas)}</td>
                          <td className="py-3 px-3 text-right tabular-nums text-[#C9CED8]">{cr.cpaPrincipal == null ? EMPTY : brlCompact(cr.cpaPrincipal)}</td>
                          <td className="py-3 px-3 text-right tabular-nums text-[#C9CED8]/70">{cr.cpa == null ? EMPTY : brlCompact(cr.cpa)}</td>
                          <td className="py-3 px-3 text-right tabular-nums text-[#C9CED8]">{pctN(cr.ctr)}</td>
                          <td className="py-3 px-3 text-right tabular-nums text-[#C9CED8]">{pctN(cr.hookRate)}</td>
                          <td className="py-3 px-3 text-right tabular-nums text-[#C9CED8]">{cr.formato === 'Vídeo' ? int(cr.videoP25) : EMPTY}</td>
                          <td className="py-3 px-3 text-right tabular-nums text-[#C9CED8]">{cr.formato === 'Vídeo' ? int(cr.videoP50) : EMPTY}</td>
                          <td className="py-3 px-3 text-right tabular-nums text-[#C9CED8]">{cr.formato === 'Vídeo' ? int(cr.videoP75) : EMPTY}</td>
                          <td className="py-3 pl-3 text-right tabular-nums text-[#C9CED8]">{cr.formato === 'Vídeo' ? int(cr.videoP95) : EMPTY}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {naoAtribuido.vendas > 0 && (
                  <div className="mt-3 text-[11px] text-[#8A90A0]">
                    + {int(naoAtribuido.vendas)} venda(s) sem anúncio identificável na UTM (orgânico / link na bio): {brl(naoAtribuido.faturamento)}.
                  </div>
                )}
                {totalPaginas > 1 && (
                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-[11px] text-[#8A90A0]">
                      {inicio + 1}–{Math.min(inicio + POR_PAGINA, criativos.length)} de {criativos.length} anúncios
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setPagina(p => Math.max(0, p - 1))}
                        disabled={paginaSegura === 0}
                        className="rounded-md border border-white/10 bg-[#181A20] px-2.5 py-1 text-xs text-[#C9CED8] disabled:opacity-40 hover:border-white/20 disabled:hover:border-white/10">
                        ‹ Anterior
                      </button>
                      <span className="px-1 text-xs tabular-nums text-[#9CA3AF]">{paginaSegura + 1} / {totalPaginas}</span>
                      <button
                        onClick={() => setPagina(p => Math.min(totalPaginas - 1, p + 1))}
                        disabled={paginaSegura >= totalPaginas - 1}
                        className="rounded-md border border-white/10 bg-[#181A20] px-2.5 py-1 text-xs text-[#C9CED8] disabled:opacity-40 hover:border-white/20 disabled:hover:border-white/10">
                        Próxima ›
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* RESULTADO LÍQUIDO DIÁRIO */}
          <GraficoDiario
            titulo="Resultado líquido diário" subtitulo="A cadência do que o funil deixou, dia a dia."
            icone={<TrendingUp className="w-4 h-4 text-emerald-400" />}
            data={serieRes} corPrincipal="#34D399" corNegativo="#FB7185" nomePrincipal="Líquido diário" subiuEhBom
            cards={<>
              <CardResumo label="Melhor dia (amostra)" valor={melhorDiaRes?.dia ?? EMPTY} cor="#34D399" hint={melhorDiaRes ? `~${brl(melhorDiaRes.media)}/dia` : ''} />
              <CardResumo label="Melhores horários" valor={d.melhorHorario} hint="maior volume de vendas" />
            </>} />

          {/* REEMBOLSOS DO FUNIL */}
          <GraficoDiario
            titulo="Reembolsos" subtitulo="Reembolsos dos produtos do funil, dia a dia."
            icone={<RotateCcw className="w-4 h-4 text-rose-400" />}
            data={serieReemb} corPrincipal="#FB7185" nomePrincipal="Reembolso diário" subiuEhBom={false}
            cards={<>
              <CardResumo label="Total reembolsado" valor={brl(d.totalReembolso)} cor="#FB7185" hint="reembolsos do funil no período" />
              <CardResumo label="Pior dia (amostra)" valor={piorDiaReemb?.dia ?? EMPTY} hint={piorDiaReemb ? `~${brl(piorDiaReemb.media)}/dia` : ''} />
            </>} />
          </>)}

          {abaInterna === 'vendas' && (
            <div className="mt-6 space-y-6">
              {/* ESTEIRA (funil de produtos): estágios FIXOS, montados sempre,
                  com ou sem venda no período. Boca = principal, afunila pros
                  order bumps (1 linha), upsell e backend. */}
              <div className={`${CARD} p-6 sm:p-8`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className={`${display.className} text-lg font-semibold`}>Funil de produtos (esteira)</div>
                    <div className="text-xs text-[#9CA3AF]">Performance dos produtos na esteira, da boca pro fim. Zerado = sem venda no período.</div>
                  </div>
                  <span className="text-[11px] text-orange-400/70">{fmtBR(d.periodo.de)} – {fmtBR(d.periodo.ate)}</span>
                </div>
                <FunilEsteira esteira={d.esteira} />
                <div className="mt-5 flex justify-between border-t border-white/10 pt-3 text-sm text-[#9CA3AF]">
                  <span>Soma da esteira</span>
                  <span className="font-semibold text-white">
                    {int(d.esteira.reduce((s, e) => s + e.vendas, 0))} vendas · {brl(d.esteira.reduce((s, e) => s + e.faturamento, 0))}
                  </span>
                </div>
              </div>

              {/* Sub-abas aprovadas / reembolsos, como no setor de Vendas do DRE */}
              <div className="flex flex-wrap gap-2">
                <button onClick={() => { setSubVendas('aprovadas'); setPagVendas(0) }}
                  className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                    subVendas === 'aprovadas' ? 'bg-emerald-600 text-white' : 'bg-[#181A20] text-[#9CA3AF] hover:text-white'}`}>
                  Aprovadas
                  <span className={`rounded-full px-1.5 py-0.5 text-xs ${subVendas === 'aprovadas' ? 'bg-white/20' : 'bg-emerald-600/30 text-emerald-400'}`}>{d.vendasLista.length}</span>
                </button>
                <button onClick={() => { setSubVendas('reembolsos'); setPagVendas(0) }}
                  className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                    subVendas === 'reembolsos' ? 'bg-rose-600 text-white' : 'bg-[#181A20] text-[#9CA3AF] hover:text-white'}`}>
                  Reembolsos
                  <span className={`rounded-full px-1.5 py-0.5 text-xs ${subVendas === 'reembolsos' ? 'bg-white/20' : 'bg-rose-600/30 text-rose-400'}`}>{d.reembolsosLista.length}</span>
                </button>
              </div>

              <div className={`${CARD} mt-4`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" style={{ minWidth: 760 }}>
                    <thead>
                      <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-wide text-[#6B7280]">
                        <th className="px-4 py-3 font-medium">Nome</th>
                        <th className="hidden px-4 py-3 font-medium md:table-cell">E-mail</th>
                        <th className="hidden px-4 py-3 font-medium lg:table-cell">Telefone</th>
                        <th className="px-4 py-3 font-medium">Produto</th>
                        <th className="hidden px-4 py-3 font-medium sm:table-cell">Plataforma</th>
                        <th className="px-4 py-3 text-right font-medium">Bruto</th>
                        <th className="hidden px-4 py-3 text-right font-medium md:table-cell">Líquido</th>
                        <th className="px-4 py-3 text-right font-medium">{subVendas === 'reembolsos' ? 'Reembolso' : 'Data'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {listaVendas.length === 0 ? (
                        <tr><td colSpan={8} className="px-4 py-10 text-center text-[#9CA3AF]">Nenhuma venda no período.</td></tr>
                      ) : vendasVisiveis.map(v => (
                        <tr key={v.id} className="border-b border-white/5 last:border-0">
                          <td className="px-4 py-3">{v.nome || EMPTY}</td>
                          <td className="hidden px-4 py-3 text-[#9CA3AF] md:table-cell">{v.email || EMPTY}</td>
                          <td className="hidden px-4 py-3 text-[#9CA3AF] lg:table-cell">{v.telefone || EMPTY}</td>
                          <td className="px-4 py-3">{v.produto}</td>
                          <td className="hidden px-4 py-3 capitalize text-[#9CA3AF] sm:table-cell">{v.plataforma}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{brl(v.bruto)}</td>
                          <td className="hidden px-4 py-3 text-right tabular-nums text-[#9CA3AF] md:table-cell">{brl(v.liquido)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-[#9CA3AF]">{subVendas === 'reembolsos' ? fmtDiaBR(v.dataReembolso ?? '') || EMPTY : fmtDataHora(v.dataHora)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {totalPagVendas > 1 && (
                <div className="mt-4 flex items-center justify-between">
                  <span className="text-[11px] text-[#8A90A0]">
                    {pagVendasSegura * VENDAS_POR_PAGINA + 1}–{Math.min(pagVendasSegura * VENDAS_POR_PAGINA + VENDAS_POR_PAGINA, listaVendas.length)} de {listaVendas.length} vendas
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setPagVendas(p => Math.max(0, p - 1))} disabled={pagVendasSegura === 0}
                      className="rounded-md border border-white/10 bg-[#181A20] px-2.5 py-1 text-xs text-[#C9CED8] hover:border-white/20 disabled:opacity-40 disabled:hover:border-white/10">‹ Anterior</button>
                    <span className="px-1 text-xs tabular-nums text-[#9CA3AF]">{pagVendasSegura + 1} / {totalPagVendas}</span>
                    <button onClick={() => setPagVendas(p => Math.min(totalPagVendas - 1, p + 1))} disabled={pagVendasSegura >= totalPagVendas - 1}
                      className="rounded-md border border-white/10 bg-[#181A20] px-2.5 py-1 text-xs text-[#C9CED8] hover:border-white/20 disabled:opacity-40 disabled:hover:border-white/10">Próxima ›</button>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      )}
    </>
  )
}

// Curva suave (Catmull-Rom -> Bézier) passando pelos pontos.
function spline(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return pts.length ? `M ${pts[0].x} ${pts[0].y}` : ''
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`
  }
  return d
}

// Funil de produtos HORIZONTAL (estilo "Funil de Conversão"): banda suave que
// afunila da esquerda (boca = principal) pra direita; gradiente azul->rosa; % no
// meio (relativo à boca), nº de vendas e faturamento embaixo. Estágios FIXOS -
// renderiza sempre, zerado quando não há venda (banda com altura mínima visível).
function FunilEsteira({ esteira }: { esteira: { rotulo: string; vendas: number; faturamento: number }[] }) {
  const n = esteira.length
  if (n === 0) return null
  const W = 1000, H = 300, mid = H / 2
  const colW = W / n
  const base = esteira[0]?.vendas || 0
  const maxV = Math.max(...esteira.map(e => e.vendas), 1)
  const half = (v: number) => Math.max(8, (v / maxV) * (H * 0.42)) // piso de 8 -> sempre visível
  const centros = esteira.map((e, i) => ({ x: colW * i + colW / 2, h: half(e.vendas) }))
  const pontos = [{ x: 0, h: centros[0].h }, ...centros, { x: W, h: centros[n - 1].h }]
  const topo = spline(pontos.map(p => ({ x: p.x, y: mid - p.h })))
  const baseInf = spline([...pontos].reverse().map(p => ({ x: p.x, y: mid + p.h }))).replace(/^M/, 'L')
  const d = `${topo} ${baseInf} Z`
  const pct = (v: number) => (base > 0 ? `${(v / base * 100).toFixed(1).replace('.', ',')}%` : '0%')
  const cols = { display: 'grid', gridTemplateColumns: `repeat(${n}, 1fr)` } as const
  return (
    <div className="mt-6">
      <div style={cols} className="gap-1">
        {esteira.map((e, i) => (
          <div key={i} className="truncate px-1 text-center text-[11px] font-medium text-[#C9CED8]" title={e.rotulo}>{e.rotulo}</div>
        ))}
      </div>
      <div className="relative mt-1">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-48 w-full">
          <defs>
            <linearGradient id="esteira-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#3B6EF6" />
              <stop offset="55%" stopColor="#8B5CF6" />
              <stop offset="100%" stopColor="#EC4899" />
            </linearGradient>
          </defs>
          {esteira.slice(1).map((_, i) => (
            <line key={i} x1={colW * (i + 1)} y1="0" x2={colW * (i + 1)} y2={H} stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" />
          ))}
          <path d={d} fill="url(#esteira-grad)" />
        </svg>
        <div style={cols} className="pointer-events-none absolute inset-0 items-center">
          {esteira.map((e, i) => (
            <div key={i} className="text-center text-sm font-bold text-white drop-shadow">{pct(e.vendas)}</div>
          ))}
        </div>
      </div>
      <div style={cols} className="mt-2 gap-1">
        {esteira.map((e, i) => (
          <div key={i} className="px-1 text-center">
            <div className={`${display.className} text-base font-bold text-white`}>{int(e.vendas)}</div>
            <div className="text-[11px] text-[#9CA3AF]">{brlCompact(e.faturamento)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function FunnelStage({ label, value, width, venda, sub }: { label: string; value: string; width: number; venda?: boolean; sub?: string }) {
  return (
    <div className="rounded-xl px-5 py-3 text-center backdrop-blur-sm"
      style={{ width: `${width}%`, minWidth: 200,
        background: venda ? 'rgba(249,115,22,0.10)' : 'rgba(20,22,28,0.72)',
        border: venda ? '1px solid rgba(249,115,22,0.35)' : '1px solid rgba(255,255,255,0.07)' }}>
      <div className="text-[11px] text-[#9CA3AF]">{label}</div>
      <div className={`${display.className} text-xl font-bold ${venda ? 'text-orange-300' : 'text-white'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-[#9CA3AF]">{sub}</div>}
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

const diaSemana = (iso: string) => DIA_LONGO[String(new Date(`${iso}T12:00:00`).getDay())] ?? ''
const kfmt = (v: number) => { const a = Math.abs(v); const s = a >= 1000 ? `${(a / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k` : String(Math.round(a)); return (v < 0 ? '-' : '') + s }

function GraficoDiario(
  { titulo, subtitulo, icone, data, corPrincipal, nomePrincipal, subiuEhBom, corNegativo, cards }:
  { titulo: string; subtitulo: string; icone: React.ReactNode; data: PontoLinha[]; corPrincipal: string; nomePrincipal: string; subiuEhBom: boolean; corNegativo?: string; cards?: React.ReactNode },
) {
  const vals = data.flatMap(d => (d.delta === null ? [d.valor] : [d.valor, d.delta]))
  const yMin = Math.min(0, ...(vals.length ? vals : [0]))
  const yMax = Math.max(0, ...(vals.length ? vals : [0]))
  const pad = (yMax - yMin) * 0.35 || 1
  return (
    <section className={`${CARD} mt-5 p-5 sm:p-7`}>
      <div className="flex items-center gap-2">{icone}<div className={`${display.className} text-lg font-semibold`}>{titulo}</div></div>
      <div className="text-xs text-[#9CA3AF]">{subtitulo}</div>
      {data.length === 0 ? (
        <div className="mt-4 text-sm text-[#9CA3AF]">Sem dados no período.</div>
      ) : (
        <div className="mt-5 h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="data" tickFormatter={fmtDiaBR} tick={{ fill: '#8A90A0', fontSize: 10 }} tickLine={false} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} minTickGap={20} />
              <YAxis width={52} domain={[Math.round(yMin - pad), Math.round(yMax + pad)]} tick={{ fill: '#8A90A0', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => kfmt(Number(v))} />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
              <Tooltip cursor={{ stroke: 'rgba(255,255,255,0.15)', strokeWidth: 1 }}
                content={(props) => {
                  const p = props as unknown as { active?: boolean; payload?: Array<{ payload: PontoLinha }> }
                  if (!p.active || !p.payload?.length) return null
                  const pt = p.payload[0].payload
                  const subiu = (pt.delta ?? 0) >= 0
                  const corDelta = (subiu === subiuEhBom) ? '#34D399' : '#FB7185'
                  return (
                    <div className="rounded-lg border border-white/10 bg-[#0E0F13] px-3 py-2 shadow-lg">
                      <div className="text-[11px] text-[#9CA3AF]">{diaSemana(pt.data)} · {fmtDiaBR(pt.data)}</div>
                      <div className={`${display.className} text-sm font-bold`} style={{ color: (corNegativo && pt.valor < 0) ? corNegativo : corPrincipal }}>{nomePrincipal} {brl(pt.valor)}</div>
                      {pt.delta !== null && (
                        <div className="mt-0.5 text-[11px]" style={{ color: corDelta }}>Oscilação {subiu ? '▲' : '▼'} {brl(Math.abs(pt.delta))}</div>
                      )}
                    </div>
                  )
                }} />
              <Legend iconType="plainline" formatter={(value) => <span style={{ color: '#9CA3AF', fontSize: 12 }}>{value}</span>} />
              <Line type="monotone" name={nomePrincipal} dataKey="valor" stroke={corPrincipal} strokeWidth={2} dot={false} activeDot={{ r: 5, fill: corPrincipal, stroke: '#15171D', strokeWidth: 2 }} />
              <Line type="monotone" name="Oscilação vs dia anterior" dataKey="delta" stroke="#F59E0B" strokeWidth={2} dot={false} activeDot={{ r: 5, fill: '#F59E0B', stroke: '#15171D', strokeWidth: 2 }} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {cards && <div className="mt-4 grid grid-cols-2 gap-3">{cards}</div>}
    </section>
  )
}

function CardResumo({ label, valor, cor, hint }: { label: string; valor: string; cor?: string; hint: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="text-[11px] text-[#9CA3AF]">{label}</div>
      <div className={`${display.className} mt-0.5 text-lg font-bold`} style={{ color: cor ?? '#fff' }}>{valor}</div>
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
          <Suspense fallback={<div className="text-sm text-[#9CA3AF]">Carregando...</div>}>
            <Conteudo />
          </Suspense>
        </main>
        <MobileNav />
      </div>
    </ProtectedRoute>
  )
}
