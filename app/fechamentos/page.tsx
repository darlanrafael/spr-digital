'use client'

import { useState, useMemo, useEffect } from 'react'
import { AlertCircle, CheckCircle, ChevronRight, ChevronDown, ChevronUp, Clock, Download, Loader2, X } from 'lucide-react'
import { useApp } from '@/contexts/AppContext'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import PlatformBadge from '@/components/PlatformBadge'
import ProtectedRoute from '@/components/ProtectedRoute'
import Pagination from '@/components/Pagination'
import { formatCurrency, formatDate, formatDateTime, getSaleBruto, getAliquotaByPreco, getImpostoBase } from '@/lib/formatters'
import { Closing, ClosingBuyer, CashflowEntry } from '@/types'
import { addClosing as svcAddClosing, addCashflowEntry as svcAddCashflow } from '@/lib/services'
import { getSupabaseClient } from '@/lib/supabase'

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
  const [periodo, setPeriodo] = useState(() => {
    const d = new Date()
    const ano = d.getFullYear()
    const mes = String(d.getMonth() + 1).padStart(2, '0')
    return { inicio: `${ano}-${mes}-01`, fim: `${ano}-${mes}-${String(d.getDate()).padStart(2, '0')}` }
  })
  const [selectedProducts, setSelectedProducts] = useState<string[]>([])

  type PeriodoGrupo = { id: string; inicio: string; fim: string; produtos: string[] }
  const [periodosGrupos, setPeriodosGrupos] = useState<PeriodoGrupo[]>([])

  function addPeriodoGrupo() {
    setPeriodosGrupos(prev => [...prev, { id: `pg_${Date.now()}`, inicio: '', fim: '', produtos: [] }])
  }
  function removePeriodoGrupo(id: string) {
    setPeriodosGrupos(prev => prev.filter(g => g.id !== id))
  }
  function updatePeriodoGrupo(id: string, patch: Partial<Omit<PeriodoGrupo, 'id'>>) {
    setPeriodosGrupos(prev => prev.map(g => g.id === id ? { ...g, ...patch } : g))
  }
  function toggleProdutoNoGrupo(grupoId: string, produtoId: string) {
    const grupo = periodosGrupos.find(g => g.id === grupoId)
    const estaAtribuindo = grupo ? !grupo.produtos.includes(produtoId) : true
    setPeriodosGrupos(prev => prev.map(g => g.id === grupoId
      ? { ...g, produtos: g.produtos.includes(produtoId) ? g.produtos.filter(p => p !== produtoId) : [...g.produtos, produtoId] }
      : g
    ))
    // Atribuir um produto a um período próprio já marca ele em "Produtos incluídos" —
    // sem isso, o produto ficava com período customizado mas de fora do fechamento.
    if (estaAtribuindo) {
      setSelectedProducts(prev => prev.includes(produtoId) ? prev : [...prev, produtoId])
    }
  }
  // Cada produto só pode estar atribuído a um período por vez — o mais recente que o incluir vence.
  const produtoParaGrupo = useMemo(() => {
    const map: Record<string, PeriodoGrupo> = {}
    for (const g of periodosGrupos) {
      for (const produtoId of g.produtos) map[produtoId] = g
    }
    return map
  }, [periodosGrupos])
  const [socioInputs, setSocioInputs] = useState(['50', '50'])
  const [confirmed, setConfirmed] = useState(false)
  const [confirmedClosing, setConfirmedClosing] = useState<Closing | null>(null)
  const [successMsg, setSuccessMsg] = useState('')

  const [trafego, setTrafego] = useState<{
    periodo: { inicio: string; fim: string }
    termos: string[]
    termoInput: string
    loading: boolean
    erro: string | null
    total: number
    campanhas: { name: string; spend: number; accountId: string }[]
  }>({
    periodo: { inicio: '', fim: '' },
    termos: [],
    termoInput: '',
    loading: false,
    erro: null,
    total: 0,
    campanhas: [],
  })

  const TRAFEGO_PAGE_SIZE = 8
  const [trafegoPage, setTrafegoPage] = useState(1)
  const trafegoTotalPages = Math.max(1, Math.ceil(trafego.campanhas.length / TRAFEGO_PAGE_SIZE))
  const trafegoPageClamped = Math.min(trafegoPage, trafegoTotalPages)
  const trafegoCampanhasPaginadas = trafego.campanhas.slice(
    (trafegoPageClamped - 1) * TRAFEGO_PAGE_SIZE,
    trafegoPageClamped * TRAFEGO_PAGE_SIZE
  )

  const [custosFunil, setCustosFunil] = useState<{ id: string; descricao: string; valor: string }[]>([])

  function addCustoFunil() {
    setCustosFunil(prev => [...prev, { id: crypto.randomUUID(), descricao: '', valor: '' }])
  }
  function updateCustoFunil(id: string, field: 'descricao' | 'valor', value: string) {
    setCustosFunil(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c))
  }
  function removeCustoFunil(id: string) {
    setCustosFunil(prev => prev.filter(c => c.id !== id))
  }
  const custosFunilTotal = custosFunil.reduce((a, c) => a + (parseFloat(c.valor.replace(',', '.')) || 0), 0)

  // Terapeutas cadastradas com comissão — usado pra identificar o repasse
  // devido em produtos que levam o nome delas (ex.: "Mentoria Particular -
  // Pedro | Denise"). Produtos só com "Pedro Roncada" são dele mesmo (sócio),
  // sem repasse.
  const [terapeutasComissao, setTerapeutasComissao] = useState<{ nome: string; percentual_comissao: number }[]>([])
  useEffect(() => {
    const client = getSupabaseClient()
    if (!client) return
    client.from('terapeutas').select('nome,percentual_comissao').eq('ativo', true)
      .then(({ data }) => setTerapeutasComissao((data ?? []) as { nome: string; percentual_comissao: number }[]))
  }, [])
  function matchTerapeutaComissao(produtoNome: string): { nome: string; percentual_comissao: number } | null {
    const lower = produtoNome.toLowerCase()
    return terapeutasComissao.find(t => lower.includes(t.nome.trim().split(' ')[0].toLowerCase())) ?? null
  }

  function addTermoTrafego() {
    const termo = trafego.termoInput.trim()
    if (!termo || trafego.termos.includes(termo)) return
    setTrafego(t => ({ ...t, termos: [...t.termos, termo], termoInput: '' }))
  }

  function removeTermoTrafego(termo: string) {
    setTrafego(t => ({ ...t, termos: t.termos.filter(x => x !== termo) }))
  }

  async function buscarTrafego() {
    if (!trafego.periodo.inicio || !trafego.periodo.fim || trafego.termos.length === 0) return
    setTrafego(t => ({ ...t, loading: true, erro: null }))
    try {
      const params = new URLSearchParams({ dateStart: trafego.periodo.inicio, dateEnd: trafego.periodo.fim })
      trafego.termos.forEach(termo => params.append('termos', termo))
      const res = await fetch(`/api/meta/custo-trafego?${params.toString()}`, { cache: 'no-store' })
      const data = await res.json() as { total?: number; campanhas?: { name: string; spend: number; accountId: string }[]; erro?: string }
      const totalBruto = typeof data.total === 'number' ? data.total : 0
      setTrafego(t => ({
        ...t,
        loading: false,
        total: totalBruto * 1.1385, // acrescenta 13,85% sobre o gasto bruto de tráfego
        campanhas: data.campanhas ?? [],
        erro: data.erro ?? null,
      }))
      setTrafegoPage(1)
    } catch {
      setTrafego(t => ({ ...t, loading: false, erro: 'Falha ao buscar custo de tráfego' }))
    }
  }

  const canEdit = user?.role === 'admin'
  const productMap = useMemo(() => Object.fromEntries(products.map(p => [p.id, p])), [products])

  const [custosPeriodo, setCustosPeriodo] = useState(() => {
    const d = new Date()
    const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    return { inicio: mes, fim: mes }
  })

  const fixedCostsIncluidos = useMemo(
    () => costs.fixos.filter(c => {
      const mes = c.data.slice(0, 7)
      return mes >= custosPeriodo.inicio && mes <= custosPeriodo.fim
    }),
    [costs.fixos, custosPeriodo]
  )
  const variableCostsIncluidos = useMemo(
    () => costs.variaveis.filter(v => {
      const mes = v.data.slice(0, 7)
      return mes >= custosPeriodo.inicio && mes <= custosPeriodo.fim
    }),
    [costs.variaveis, custosPeriodo]
  )
  const fixedTotal = fixedCostsIncluidos.reduce((a, c) => a + c.valor, 0)
  const varTotal = variableCostsIncluidos.reduce((a, v) => a + v.valor, 0)
  const totalCosts = fixedTotal + varTotal + trafego.total + custosFunilTotal

  const periodSales = useMemo(() => {
    return sales.filter(s => {
      const matchProject = selectedProject === 'all' || s.projetoId === selectedProject
      const d = s.data_hora.slice(0, 10)
      const grupo = produtoParaGrupo[s.produto]
      const efetivoInicio = grupo?.inicio || periodo.inicio
      const efetivoFim = grupo?.fim || periodo.fim
      const matchPeriod = !!efetivoInicio && !!efetivoFim && d >= efetivoInicio && d <= efetivoFim
      const matchProduct = selectedProducts.includes(s.produto)
      return s.status === 'aprovada' && matchProject && matchPeriod && matchProduct
    })
  }, [sales, periodo, selectedProject, selectedProducts, produtoParaGrupo])

  const byProduct = useMemo(() => {
    const map: Record<string, {
      id: string; nome: string; plataforma: string; qtd: number
      bruto: number; taxas: number; aliquota: number; imposto: number; liquido: number; liquido_pos_impostos: number
      terapeuta_nome: string | null; repasse_terapeuta: number
    }> = {}
    for (const s of periodSales) {
      const prod = productMap[s.produto]
      const aliquota = getAliquotaByPreco(s.preco_base)
      if (!map[s.produto]) {
        map[s.produto] = { id: s.produto, nome: prod?.nome ?? s.produto, plataforma: s.plataforma, qtd: 0, bruto: 0, taxas: 0, aliquota, imposto: 0, liquido: 0, liquido_pos_impostos: 0, terapeuta_nome: null, repasse_terapeuta: 0 }
      }
      const bruto = getSaleBruto(s)
      const impostoVenda = getImpostoBase(s) * (aliquota / 100)
      map[s.produto].qtd++
      map[s.produto].bruto += bruto
      map[s.produto].taxas += bruto - s.valor_liquido
      map[s.produto].imposto += impostoVenda
      map[s.produto].liquido += s.valor_liquido
      map[s.produto].liquido_pos_impostos += s.valor_liquido - impostoVenda
    }
    // Repasse à terapeuta: % dela sobre o líquido pós-impostos do produto que
    // leva o nome dela. "Mentoria Particular - Pedro Roncada" sozinho é dele
    // mesmo (sócio) — sem repasse.
    for (const row of Object.values(map)) {
      const terapeuta = matchTerapeutaComissao(row.nome)
      if (terapeuta) {
        row.terapeuta_nome = terapeuta.nome
        row.repasse_terapeuta = row.liquido_pos_impostos * (terapeuta.percentual_comissao / 100)
      }
    }
    return Object.values(map)
  }, [periodSales, productMap, terapeutasComissao])

  const faturamentoBruto = byProduct.reduce((a, p) => a + p.bruto, 0)
  const impostoTotal = byProduct.reduce((a, p) => a + p.imposto, 0)
  const taxasPlat = byProduct.reduce((a, p) => a + p.taxas, 0)
  const faturamentoLiquido = faturamentoBruto - taxasPlat - impostoTotal

  // Produtos de mentoria não entram na reserva de caixa (30%) — o lucro deles
  // vai para o Lucro Real líquido do repasse devido à terapeuta que atende
  // (ex.: 30% da Denise), já que quem entrega a sessão precisa ser pago antes
  // dos sócios receberem sua parte.
  const faturamentoLiquidoMentoria = byProduct
    .filter(p => p.nome.toLowerCase().includes('mentoria'))
    .reduce((a, p) => a + (p.bruto - p.taxas - p.imposto), 0)
  const repasseTerapeutasTotal = byProduct.reduce((a, p) => a + p.repasse_terapeuta, 0)

  const lucroBruto = faturamentoLiquido - totalCosts
  const lucroBrutoOutros = lucroBruto - faturamentoLiquidoMentoria
  // Sem reserva de caixa quando dá prejuízo — não tem como reservar 30% de um
  // valor negativo. Nesse caso o prejuízo inteiro (100%) vira Lucro Real
  // negativo, pra ser distribuído (rateado) entre os sócios normalmente.
  const reservaCaixa = lucroBrutoOutros > 0 ? lucroBrutoOutros * 0.3 : 0
  const lucroRealOutros = lucroBrutoOutros > 0 ? lucroBrutoOutros * 0.7 : lucroBrutoOutros
  const lucroReal = lucroRealOutros + (faturamentoLiquidoMentoria - repasseTerapeutasTotal)

  const socioPercents = socioInputs.map(parsePercent)
  const socioTotal = socioPercents[0] + socioPercents[1]
  const isDistributionValid = Math.abs(socioTotal - 100) <= 0.01
  const socioValues = socioPercents.map(pct => lucroReal * (pct / 100))

  const availableProducts = useMemo(() => {
    // sale.produto é o nome do produto gravado pelo webhook (Hubla/Kiwify), não
    // o id do catálogo mock em `products` (prod_1, prod_2...) — nunca batem.
    // A lista de seleção precisa vir dos nomes reais que aparecem nas vendas.
    const nomes = new Set(sales.filter(s => selectedProject === 'all' || s.projetoId === selectedProject).map(s => s.produto))
    return Array.from(nomes).sort().map(nome => ({ id: nome, nome }))
  }, [sales, selectedProject])

  // Todos os produtos vêm marcados por padrão — evita o "vazio = todos" ambíguo
  // (o usuário via tudo destacado mesmo sem ter selecionado nada explicitamente).
  const [produtosInicializados, setProdutosInicializados] = useState(false)
  useEffect(() => {
    if (!produtosInicializados && availableProducts.length > 0) {
      setSelectedProducts(availableProducts.map(p => p.id))
      setProdutosInicializados(true)
    }
  }, [availableProducts, produtosInicializados])

  const lastClosed = closings[closings.length - 1]
  const alertas = lastClosed?.alertas ?? []
  const alertasTotal = alertas.reduce((a, x) => a + x.valor, 0)

  const efectivaAliquota = faturamentoBruto > 0
    ? ((impostoTotal / faturamentoBruto) * 100).toFixed(2)
    : null

  function toggleProduct(id: string) {
    setSelectedProducts(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id])
  }
  function selecionarTodosProdutos() {
    setSelectedProducts(availableProducts.map(p => p.id))
  }
  function desmarcarTodosProdutos() {
    setSelectedProducts([])
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
      custos_trafego_total: trafego.total,
      custos_trafego_periodo: trafego.total > 0 ? trafego.periodo : undefined,
      custos_trafego_termos: trafego.total > 0 ? trafego.termos : undefined,
      custos_trafego_campanhas: trafego.total > 0 ? trafego.campanhas : undefined,
      custos_funil_total: custosFunilTotal,
      custos_funil_itens: custosFunilTotal > 0
        ? custosFunil
            .filter(c => c.descricao.trim() && (parseFloat(c.valor.replace(',', '.')) || 0) > 0)
            .map(c => ({ descricao: c.descricao.trim(), valor: parseFloat(c.valor.replace(',', '.')) || 0 }))
        : undefined,
      produtos_periodos: periodosGrupos.length > 0
        ? periodosGrupos.map(g => ({
            inicio: g.inicio,
            fim: g.fim,
            produtos: g.produtos.map(id => productMap[id]?.nome ?? id),
          }))
        : undefined,
      lucroBruto,
      reservaCaixa,
      lucroReal,
      repasseTerapeutasTotal,
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
        terapeuta_nome: p.terapeuta_nome ?? undefined,
        repasse_terapeuta: p.repasse_terapeuta || undefined,
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
                  <h3 className="text-sm font-semibold text-white mb-3">Mês de referência dos custos</h3>
                  <p className="text-xs text-gray-500 mb-3">Define quais lançamentos de Custos Fixos e Variáveis entram neste fechamento (o preview abaixo já reflete o período escolhido).</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">De</label>
                      <input type="month" value={custosPeriodo.inicio}
                        onChange={e => setCustosPeriodo(p => ({ ...p, inicio: e.target.value }))}
                        className="bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-300 focus:outline-none focus:border-indigo-500" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Até</label>
                      <input type="month" value={custosPeriodo.fim}
                        onChange={e => setCustosPeriodo(p => ({ ...p, fim: e.target.value }))}
                        className="bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-300 focus:outline-none focus:border-indigo-500" />
                    </div>
                  </div>
                </div>

                <div className="bg-gray-900 rounded-xl border border-white/10 p-4">
                  <h3 className="text-sm font-semibold text-white mb-4">Custos Fixos</h3>
                  <div className="space-y-2">
                    {fixedCostsIncluidos.length === 0 ? (
                      <p className="text-xs text-gray-600">Nenhum custo fixo lançado neste período</p>
                    ) : fixedCostsIncluidos.map(c => (
                      <div key={c.id} className="flex justify-between text-xs">
                        <span className="text-gray-400">{c.descricao} <span className="text-gray-600">({c.data.slice(0, 7)})</span></span>
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
                    {variableCostsIncluidos.length === 0 ? (
                      <p className="text-xs text-gray-600">Nenhum custo variável lançado neste período</p>
                    ) : variableCostsIncluidos.map(c => (
                      <div key={c.id} className="flex justify-between text-xs">
                        <span className="text-gray-400">{c.descricao} <span className="text-gray-600">({formatDate(c.data)})</span></span>
                        <span className="text-gray-200">{formatCurrency(c.valor)}</span>
                      </div>
                    ))}
                    {variableCostsIncluidos.length > 0 && (
                      <div className="border-t border-white/10 pt-2 flex justify-between text-xs font-semibold">
                        <span className="text-gray-300">Subtotal Variáveis</span>
                        <span className="text-red-400">{formatCurrency(varTotal)}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-gray-900 rounded-xl border border-white/10 p-4">
                  <h3 className="text-sm font-semibold text-white mb-4">Custo de Tráfego</h3>
                  <div className="flex flex-wrap gap-3 mb-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Data início</label>
                      <input type="date" value={trafego.periodo.inicio}
                        onChange={e => setTrafego(t => ({ ...t, periodo: { ...t.periodo, inicio: e.target.value } }))}
                        className="bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-300 focus:outline-none focus:border-indigo-500" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Data fim</label>
                      <input type="date" value={trafego.periodo.fim}
                        onChange={e => setTrafego(t => ({ ...t, periodo: { ...t.periodo, fim: e.target.value } }))}
                        className="bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-300 focus:outline-none focus:border-indigo-500" />
                    </div>
                  </div>

                  <label className="block text-xs text-gray-400 mb-1">Termos de filtro (nome da campanha contém)</label>
                  <div className="flex gap-2 mb-2">
                    <input type="text" value={trafego.termoInput}
                      onChange={e => setTrafego(t => ({ ...t, termoInput: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTermoTrafego() } }}
                      placeholder="ex: funil1"
                      className="flex-1 bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500" />
                    <button onClick={addTermoTrafego}
                      className="px-3 py-2 rounded-lg text-xs font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors">
                      Adicionar
                    </button>
                  </div>

                  {trafego.termos.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {trafego.termos.map(termo => (
                        <span key={termo} className="flex items-center gap-1 bg-indigo-600/20 text-indigo-300 text-xs px-2 py-1 rounded-full">
                          {termo}
                          <button onClick={() => removeTermoTrafego(termo)} aria-label={`Remover ${termo}`}>
                            <X className="w-3 h-3 hover:text-white" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  <button onClick={buscarTrafego}
                    disabled={trafego.loading || !trafego.periodo.inicio || !trafego.periodo.fim || trafego.termos.length === 0}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs px-3 py-2 rounded-lg transition-colors mb-3">
                    {trafego.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    Buscar tráfego
                  </button>

                  {trafego.erro && (
                    <p className="text-xs text-red-400 mb-3">{trafego.erro}</p>
                  )}

                  {trafego.campanhas.length > 0 && (
                    <details className="mb-3">
                      <summary className="text-xs text-gray-500 cursor-pointer">Ver campanhas ({trafego.campanhas.length})</summary>
                      <div className="mt-2 space-y-1">
                        {trafegoCampanhasPaginadas.map((c, i) => (
                          <div key={`${c.name}-${i}`} className="flex justify-between text-xs">
                            <span className="text-gray-400">{c.name}</span>
                            <span className="text-gray-200">{formatCurrency(c.spend)}</span>
                          </div>
                        ))}
                      </div>
                      {trafegoTotalPages > 1 && (
                        <Pagination
                          currentPage={trafegoPageClamped}
                          totalPages={trafegoTotalPages}
                          onPrevious={() => setTrafegoPage(p => Math.max(1, p - 1))}
                          onNext={() => setTrafegoPage(p => Math.min(trafegoTotalPages, p + 1))}
                        />
                      )}
                    </details>
                  )}

                  <div className="border-t border-white/10 pt-2 flex justify-between text-xs font-semibold">
                    <span className="text-gray-300">Subtotal Tráfego <span className="text-gray-600 font-normal">(+13,85%)</span></span>
                    <span className="text-red-400">{formatCurrency(trafego.total)}</span>
                  </div>
                </div>

                <div className="bg-gray-900 rounded-xl border border-white/10 p-4">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-sm font-semibold text-white">Custos do Funil</h3>
                    <button onClick={addCustoFunil}
                      className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
                      + Adicionar custo
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mb-3">
                    Custos específicos deste fechamento (ex: funil perpétuo) — não entram nos Custos Fixos/Variáveis gerais, só neste fechamento.
                  </p>
                  {custosFunil.length === 0 ? (
                    <p className="text-xs text-gray-600">Nenhum custo do funil lançado</p>
                  ) : (
                    <div className="space-y-2">
                      {custosFunil.map(c => (
                        <div key={c.id} className="flex items-center gap-2">
                          <input type="text" value={c.descricao} placeholder="Descrição (ex: Editor de vídeo)"
                            onChange={e => updateCustoFunil(c.id, 'descricao', e.target.value)}
                            className="flex-1 bg-gray-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-indigo-500" />
                          <input type="text" value={c.valor} placeholder="0,00"
                            onChange={e => updateCustoFunil(c.id, 'valor', e.target.value)}
                            className="w-28 bg-gray-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-gray-200 text-right focus:outline-none focus:border-indigo-500" />
                          <button onClick={() => removeCustoFunil(c.id)}
                            className="text-gray-500 hover:text-red-400 transition-colors">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      <div className="border-t border-white/10 pt-2 flex justify-between text-xs font-semibold">
                        <span className="text-gray-300">Subtotal Custos do Funil</span>
                        <span className="text-red-400">{formatCurrency(custosFunilTotal)}</span>
                      </div>
                    </div>
                  )}
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
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-sm font-semibold text-white">Produtos incluídos</h3>
                    <div className="flex items-center gap-3">
                      <button onClick={selecionarTodosProdutos} className="text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors">
                        Selecionar todos
                      </button>
                      <button onClick={desmarcarTodosProdutos} className="text-xs text-gray-500 hover:text-gray-300 font-medium transition-colors">
                        Nenhum
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mb-3">
                    Marcado (✓) = entra no fechamento. Produtos com <Clock className="w-3 h-3 inline -mt-0.5" /> usam um período próprio (definido abaixo em &quot;Períodos adicionais&quot;), não o período principal.
                  </p>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {availableProducts.map(p => {
                      const grupo = produtoParaGrupo[p.id]
                      const marcado = selectedProducts.includes(p.id)
                      return (
                        <button key={p.id} onClick={() => toggleProduct(p.id)}
                          title={grupo ? `Período próprio: ${formatDate(grupo.inicio)} a ${formatDate(grupo.fim)}` : undefined}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                            marcado
                              ? 'bg-indigo-600/30 border-indigo-500/50 text-indigo-300'
                              : 'bg-gray-800 border-white/10 text-gray-600'
                          }`}>
                          <span className={marcado ? 'text-indigo-400' : 'text-gray-700'}>{marcado ? '✓' : '○'}</span>
                          {grupo && <Clock className="w-3 h-3 text-amber-400 shrink-0" />}
                          {p.nome}
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-xs text-gray-400 bg-gray-800/60 rounded-lg px-3 py-2">
                    {selectedProducts.length} de {availableProducts.length} produtos selecionados · <span className="text-white font-semibold">{periodSales.length} vendas encontradas</span> no período
                  </p>
                </div>

                <div className="bg-gray-900 rounded-xl border border-white/10 p-4">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-sm font-semibold text-white">Períodos adicionais por produto (opcional)</h3>
                    <button onClick={addPeriodoGrupo}
                      className="text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors whitespace-nowrap">
                      + Adicionar período
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mb-3">Útil pra funil perpétuo: crie quantos períodos quiser e atribua a cada um os produtos que devem usar aquele período em vez do período principal (ex: "Ingresso" fecha numa janela, "Produto Principal" fecha em outra, pra não puxar vendas de uma edição futura que já começou). <span className="text-gray-400">Clicar no produto já atribui na hora — não precisa de outro botão.</span></p>

                  {periodosGrupos.length === 0 ? (
                    <p className="text-xs text-gray-600">Nenhum período adicional — todos os produtos usam o Período do Fechamento acima</p>
                  ) : (
                    <div className="space-y-4">
                      {periodosGrupos.map((g, idx) => (
                        <div key={g.id} className="bg-gray-800/40 border border-white/5 rounded-xl p-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-gray-300">Período {idx + 1}</span>
                            <button onClick={() => removePeriodoGrupo(g.id)} className="text-gray-500 hover:text-red-400">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-3 mb-3">
                            <div>
                              <label className="block text-xs text-gray-400 mb-1">Data início</label>
                              <input type="date" value={g.inicio}
                                onChange={e => updatePeriodoGrupo(g.id, { inicio: e.target.value })}
                                className="bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-300 focus:outline-none focus:border-indigo-500" />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-400 mb-1">Data fim</label>
                              <input type="date" value={g.fim}
                                onChange={e => updatePeriodoGrupo(g.id, { fim: e.target.value })}
                                className="bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-300 focus:outline-none focus:border-indigo-500" />
                            </div>
                          </div>
                          <label className="block text-xs text-gray-400 mb-1.5">Produtos deste período</label>
                          <div className="flex flex-wrap gap-2">
                            {availableProducts.map(p => {
                              const atribuidoAqui = g.produtos.includes(p.id)
                              const atribuidoEmOutro = !atribuidoAqui && produtoParaGrupo[p.id] && produtoParaGrupo[p.id].id !== g.id
                              return (
                                <button key={p.id} onClick={() => toggleProdutoNoGrupo(g.id, p.id)}
                                  disabled={!!atribuidoEmOutro}
                                  title={atribuidoEmOutro ? 'Já atribuído a outro período' : undefined}
                                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                                    atribuidoAqui
                                      ? 'bg-indigo-600/30 border-indigo-500/50 text-indigo-300'
                                      : atribuidoEmOutro
                                      ? 'bg-gray-800 border-white/5 text-gray-700 cursor-not-allowed'
                                      : 'bg-gray-800 border-white/10 text-gray-500'
                                  }`}>
                                  {p.nome}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-gray-900 rounded-xl border border-white/10 overflow-hidden">
                  <div className="p-4 border-b border-white/10">
                    <h3 className="text-sm font-semibold text-white">Detalhamento de Faturamento</h3>
                  </div>
                  {byProduct.length === 0 ? (
                    <p className="px-4 py-8 text-center text-gray-600 text-xs">
                      {selectedProducts.length === 0
                        ? 'Nenhum produto selecionado — marque ao menos um produto acima em "Produtos incluídos".'
                        : !periodo.inicio || !periodo.fim
                        ? 'Defina o Período do Fechamento acima para ver o detalhamento.'
                        : 'Nenhuma venda encontrada para os produtos e período selecionados.'}
                    </p>
                  ) : (
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
                            <th className="text-right px-4 py-2.5 text-gray-500 font-medium">Líquido Pós-Impostos</th>
                            <th className="text-right px-4 py-2.5 text-gray-500 font-medium">Repasse Terapeuta</th>
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
                              <td className="px-4 py-3 text-right font-semibold" style={{ color: '#22c55e' }}>{formatCurrency(row.liquido_pos_impostos)}</td>
                              <td className="px-4 py-3 text-right text-orange-400">
                                {row.terapeuta_nome ? `-${formatCurrency(row.repasse_terapeuta)} (${row.terapeuta_nome})` : '—'}
                              </td>
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
                            <td className="px-4 py-3 text-right text-emerald-400 font-semibold">{formatCurrency(byProduct.reduce((a, r) => a + r.liquido, 0))}</td>
                            <td className="px-4 py-3 text-right font-semibold" style={{ color: '#22c55e' }}>{formatCurrency(byProduct.reduce((a, r) => a + r.liquido_pos_impostos, 0))}</td>
                            <td className="px-4 py-3 text-right text-orange-400 font-semibold">-{formatCurrency(repasseTerapeutasTotal)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>

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
                <div className="grid md:grid-cols-4 gap-4">
                  <div className="bg-gray-900 rounded-xl border border-white/10 p-4 text-center">
                    <p className="text-xs text-gray-500 mb-2">Lucro Bruto</p>
                    <p className={`text-2xl font-bold ${lucroBruto >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {formatCurrency(lucroBruto)}
                    </p>
                    <p className="text-xs text-gray-600 mt-1">Faturamento líquido - Custos</p>
                  </div>
                  {repasseTerapeutasTotal > 0 && (
                    <div className="bg-gray-900 rounded-xl border border-orange-500/30 p-4 text-center">
                      <p className="text-xs text-gray-500 mb-2">Repasse a Terapeutas</p>
                      <p className="text-2xl font-bold text-orange-400">{formatCurrency(repasseTerapeutasTotal)}</p>
                      <p className="text-xs text-gray-600 mt-1">% de comissão sobre as sessões vendidas</p>
                    </div>
                  )}
                  <div className="bg-gray-900 rounded-xl border border-purple-500/30 p-4 text-center">
                    <p className="text-xs text-gray-500 mb-2">Reserva de Caixa (30%)</p>
                    <p className="text-2xl font-bold text-purple-400">{formatCurrency(reservaCaixa)}</p>
                    <p className="text-xs text-gray-600 mt-1">Lançada automaticamente ao confirmar</p>
                    {faturamentoLiquidoMentoria > 0 && (
                      <p className="text-[10px] text-gray-600 mt-1">
                        Não incide sobre {formatCurrency(faturamentoLiquidoMentoria)} de produtos de mentoria
                      </p>
                    )}
                  </div>
                  <div className={`bg-gray-900 rounded-xl border p-4 text-center ${lucroReal >= 0 ? 'border-emerald-500/30' : 'border-red-500/30'}`}>
                    <p className="text-xs text-gray-500 mb-2">{lucroReal >= 0 ? 'Lucro Real' : 'Prejuízo a ratear'}</p>
                    <p className={`text-2xl font-bold ${lucroReal >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatCurrency(lucroReal)}</p>
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
                          <p className={`text-xs ${socioValues[i] >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatCurrency(socioValues[i])}</p>
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
                  <button onClick={() => setActiveStep(4)} disabled={!isDistributionValid}
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
                          {repasseTerapeutasTotal > 0 && (
                            <div className="flex justify-between">
                              <span className="text-gray-500">Repasse a terapeutas</span>
                              <span className="text-orange-400">-{formatCurrency(repasseTerapeutasTotal)}</span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span className="text-gray-500">Reserva de caixa (30%)</span>
                            <span className="text-amber-400">-{formatCurrency(reservaCaixa)}</span>
                          </div>
                          <div className="flex justify-between border-t border-white/5 pt-2">
                            <span className="text-white font-semibold">{lucroReal >= 0 ? 'Lucro real disponível para repasse' : 'Prejuízo a ratear entre sócios'}</span>
                            <span className={`font-bold text-base ${lucroReal >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatCurrency(lucroReal)}</span>
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
                                <td className={`px-4 py-3 text-right font-semibold ${socioValues[i] >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatCurrency(socioValues[i])}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t border-white/10 bg-gray-800/20">
                              <td className="px-4 py-3 text-gray-200 font-semibold">Total</td>
                              <td className="px-4 py-3 text-center text-gray-400 font-semibold">100%</td>
                              <td className={`px-4 py-3 text-right font-bold ${lucroReal >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatCurrency(lucroReal)}</td>
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

const COMPRADORES_PAGE_SIZE = 12

function ClosingCard({ closing }: { closing: Closing }) {
  const [expanded, setExpanded] = useState(false)
  const [compradoresPage, setCompradoresPage] = useState(1)
  const [produtosFiltro, setProdutosFiltro] = useState<string[]>(() => (closing.byProduct ?? []).map(p => p.nome))

  const byProductFiltrado = (closing.byProduct ?? []).filter(row => produtosFiltro.includes(row.nome))
  const filtroTotais = {
    qtd: byProductFiltrado.reduce((a, r) => a + r.qtd, 0),
    bruto: byProductFiltrado.reduce((a, r) => a + r.bruto, 0),
    taxas: byProductFiltrado.reduce((a, r) => a + r.taxas, 0),
    imposto: byProductFiltrado.reduce((a, r) => a + r.imposto, 0),
    liquido: byProductFiltrado.reduce((a, r) => a + r.liquido, 0),
    repasse: byProductFiltrado.reduce((a, r) => a + (r.repasse_terapeuta ?? 0), 0),
  }

  function toggleProdutoFiltro(nome: string) {
    setProdutosFiltro(prev => prev.includes(nome) ? prev.filter(p => p !== nome) : [...prev, nome])
  }

  const compradoresTotalPages = Math.max(1, Math.ceil(closing.compradores.length / COMPRADORES_PAGE_SIZE))
  const compradoresPaginados = closing.compradores.slice(
    (compradoresPage - 1) * COMPRADORES_PAGE_SIZE,
    compradoresPage * COMPRADORES_PAGE_SIZE
  )

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
                <p className={`font-medium ${closing.lucroReal >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatCurrency(closing.lucroReal)}</p>
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
                ...(closing.custos_trafego_total
                  ? [{ label: 'Custo de tráfego', value: closing.custos_trafego_total, color: 'text-red-400', neg: true }]
                  : []),
                ...(closing.custos_funil_total
                  ? [{ label: 'Custos do funil', value: closing.custos_funil_total, color: 'text-red-400', neg: true }]
                  : []),
                { label: 'Lucro bruto', value: closing.lucroBruto, color: closing.lucroBruto >= 0 ? 'text-emerald-400' : 'text-red-400', neg: false },
                ...(closing.repasseTerapeutasTotal
                  ? [{ label: 'Repasse a terapeutas', value: closing.repasseTerapeutasTotal, color: 'text-orange-400', neg: true }]
                  : []),
                { label: 'Reserva de caixa (30%)', value: closing.reservaCaixa, color: 'text-amber-400', neg: true },
                { label: 'Lucro real', value: closing.lucroReal, color: closing.lucroReal >= 0 ? 'text-emerald-400' : 'text-red-400', neg: false },
              ].map(row => (
                <div key={row.label} className="flex justify-between">
                  <span className="text-gray-500">{row.label}</span>
                  <span className={`font-medium ${row.color}`}>
                    {row.neg ? `-${formatCurrency(row.value)}` : formatCurrency(row.value)}
                  </span>
                </div>
              ))}
            </div>
            {!!closing.custos_trafego_total && closing.custos_trafego_periodo && (
              <p className="text-[11px] text-gray-600 mt-2">
                Tráfego: {formatDate(closing.custos_trafego_periodo.inicio)} a {formatDate(closing.custos_trafego_periodo.fim)}
                {closing.custos_trafego_termos && closing.custos_trafego_termos.length > 0 && (
                  <> · {closing.custos_trafego_termos.join(', ')}</>
                )}
              </p>
            )}
            {!!closing.custos_funil_total && closing.custos_funil_itens && closing.custos_funil_itens.length > 0 && (
              <p className="text-[11px] text-gray-600 mt-2">
                Custos do funil: {closing.custos_funil_itens.map(i => `${i.descricao} (${formatCurrency(i.valor)})`).join(', ')}
              </p>
            )}
            {closing.produtos_periodos && closing.produtos_periodos.length > 0 && (
              <div className="mt-2 space-y-0.5">
                {closing.produtos_periodos.map((g, i) => (
                  <p key={i} className="text-[11px] text-gray-600">
                    Período próprio ({formatDate(g.inicio)} a {formatDate(g.fim)}): {g.produtos.join(', ')}
                  </p>
                ))}
              </div>
            )}
          </div>

          {/* Seção 2 — Detalhamento por produto */}
          {closing.byProduct && closing.byProduct.length > 0 && (
            <div className="border-b border-white/5">
              <div className="px-4 pt-4 pb-2 flex items-center justify-between flex-wrap gap-2">
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Detalhamento por produto</h4>
                <div className="flex items-center gap-2 text-[10px]">
                  <button
                    onClick={() => setProdutosFiltro(closing.byProduct!.map(p => p.nome))}
                    className="text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    Selecionar todos
                  </button>
                  <span className="text-gray-700">·</span>
                  <button
                    onClick={() => setProdutosFiltro([])}
                    className="text-gray-500 hover:text-gray-400 transition-colors"
                  >
                    Desmarcar todos
                  </button>
                </div>
              </div>
              <div className="px-4 pb-3 flex flex-wrap gap-1.5">
                {closing.byProduct.map(p => {
                  const ativo = produtosFiltro.includes(p.nome)
                  return (
                    <button
                      key={p.nome}
                      onClick={() => toggleProdutoFiltro(p.nome)}
                      className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
                        ativo
                          ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                          : 'bg-gray-800/50 text-gray-500 border-white/10'
                      }`}
                    >
                      {ativo ? '✓' : '○'} {p.nome}
                    </button>
                  )
                })}
              </div>
              <p className="px-4 pb-2 text-[10px] text-gray-600">
                {produtosFiltro.length} de {closing.byProduct.length} produtos selecionados · {filtroTotais.qtd} vendas no filtro
              </p>
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
                      <th className="text-right px-4 py-2 text-gray-500">Repasse Terapeuta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byProductFiltrado.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-6 text-center text-gray-600 text-xs">
                          Nenhum produto selecionado no filtro acima.
                        </td>
                      </tr>
                    ) : byProductFiltrado.map((row, i) => (
                      <tr key={i} className="border-b border-white/5">
                        <td className="px-4 py-2.5 text-gray-200">{row.nome}</td>
                        <td className="px-4 py-2.5 text-center text-gray-400">{row.qtd}</td>
                        <td className="px-4 py-2.5 text-right text-gray-300">{formatCurrency(row.bruto)}</td>
                        <td className="px-4 py-2.5 text-right text-red-400">-{formatCurrency(row.taxas)}</td>
                        <td className="px-4 py-2.5 text-center text-amber-400">{row.aliquota}%</td>
                        <td className="px-4 py-2.5 text-right text-red-400">-{formatCurrency(row.imposto)}</td>
                        <td className="px-4 py-2.5 text-right text-emerald-400 font-medium">{formatCurrency(row.liquido)}</td>
                        <td className="px-4 py-2.5 text-right text-orange-400">
                          {row.terapeuta_nome ? `-${formatCurrency(row.repasse_terapeuta ?? 0)} (${row.terapeuta_nome})` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {byProductFiltrado.length > 0 && (
                    <tfoot>
                      <tr className="border-t border-white/10 bg-gray-800/30">
                        <td className="px-4 py-2.5 text-gray-200 font-semibold">Total</td>
                        <td className="px-4 py-2.5 text-center text-gray-200 font-semibold">{filtroTotais.qtd}</td>
                        <td className="px-4 py-2.5 text-right text-gray-200 font-semibold">{formatCurrency(filtroTotais.bruto)}</td>
                        <td className="px-4 py-2.5 text-right text-red-400 font-semibold">-{formatCurrency(filtroTotais.taxas)}</td>
                        <td className="px-4 py-2.5 text-center"></td>
                        <td className="px-4 py-2.5 text-right text-red-400 font-semibold">-{formatCurrency(filtroTotais.imposto)}</td>
                        <td className="px-4 py-2.5 text-right text-emerald-400 font-semibold">{formatCurrency(filtroTotais.liquido)}</td>
                        <td className="px-4 py-2.5 text-right text-orange-400 font-semibold">-{formatCurrency(filtroTotais.repasse)}</td>
                      </tr>
                    </tfoot>
                  )}
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
                  {compradoresTotalPages > 1 && ` · página ${compradoresPage} de ${compradoresTotalPages}`}
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
                  {compradoresPaginados.map((b, i) => (
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
            {compradoresTotalPages > 1 && (
              <Pagination
                currentPage={compradoresPage}
                totalPages={compradoresTotalPages}
                onPrevious={() => setCompradoresPage(p => Math.max(1, p - 1))}
                onNext={() => setCompradoresPage(p => Math.min(compradoresTotalPages, p + 1))}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
