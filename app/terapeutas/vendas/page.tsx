'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Calendar, CheckCircle, RefreshCw, X, AlertTriangle, Copy, Check } from 'lucide-react'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import SenhaModal from '@/components/SenhaModal'
import { getSession } from '@/lib/auth'
import { formatoDaVenda, avisosDasDatas } from '@/lib/diagnostico-guiado'
import { rotuloDiagnostico } from '@/lib/etiqueta-diagnostico'
import { resumirReagendamentoTotal } from '@/lib/reagendamento-total'

type TerapeutaSession = { nome: string; email: string; tipo: string }

// Página inteiramente dinâmica (dados carregados client-side em tempo real —
// agendamentos, remarcações, comissões). Sem isso o Next.js prerenderiza como
// estática e a Vercel serve o HTML/bundle do CDN com cache antigo por muito
// tempo, mesmo depois de um deploy novo — foi a causa do "remarco e não muda
// nada": o navegador estava carregando um bundle de antes da correção.
export const dynamic = 'force-dynamic'

// ─── Types ────────────────────────────────────────────────────────────────────
type Preset = 'all' | 'today' | 'last_7d' | 'custom'
type AbaAtiva = 'aprovadas' | 'reembolsos'
type SubAba = 'pendentes' | 'ativos'
const ABA_ATIVA_VALUES: readonly AbaAtiva[] = ['aprovadas', 'reembolsos']
const SUB_ABA_VALUES: readonly SubAba[] = ['pendentes', 'ativos']
type OcorrenciaTipo = null | 'select' | 'nota' | 'remarcacao' | 'reembolso'

type Sale = {
  id: string
  nome: string
  email: string
  telefone: string | null
  produto: string
  plataforma: string | null
  valor_pago_cliente: number
  valor_liquido: number
  preco_base: number
  data_hora: string
  status: string | null
  // Precisa vir da API em toda venda: sem order_id, formatoDaVenda() nunca
  // reconhece um pacote do Diagnóstico Guiado e a tela trata os três formatos
  // como um produto qualquer de 1 sessão, sem erro nenhum.
  order_id?: string
}

type Sessao = {
  id: string
  sale_id: string
  terapeuta_id: string
  numero_sessao: number
  total_sessoes: number
  status: string
  status_consulta: string | null
  data_agendada: string | null
  data_entrega: string | null
  link_meet: string | null
  comissao_valor: number
  comissao_paga: boolean
  paciente_nome: string
  paciente_email: string
  agendado_por: string | null
  vendedor_nome: string | null
  vendedor_email: string | null
  entregue_confirmado_por: string | null
  iniciado_em: string | null
  concluido_em: string | null
  terapeutas: { nome: string } | null
}

type Ocorrencia = {
  id: string
  sale_id: string
  tipo: string
  titulo: string
  descricao: string
  dados_extras: Record<string, unknown> | null
  criado_por_nome: string
  criado_por_tipo: string
  criado_por_email: string
  created_at: string
}

type Remarcacao = {
  id: string
  sessao_id: string
  sale_id: string
  paciente_nome: string
  remarcado_por_nome: string
  remarcado_por_tipo: string
  solicitado_por: string
  motivo: string
  data_anterior: string
  data_nova: string
  created_at: string
}

type Terapeuta = { id: string; nome: string }

type PageData = {
  counts: { aprovadas: number; pendentes: number; ativos: number; reembolsos: number }
  vendas_pendentes: Sale[]
  vendas_ativos: Sale[]
  vendas_reembolsos: Sale[]
  sessoes_por_venda: Record<string, Sessao[]>
  ocorrencias_por_venda: Record<string, Ocorrencia[]>
  remarcacoes_por_sessao: Record<string, Remarcacao[]>
  terapeutas: Terapeuta[]
  formatos: string[]
}

function LinkMeetCell({ id, link, copiadoId, onCopy }: { id: string; link: string | null; copiadoId: string | null; onCopy: (id: string, link: string) => void }) {
  if (!link) return <span className="text-gray-600">—</span>
  return (
    <div className="flex items-center gap-2">
      <a href={link} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">Abrir</a>
      <button onClick={() => onCopy(id, link)} className="text-gray-500 hover:text-white transition-colors" title="Copiar link">
        {copiadoId === id ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtBRL(n: number) {
  return 'R$ ' + new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}
function fmtDt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  })
}
function nowForDatetimeLocal(): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}
function dateToDatetimeLocal(date: Date): string {
  const d = new Date(date)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}
// Formata "2026-09-08T14:00" como "08/09/2026 14:00" sem passar por Date: a
// prévia precisa mostrar exatamente o mesmo horário que será enviado, e
// reconverter pra Date aqui reintroduziria a ambiguidade de fuso que o resto
// da tela já evita tratando o datetime-local como horário de Brasília.
function fmtDatetimeLocalBR(valor: string): string {
  const [data, hora] = valor.split('T')
  if (!data || !hora) return valor
  const [ano, mes, dia] = data.split('-')
  return `${dia}/${mes}/${ano} ${hora.slice(0, 5)}`
}

// data_agendada vem do banco em UTC (ex.: "2026-07-13T18:00:00+00:00"). Pra
// pré-preencher um <input type="datetime-local"> mostrando o horário real de
// Brasília, não dá pra só cortar a string UTC — precisa converter (UTC-3,
// sem horário de verão). Sem isso o formulário de remarcar mostra a hora
// errada e o usuário reenvia sem perceber (foi exatamente o bug do Fabio Nery).
function isoToDatetimeLocalBRT(iso: string): string {
  const brt = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000)
  return brt.toISOString().slice(0, 16)
}

function inferirNumeroSessoes(produto: string): number {
  const p = produto.toLowerCase()
  if (p.includes('8 sess') || p.includes('8sess')) return 8
  if (p.includes('4 sess') || p.includes('4sess')) return 4
  if (p.includes('2 sess') || p.includes('2sess')) return 2
  return 1
}

// preco_base é o preço "limpo" do plano (sem juros de parcelamento), então
// bate exato contra a tabela de planos. Vendas parceladas em 2x (ex.: Fabio
// Nery: 700 + 700 = 1.400) não batem sozinhas — aí soma-se o preco_base de
// todas as vendas do mesmo paciente+produto e divide igual entre elas.
const TABELA_SESSOES_POR_VALOR: { pedro: Record<number, number>; denise: Record<number, number> } = {
  pedro: { 1300: 1, 1550: 2, 2860: 4, 5280: 8 },
  denise: { 550: 1, 790: 2, 1400: 4, 2640: 8 },
}
function inferirNumeroSessoesPorValor(sale: Sale, todasVendas: Sale[]): number {
  // O Diagnóstico Guiado não está na tabela de preços e o nome do produto não
  // diz quantas sessões são, então sem esta linha ele caía no fallback de 1
  // sessão. A quantidade é derivada do FORMATO (2, 4 ou 9), nunca do valor: o
  // valor_pago_cliente varia com parcelamento e o preco_base quebra com cupom.
  const diagnostico = formatoDaVenda(sale)
  if (diagnostico) return diagnostico.totalSessoes
  const tabela = sale.produto.toLowerCase().includes('denise') ? TABELA_SESSOES_POR_VALOR.denise : TABELA_SESSOES_POR_VALOR.pedro
  if (tabela[sale.preco_base]) return tabela[sale.preco_base]
  const irmas = todasVendas.filter(v => v.email === sale.email && v.produto === sale.produto)
  const soma = irmas.reduce((a, v) => a + (v.preco_base ?? 0), 0)
  if (irmas.length > 0 && tabela[soma]) return Math.round(tabela[soma] / irmas.length)
  return inferirNumeroSessoes(sale.produto)
}

// Etiqueta do Diagnóstico Guiado pra uma linha que representa a VENDA inteira
// (listas do comercial e cabeçalho do prontuário). Total sempre do FORMATO;
// posição = próxima sessão a entregar, ou a última quando o pacote acabou.
function rotuloDiagnosticoDaVenda(sale: Sale, sessoes: { status: string }[]): string | null {
  const formato = formatoDaVenda(sale)
  if (!formato) return null
  const entregues = sessoes.filter(s => s.status === 'entregue').length
  return rotuloDiagnostico({
    formato: formato.formato,
    numeroSessao: Math.min(entregues + 1, formato.totalSessoes),
    totalSessoes: formato.totalSessoes,
  })
}

// Venda do produto Diagnóstico Guiado cuja OFERTA não está mapeada (oferta
// nova, promoção, ou a oferta "Padrão" de R$ 10,00, não mapeada de propósito).
// Sem o formato não dá pra montar o pacote, então a lista precisa avisar em vez
// de deixar o comercial tentar agendar e receber um pacote errado.
function ofertaDiagnosticoNaoMapeada(sale: Sale): boolean {
  return sale.produto.toLowerCase().includes('diagnóstico guiado') && !formatoDaVenda(sale)
}

function nomeFromEmail(email: string): string {
  const prefix = email.split('@')[0]
  return prefix.replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

const PRESET_LABELS: Record<Preset, string> = {
  all: 'Todo período', today: 'Hoje', last_7d: '7 dias', custom: 'Personalizado',
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pendente:  { label: 'Pendente',    cls: 'text-gray-400 bg-gray-400/10' },
  agendada:  { label: 'Agendada',    cls: 'text-blue-400 bg-blue-400/10' },
  entregue:  { label: 'Entregue ✓', cls: 'text-green-500 bg-green-500/10' },
  cancelada: { label: 'Cancelada',   cls: 'text-red-400 bg-red-400/10' },
  remarcada: { label: 'Remarcada',   cls: 'text-yellow-400 bg-yellow-400/10' },
}

const OCORRENCIA_META: Record<string, { icon: string; label: string; cls: string }> = {
  nota:                  { icon: '📝', label: 'Nota',                    cls: 'text-gray-400 bg-gray-400/10 border-gray-400/20' },
  remarcacao:            { icon: '📅', label: 'Remarcação',              cls: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20' },
  confirmacao_entrega:   { icon: '✅', label: 'Sessão Entregue',         cls: 'text-green-500 bg-green-500/10 border-green-500/20' },
  solicitacao_reembolso: { icon: '💰', label: 'Solicitação de Reembolso', cls: 'text-orange-400 bg-orange-400/10 border-orange-400/20' },
  reembolso_aprovado:    { icon: '✅', label: 'Reembolso Aprovado',      cls: 'text-green-500 bg-green-500/10 border-green-500/20' },
  reembolso_rejeitado:   { icon: '❌', label: 'Reembolso Rejeitado',     cls: 'text-red-400 bg-red-400/10 border-red-400/20' },
  orientacao_sessao:     { icon: '📣', label: 'Orientação da Sessão',    cls: 'text-blue-400 bg-blue-400/10 border-blue-400/20' },
  nao_compareceu:        { icon: '🚫', label: 'Não Compareceu',         cls: 'text-orange-400 bg-orange-400/10 border-orange-400/20' },
}

const SC_BADGE: Record<string, { label: string; cls: string }> = {
  aguardando:     { label: 'Aguardando',    cls: 'text-amber-400 bg-amber-400/10' },
  em_atendimento: { label: 'Em atendimento', cls: 'text-blue-400 bg-blue-400/10' },
  concluida:      { label: 'Concluída',     cls: 'text-green-500 bg-green-500/10' },
  cancelada:      { label: 'Cancelada',     cls: 'text-red-400 bg-red-400/10' },
  remarcada:      { label: 'Remarcada',     cls: 'text-purple-400 bg-purple-400/10' },
  nao_compareceu: { label: 'Não compareceu', cls: 'text-orange-400 bg-orange-400/10' },
}

function calcularReembolsoLocal(params: {
  terapeuta_nome: string
  sessoes_total: number
  sessoes_feitas: number
  valor_pago: number
}): { valor_reembolso: number; explicacao: string } {
  const tabelaPedro: Record<number, number> = { 1: 1300, 2: 1550, 4: 2860, 8: 5280 }
  const tabelaDenise: Record<number, number> = { 1: 550, 2: 790, 4: 1400, 8: 2640 }
  const isPedro = params.terapeuta_nome.toLowerCase().includes('pedro')
  const tabela = isPedro ? tabelaPedro : tabelaDenise
  const planos = Object.keys(tabela).map(Number).sort((a, b) => a - b)
  if (params.sessoes_feitas === 0) {
    return { valor_reembolso: params.valor_pago, explicacao: `Nenhuma sessão realizada — reembolso integral de ${fmtBRL(params.valor_pago)}` }
  }
  if (params.sessoes_feitas >= params.sessoes_total) {
    return { valor_reembolso: 0, explicacao: 'Todas as sessões foram realizadas — sem reembolso' }
  }
  let plano_eq = 0, valor_eq = 0
  for (const p of planos) { if (p <= params.sessoes_feitas) { plano_eq = p; valor_eq = tabela[p] } }
  const valor_reembolso = Math.max(0, params.valor_pago - valor_eq)
  return {
    valor_reembolso,
    explicacao: `Comprou ${params.sessoes_total} sessão(ões) (${fmtBRL(params.valor_pago)}), realizou ${params.sessoes_feitas} sessão(ões) → equivale ao plano de ${plano_eq} sessão(ões) = ${fmtBRL(valor_eq)} → Reembolso: ${fmtBRL(valor_reembolso)}`,
  }
}

const EMPTY_DATA: PageData = {
  counts: { aprovadas: 0, pendentes: 0, ativos: 0, reembolsos: 0 },
  vendas_pendentes: [], vendas_ativos: [], vendas_reembolsos: [],
  sessoes_por_venda: {}, ocorrencias_por_venda: {}, remarcacoes_por_sessao: {},
  terapeutas: [], formatos: [],
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function TerapeutasVendas() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const autoAgendarRef = useRef(false)

  // Filtros — aba/sub-aba ficam na URL (?tab=/?subtab=) pra sobreviver a um
  // refresh da página em vez de sempre voltar pro padrão.
  const [abaAtiva, setAbaAtivaState] = useState<AbaAtiva>(() => {
    const t = searchParams.get('tab')
    return ABA_ATIVA_VALUES.includes(t as AbaAtiva) ? (t as AbaAtiva) : 'aprovadas'
  })
  const [subAba, setSubAbaState] = useState<SubAba>(() => {
    const st = searchParams.get('subtab')
    return SUB_ABA_VALUES.includes(st as SubAba) ? (st as SubAba) : 'pendentes'
  })
  function setAbaAtiva(tab: AbaAtiva) {
    setAbaAtivaState(tab)
    const next = new URLSearchParams(searchParams.toString())
    next.set('tab', tab)
    router.replace(`/terapeutas/vendas?${next.toString()}`, { scroll: false })
  }
  function setSubAba(sub: SubAba) {
    setSubAbaState(sub)
    const next = new URLSearchParams(searchParams.toString())
    next.set('subtab', sub)
    router.replace(`/terapeutas/vendas?${next.toString()}`, { scroll: false })
  }
  const [preset, setPreset] = useState<Preset>('all')
  const [dateStart, setDateStart] = useState('')
  const [dateEnd, setDateEnd] = useState('')
  const [busca, setBusca] = useState('')
  const [filtroTerapeuta, setFiltroTerapeuta] = useState('all')
  const [filtroFormato, setFiltroFormato] = useState('all')

  // Dados
  const [pageData, setPageData] = useState<PageData>(EMPTY_DATA)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')

  // Auth
  const [adminEmail, setAdminEmail] = useState('rafael@spr.com')
  const [sessionNome, setSessionNome] = useState('')

  // Toast
  const [toast, setToast] = useState('')
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function showToast(msg: string) {
    setToast(msg)
    if (toastRef.current) clearTimeout(toastRef.current)
    toastRef.current = setTimeout(() => setToast(''), 3500)
  }

  const [linkCopiadoId, setLinkCopiadoId] = useState<string | null>(null)
  async function copiarLinkMeet(id: string, link: string) {
    await navigator.clipboard.writeText(link)
    setLinkCopiadoId(id)
    setTimeout(() => setLinkCopiadoId(prev => prev === id ? null : prev), 1500)
  }

  // Modal agendar
  const [agendarVendaId, setAgendarVendaId] = useState<string | null>(null)
  const [agendarTerapeutaId, setAgendarTerapeutaId] = useState('')
  const [agendarDataPrimeira, setAgendarDataPrimeira] = useState('')
  const [agendarNumSessoesInput, setAgendarNumSessoesInput] = useState('')
  const [agendarDatasEditadas, setAgendarDatasEditadas] = useState<string[]>([])
  const [agendarSenhaOpen, setAgendarSenhaOpen] = useState(false)
  const [agendarLoading, setAgendarLoading] = useState(false)
  const [agendarErro, setAgendarErro] = useState('')
  // Modal de confirmação — o toast discreto passava despercebido; aqui o
  // usuário precisa ver claramente que o agendamento foi concluído.
  const [agendarSucesso, setAgendarSucesso] = useState<{ sessoes: number; nome: string; aviso: string | null } | null>(null)
  // Trava do reagendamento total: quando a venda já tem sessões, confirmar não
  // é "criar", é "apagar e refazer". Só libera o botão depois de a pessoa
  // marcar que entendeu o que vai ser destruído.
  const [agendarSubstituicaoCiente, setAgendarSubstituicaoCiente] = useState(false)
  // Conflito que veio só de compromisso da agenda (almoço, gravação, ou uma
  // reserva feita a mão para este mesmo paciente). Guarda a senha já digitada
  // para o "agendar assim mesmo" ser um clique só.
  const [agendarConflitoCompromisso, setAgendarConflitoCompromisso] = useState<{ mensagem: string; senha: string } | null>(null)
  // Sessões relidas do banco ao abrir o modal. O aviso de destruição saía de
  // pageData.sessoes_por_venda, buscado no load da página: sessão criada por
  // outra pessoa depois disso não aparecia e o modal chegava a mostrar botão
  // verde de "Confirmar agendamento" pra venda que já tinha pacote. A rota
  // ainda barra o caso destrutivo, então não havia perda de dado - o que
  // ficava frouxo era a promessa de declarar ANTES de destruir.
  // Guarda o sale_id junto com o resultado: assim "o que está na tela é desta
  // venda?" é derivado, sem precisar zerar o estado dentro do efeito antes de
  // disparar o fetch (o que faria a resposta de uma venda anterior aparecer
  // como se fosse da venda aberta agora).
  const [agendarSessoesLidas, setAgendarSessoesLidas] =
    useState<{ saleId: string; sessoes: Sessao[] | null; erro: string } | null>(null)

  // Prontuário
  const [prontuarioVendaId, setProntuarioVendaId] = useState<string | null>(null)

  // Status consulta (iniciar / concluir / anular)
  const [scSessaoId, setScSessaoId] = useState<string | null>(null)
  const [scAcao, setScAcao] = useState<'iniciar' | 'concluir' | 'anular'>('iniciar')
  const [scSenhaOpen, setScSenhaOpen] = useState(false)
  const [scLoading, setScLoading] = useState(false)
  const [scErro, setScErro] = useState('')
  const [anularMotivo, setAnularMotivo] = useState('')
  const [scConcluirData, setScConcluirData] = useState('')

  // ── Ocorrências inline no prontuário ──
  const [ocorrenciaTipo, setOcorrenciaTipo] = useState<OcorrenciaTipo>(null)
  // Nota
  const [notaTitulo, setNotaTitulo] = useState('')
  const [notaDesc, setNotaDesc] = useState('')
  const [notaErro, setNotaErro] = useState('')
  const [notaLoading, setNotaLoading] = useState(false)
  const [notaSenhaOpen, setNotaSenhaOpen] = useState(false)
  // Remarcar
  const [remSessaoId, setRemSessaoId] = useState('')
  const [remNovaData, setRemNovaData] = useState('')
  const [remSolicitadoPor, setRemSolicitadoPor] = useState('')
  const [remMotivo, setRemMotivo] = useState('')
  const [remErro, setRemErro] = useState('')
  const [remLoading, setRemLoading] = useState(false)
  const [remSenhaOpen, setRemSenhaOpen] = useState(false)
  // Aviso de intervalo quebrado (Diagnóstico Guiado) - mesmo fluxo do painel
  // do terapeuta (app/terapeutas/[id]/page.tsx): quando /remarcar acusa menos
  // de 7 dias entre sessões do mesmo pacote, o comercial escolhe manter como
  // está ou empurrar as seguintes. Essa tela é a que o comercial usa no
  // menu principal, então precisa do mesmo fechamento de ciclo.
  const [avisoRemarcacao, setAvisoRemarcacao] = useState<{
    sessaoId: string
    paciente: string
    mensagem: string
    /** Datas atuais das sessões que o empurrar vai reescrever. */
    seguintes: { numero: number; dataAtual: string }[]
  } | null>(null)
  const [avisoEmpurrarSenhaOpen, setAvisoEmpurrarSenhaOpen] = useState(false)
  const [avisoEmpurrarErro, setAvisoEmpurrarErro] = useState('')
  const [avisoEmpurrarLoading, setAvisoEmpurrarLoading] = useState(false)
  const [avisoEmpurrarSucesso, setAvisoEmpurrarSucesso] = useState<number | null>(null)
  // Aviso separado do "deu certo": as datas podem ter sido salvas e ainda
  // assim o convite do Google não ter sido refeito em alguma sessão. Antes a
  // tela dizia só "N sessões remarcadas" e o paciente ficava com o convite no
  // horário velho sem ninguém saber.
  const [avisoEmpurrarCalendario, setAvisoEmpurrarCalendario] = useState<string | null>(null)
  // Reembolso
  const [reeSessoes, setReeSessoes] = useState<string[]>([])
  const [reeMotivo, setReeMotivo] = useState('')
  const [reeErro, setReeErro] = useState('')
  const [reeLoading, setReeLoading] = useState(false)
  const [reeSenhaOpen, setReeSenhaOpen] = useState(false)

  // ── Load data ──
  const loadData = useCallback(async () => {
    if (preset === 'custom' && (!dateStart || !dateEnd)) return
    setLoading(true)
    setErro('')
    try {
      const params = new URLSearchParams({ datePreset: preset })
      if (preset === 'custom') {
        params.set('dateStart', dateStart + 'T03:00:00.000Z')
        // Fim do dia em Brasília (23:59:59 BRT) convertido pra UTC = 02:59:59 do dia seguinte
        const fimBrt = new Date(dateEnd + 'T00:00:00Z')
        fimBrt.setUTCDate(fimBrt.getUTCDate() + 1)
        fimBrt.setUTCHours(2, 59, 59, 999)
        params.set('dateEnd', fimBrt.toISOString())
      }
      const res = await fetch('/api/terapeutas/vendas?' + params.toString())
      if (!res.ok) throw new Error(await res.text())
      const json = await res.json() as PageData
      setPageData(json)
      if (json.terapeutas.length > 0 && !agendarTerapeutaId) {
        setAgendarTerapeutaId(json.terapeutas[0].id)
      }
    } catch (e) {
      setErro(String(e))
    } finally {
      setLoading(false)
    }
  }, [preset, dateStart, dateEnd])

  useEffect(() => { loadData() }, [loadData])

  // "Seu e-mail" ficava sempre travado em rafael@spr.com por padrão — pra
  // qualquer outro usuário logado (comercial, outro admin) as ações com
  // senha (agendar, remarcar etc.) nunca batiam, porque tentavam validar a
  // senha dele contra a conta errada. Carrega o e-mail/nome reais da sessão.
  //
  // A senha de ações aqui dentro (agendar, remarcar, nota, reembolso) é
  // sempre validada contra usuarios_sistema — a tabela do módulo de
  // terapeutas, separada do login principal (usuarios_dashboard). Por isso
  // terapeutas_session tem que ter prioridade: se o navegador também tiver
  // um spr_session (login do dashboard principal) guardado — mesmo que
  // antigo/de outra pessoa, esquecido no mesmo computador — usá-lo aqui
  // sempre falha com "Senha inválida", porque esse e-mail não existe em
  // usuarios_sistema. Foi exatamente o bug do Felipe (comercial): a página
  // pegava o spr_session travado no navegador em vez do login dele.
  useEffect(() => {
    const raw = localStorage.getItem('terapeutas_session')
    if (raw) {
      try {
        const session = JSON.parse(raw) as TerapeutaSession
        setAdminEmail(session.email)
        setSessionNome(session.nome)
        return
      } catch { /* ignore, cai pro fallback abaixo */ }
    }
    const adminSession = getSession()
    if (adminSession) {
      setAdminEmail(adminSession.email)
      setSessionNome(adminSession.name)
    }
  }, [])

  // Veio de um link "Agendar" na tela de um terapeuta (ex.: /terapeutas/[id] →
  // aba Pendentes de Agendamento) — abre o modal direto na venda já filtrada.
  useEffect(() => {
    if (autoAgendarRef.current || loading) return
    const saleId = searchParams.get('agendar')
    if (!saleId) return
    // Procura também em Ativos: a venda pode já ter sessões (reagendamento
    // total). Antes olhava só vendas_pendentes e, quando não achava, o efeito
    // saía calado - a pessoa clicava em "Agendar" na tela do terapeuta, caía
    // aqui e não acontecia absolutamente nada, sem erro nenhum na tela.
    const venda = [...pageData.vendas_pendentes, ...pageData.vendas_ativos].find(v => v.id === saleId)
    autoAgendarRef.current = true
    if (!venda) {
      setErro('A venda que você tentou agendar não está nesta lista. Atualize a página; se continuar assim, avise o time técnico (a venda pode estar fora do filtro de produto ou do corte de data).')
      return
    }
    setAbaAtiva('aprovadas')
    setSubAba('pendentes')
    setAgendarVendaId(saleId)
    setAgendarDataPrimeira(''); setAgendarErro(''); setAgendarSubstituicaoCiente(false)
    setAgendarNumSessoesInput(String(inferirNumeroSessoesPorValor(venda, [...pageData.vendas_pendentes, ...pageData.vendas_ativos])))
    const terapeutaParam = searchParams.get('terapeuta')
    if (terapeutaParam && pageData.terapeutas.some(t => t.id === terapeutaParam)) {
      setAgendarTerapeutaId(terapeutaParam)
    }
  }, [searchParams, pageData, loading])

  // Reset ocorrência state quando prontuário abre/fecha
  useEffect(() => {
    setOcorrenciaTipo(null)
    setNotaTitulo(''); setNotaDesc(''); setNotaErro('')
    setRemSessaoId(''); setRemNovaData(''); setRemSolicitadoPor(''); setRemMotivo(''); setRemErro('')
    setReeSessoes([]); setReeMotivo(''); setReeErro('')
  }, [prontuarioVendaId])

  // ── Derived ──
  const searchLower = busca.toLowerCase()
  function filterList(list: Sale[]) {
    return list
      .filter(v => !busca || v.nome.toLowerCase().includes(searchLower) || v.email.toLowerCase().includes(searchLower))
      .filter(v => filtroFormato === 'all' || v.produto === filtroFormato)
  }
  function filterAtivos(list: Sale[]) {
    return filterList(list).filter(v =>
      filtroTerapeuta === 'all' ||
      (pageData.sessoes_por_venda[v.id] ?? []).some(s => s.terapeuta_id === filtroTerapeuta)
    )
  }

  const vendasPendentesDisplay = filterList(pageData.vendas_pendentes)
  const vendasAtivosDisplay = filterAtivos(pageData.vendas_ativos)
  const vendasReembolsosDisplay = filterList(pageData.vendas_reembolsos)

  const agendarVenda = agendarVendaId
    ? [...pageData.vendas_pendentes, ...pageData.vendas_ativos].find(v => v.id === agendarVendaId)
    : null
  // Diagnóstico Guiado: a QUANTIDADE de sessões (2, 4 ou 9) e QUEM atende cada
  // uma vêm do FORMATO e não são escolhidas na tela - mexer nelas criaria
  // pacote que a comissão da Denise, a etiqueta de progresso e o empurrar as
  // seguintes não sabem interpretar. As DATAS, ao contrário: nascem na régua de
  // 7 dias e o comercial ajusta uma a uma se precisar (decisão do usuário em
  // 02/09/2026, depois de ver a tela em uso - viagem, feriado e
  // indisponibilidade do paciente são rotina, e travar isso obrigaria a agendar
  // tudo e remarcar em seguida).
  const agendarDiagnostico = agendarVenda ? formatoDaVenda(agendarVenda) : null
  // Sessões que essa venda JÁ tem, de qualquer terapeuta (sessoes_por_venda
  // não é filtrado por terapeuta nesta API). O link "Agendar" da tela do
  // terapeuta chega aqui apontando pra venda que já foi agendada por OUTRO
  // terapeuta - o produto conjunto "Pedro | Denise" aparece em Pendentes da
  // Denise mesmo com as sessões do Pedro criadas - e confirmar ali apaga as
  // sessões dele, cancela os convites do paciente e refaz o pacote com a
  // comissão da outra pessoa. Antes disso não aparecia em lugar nenhum.
  // O Pedro sempre começa o pacote; a Denise pega o restante. Quem monta a
  // divisão é a rota, mas ela ainda exige um terapeuta_id no corpo.
  const pedroTerapeuta = pageData.terapeutas.find(t => t.nome.trim().toLowerCase().startsWith('pedro')) ?? null
  const agendarTerapeutaEfetivo = agendarDiagnostico ? (pedroTerapeuta?.id ?? '') : agendarTerapeutaId
  //
  // Vale para TODOS os produtos, não só o Diagnóstico: o bloco de datas dos
  // demais tem os mesmos campos livres, e as travas novas da rota valem para
  // todos. Sem o aviso aqui, apagar um campo numa Mentoria de 8 sessões só
  // devolvia o erro DEPOIS de digitar a senha. São 19 vendas de "Mentoria
  // Particular - Pedro | Denise" contra 7 do Diagnóstico: este é o caminho
  // mais usado, não o outro.
  const agendarAvisosDatas = agendarDatasEditadas.length > 1
    ? avisosDasDatas(agendarDatasEditadas)
    : { foraDaRegua: [], foraDeOrdem: [], invalidas: [], duplicadas: [] }

  // Calculado antes do resumo: quantas sessões o pacote novo vai ter decide se
  // a numeração 1..N colide com sessão que sobrevive ao delete (cancelada, por
  // exemplo). Mudar a quantidade na tela muda a resposta, igual na rota.
  // Avisos sobre as datas escolhidas a mão. São avisos, nunca travas: fora da
  // régua é escolha legítima do comercial desde 02/09/2026.
  //
  // As strings vão CRUAS para a função, sem passar por `new Date(...)` aqui.
  // Converter antes era o bug: campo limpo pelo comercial vira '', e
  // `new Date('').toISOString()` lança RangeError. Isto roda a cada render do
  // modal, então a exceção derrubava a página inteira e apagava os ajustes que
  // ele já tinha feito nas outras sessões.
  const agendarNumSessoes = agendarDiagnostico
    ? agendarDiagnostico.totalSessoes
    : parseInt(agendarNumSessoesInput, 10) || (agendarVenda ? inferirNumeroSessoesPorValor(agendarVenda, [...pageData.vendas_pendentes, ...pageData.vendas_ativos]) : 1)
  // Enquanto a releitura não volta, usa o que veio do load: é melhor avisar com
  // dado velho do que não avisar nada. O botão fica travado nesse intervalo.
  const agendarLeituraDaVenda = agendarSessoesLidas?.saleId === agendarVendaId ? agendarSessoesLidas : null
  const agendarSessoesCarregando = !!agendarVendaId && agendarLeituraDaVenda === null
  const agendarSessoesErro = agendarLeituraDaVenda?.erro ?? ''
  const agendarSessoesExistentes = agendarVendaId
    ? (agendarLeituraDaVenda?.sessoes ?? pageData.sessoes_por_venda[agendarVendaId] ?? [])
    : []
  const agendarResumo = resumirReagendamentoTotal(agendarSessoesExistentes, agendarNumSessoes)
  const agendarEhSubstituicao = agendarResumo.substituiveis > 0 || agendarResumo.bloqueado

  // Relê as sessões da venda toda vez que o modal abre. `cancelado` evita que a
  // resposta de uma venda anterior sobrescreva a da venda aberta agora, se
  // alguém fechar e abrir outra antes da primeira responder.
  useEffect(() => {
    if (!agendarVendaId) return
    const saleId = agendarVendaId
    let cancelado = false
    fetch(`/api/terapeutas/sessoes?sale_id=${encodeURIComponent(saleId)}`)
      .then(async res => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'erro')
        if (!cancelado) setAgendarSessoesLidas({ saleId, sessoes: (json.sessoes ?? []) as Sessao[], erro: '' })
      })
      .catch(e => {
        // Sem a releitura o modal continua mostrando o que veio do load - só
        // não pode fingir que aquilo está atualizado.
        if (!cancelado) setAgendarSessoesLidas({ saleId, sessoes: null, erro: String(e instanceof Error ? e.message : e) })
      })
    // Descarta a leitura ao fechar (ou ao trocar de venda): reabrir a MESMA
    // venda tem que esperar uma leitura nova, senão o botão liberaria na hora
    // com o resultado da abertura anterior.
    return () => { cancelado = true; setAgendarSessoesLidas(null) }
  }, [agendarVendaId])

  useEffect(() => {
    if (!agendarDataPrimeira || !agendarVenda) { setAgendarDatasEditadas([]); return }
    setAgendarDatasEditadas(Array.from({ length: agendarNumSessoes }, (_, i) => {
      const d = new Date(agendarDataPrimeira)
      d.setDate(d.getDate() + i * 7)
      return dateToDatetimeLocal(d)
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agendarDataPrimeira, agendarNumSessoes, agendarVendaId])

  const prontuarioSale = prontuarioVendaId
    ? [...pageData.vendas_pendentes, ...pageData.vendas_ativos, ...pageData.vendas_reembolsos].find(v => v.id === prontuarioVendaId)
    : null
  const prontuarioSessoes = prontuarioVendaId ? (pageData.sessoes_por_venda[prontuarioVendaId] ?? []) : []
  const prontuarioOcorrencias = prontuarioVendaId ? (pageData.ocorrencias_por_venda[prontuarioVendaId] ?? []) : []

  // Etiqueta por sessão no histórico do prontuário: o formato é da VENDA, então
  // é calculado uma vez só, fora do laço das sessões.
  const formatoProntuario = prontuarioSale ? formatoDaVenda(prontuarioSale) : null
  const sessoesPendentesProntuario = prontuarioSessoes.filter(s => s.status === 'agendada' || s.status === 'pendente')
  const entreguesProntuario = prontuarioSessoes.filter(s => s.status === 'entregue').length
  const totalProntuario = prontuarioSessoes[0]?.total_sessoes ?? prontuarioSessoes.length

  // Reembolso calculado por tabela de preços
  const terapeutaIdProntuario = prontuarioSessoes[0]?.terapeuta_id ?? ''
  const terapeutaNomeProntuario = pageData.terapeutas.find(t => t.id === terapeutaIdProntuario)?.nome ?? ''
  const reembolsoCalc = prontuarioSale && terapeutaNomeProntuario
    ? calcularReembolsoLocal({
        terapeuta_nome: terapeutaNomeProntuario,
        sessoes_total: totalProntuario,
        sessoes_feitas: entreguesProntuario,
        valor_pago: prontuarioSale.valor_pago_cliente,
      })
    : null
  const valorReembolso = reembolsoCalc?.valor_reembolso ?? 0

  function getVendedor(saleId: string): string {
    const sessoes = pageData.sessoes_por_venda[saleId] ?? []
    const s = sessoes.find(x => x.vendedor_nome) ?? sessoes.find(x => x.agendado_por)
    return s?.vendedor_nome ?? s?.agendado_por ?? '—'
  }

  // Validações
  const remValido = remSessaoId && remNovaData && new Date(remNovaData) > new Date() && remSolicitadoPor && remMotivo.length >= 10
  const reeValido = reeSessoes.length > 0 && reeMotivo.length >= 20
  const notaValida = notaTitulo.trim().length > 0 && notaDesc.trim().length >= 10

  // ── Handlers ──
  async function handleAgendar(senha: string, ignorarCompromissos = false) {
    if (!agendarVendaId || !agendarTerapeutaEfetivo || !agendarDataPrimeira) return
    setAgendarLoading(true); setAgendarErro('')
    if (!ignorarCompromissos) setAgendarConflitoCompromisso(null)
    const res = await fetch('/api/terapeutas/sessoes/agendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sale_id: agendarVendaId, terapeuta_id: agendarTerapeutaEfetivo,
        data_primeira_sessao: agendarDataPrimeira,
        // A QUANTIDADE continua fora no Diagnóstico: vem do formato, e deixar
        // o comercial mexer nela criaria pacote que a comissão da Denise, a
        // etiqueta de progresso e o empurrar as seguintes não sabem interpretar.
        numero_sessoes: agendarDiagnostico ? undefined : agendarNumSessoes,
        // O comercial pode ajustar sessao por sessao tambem no Diagnostico
        // (decisao do usuario em 02/09/2026). A quantidade continua vindo do
        // formato, entao a lista so vale se cobrir o pacote inteiro - do
        // contrario a rota recusa, que e o comportamento certo: melhor recusar
        // do que gravar metade do pacote com data errada.
        datas_sessoes: agendarDatasEditadas.length === agendarNumSessoes ? agendarDatasEditadas : undefined,
        // Confirmação explícita de que o horário bloqueado pela própria equipe
        // pode ser usado. A rota só aceita quando TODOS os conflitos são
        // compromissos: consulta de outro paciente continua recusada.
        ignorar_compromissos: ignorarCompromissos || undefined,
        usuario_email: adminEmail, senha,
      }),
    })
    const json = await res.json()
    setAgendarLoading(false)
    if (!res.ok) {
      setAgendarErro(json.error ?? 'Erro')
      // Conflito que vem SÓ de compromisso da agenda: a equipe bloqueia o
      // horário antes de agendar, para segurar a vaga, e o agendamento era
      // recusado pela própria reserva. Guarda a senha para o "agendar assim
      // mesmo" não obrigar a digitar de novo.
      if (json.soCompromissos) setAgendarConflitoCompromisso({ mensagem: json.error ?? '', senha })
      return
    }
    setAgendarSenhaOpen(false)
    setAgendarConflitoCompromisso(null)
    setAgendarSucesso({ sessoes: json.sessoes_criadas, nome: agendarVenda?.nome ?? '', aviso: json.aviso ?? null })
    setAgendarVendaId(null)
    setAgendarDataPrimeira('')
    setAgendarSubstituicaoCiente(false)
    loadData()
  }

  async function handleStatusConsulta(senha: string) {
    if (!scSessaoId) return
    setScLoading(true); setScErro('')
    const res = await fetch('/api/terapeutas/sessoes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessao_id: scSessaoId,
        acao: scAcao,
        motivo: scAcao === 'anular' ? anularMotivo : undefined,
        data_entrega: scAcao === 'concluir' ? scConcluirData : undefined,
        usuario_nome: sessionNome || nomeFromEmail(adminEmail),
        usuario_tipo: 'admin',
        usuario_email: adminEmail,
        senha,
      }),
    })
    const json = await res.json()
    setScLoading(false)
    if (!res.ok) { setScErro(json.error ?? 'Erro'); return }
    setScSessaoId(null); setScSenhaOpen(false); setAnularMotivo(''); setScConcluirData('')
    const msgs: Record<string, string> = { iniciar: '▶ Consulta iniciada!', concluir: '✓ Consulta concluída!', anular: '✓ Sessão anulada.' }
    showToast(msgs[scAcao] ?? '✓ Feito!')
    loadData()
  }

  async function postOcorrencia(senha: string, payload: {
    tipo: string; titulo: string; descricao: string
    dados_extras?: Record<string, unknown>
  }, onSuccess: () => void, setLoading: (v: boolean) => void, setErro: (v: string) => void) {
    if (!prontuarioVendaId) return
    setLoading(true); setErro('')
    const res = await fetch('/api/terapeutas/vendas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sale_id: prontuarioVendaId,
        ...payload,
        senha,
        usuario_nome: sessionNome || nomeFromEmail(adminEmail),
        usuario_tipo: 'admin',
        usuario_email: adminEmail,
      }),
    })
    const json = await res.json()
    setLoading(false)
    if (!res.ok) { setErro(json.error ?? 'Erro'); return }
    onSuccess()
    loadData()
  }

  async function handleNota(senha: string) {
    await postOcorrencia(
      senha,
      { tipo: 'nota', titulo: notaTitulo, descricao: notaDesc },
      () => {
        setNotaSenhaOpen(false); setOcorrenciaTipo(null)
        setNotaTitulo(''); setNotaDesc('')
        showToast('✓ Nota registrada com sucesso!')
      },
      setNotaLoading, setNotaErro
    )
  }

  async function handleRemarcar(senha: string) {
    if (!remSessaoId || !remNovaData) return
    setRemLoading(true); setRemErro('')
    // Chama o endpoint que de fato atualiza data_agendada — antes esse form
    // só criava uma ocorrência de histórico via postOcorrencia() e nunca
    // remarcava a sessão de verdade (por isso "remarco e não muda nada").
    const res = await fetch('/api/terapeutas/sessoes/remarcar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessao_id: remSessaoId,
        nova_data: remNovaData,
        motivo: remMotivo,
        solicitado_por: remSolicitadoPor,
        usuario_email: adminEmail,
        senha,
      }),
    })
    const json = await res.json()
    setRemLoading(false)
    if (!res.ok) { setRemErro(json.error ?? 'Erro'); return }
    // Guarda o aviso de intervalo (se vier) antes de zerar remSessaoId - é a
    // chance de oferecer as duas saídas ao comercial. prontuarioSale ainda é
    // o paciente certo, porque é o prontuário aberto no momento da remarcação.
    if (json.avisoIntervalo) {
      // Datas atuais das sessões que o empurrar vai reescrever, para o modal
      // poder mostrar o que se perde. Vêm do pacote já carregado nesta tela.
      const sessaoRemarcada = prontuarioSessoes.find(x => x.id === remSessaoId)
      const seguintes = sessaoRemarcada
        ? prontuarioSessoes
            .filter(x => x.numero_sessao > sessaoRemarcada.numero_sessao
              && x.status !== 'entregue' && x.status !== 'cancelada' && !!x.data_agendada)
            .sort((a, b) => a.numero_sessao - b.numero_sessao)
            .map(x => ({ numero: x.numero_sessao, dataAtual: fmtDt(x.data_agendada as string) }))
        : []
      setAvisoRemarcacao({ sessaoId: remSessaoId, paciente: prontuarioSale?.nome ?? '', mensagem: json.avisoIntervalo, seguintes })
    }
    setRemSenhaOpen(false); setOcorrenciaTipo(null)
    setRemSessaoId(''); setRemNovaData(''); setRemSolicitadoPor(''); setRemMotivo('')
    showToast('✓ Sessão remarcada com sucesso!')
    loadData()
  }

  // Segunda decisão do fluxo de remarcação do Diagnóstico Guiado: o comercial
  // escolheu empurrar as sessões seguintes do pacote pra manter os 7 dias
  // entre elas (rota da Task 9). Esta tela não tem sessionToken/dispensa de
  // senha (é o login do dashboard principal, não o do módulo de terapeutas -
  // handleRemarcar acima também nunca manda token), então pede senha sempre.
  async function handleEmpurrarSeguintes(senha: string) {
    if (!avisoRemarcacao) return
    setAvisoEmpurrarLoading(true)
    setAvisoEmpurrarErro('')
    const res = await fetch('/api/terapeutas/sessoes/empurrar-seguintes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessao_id: avisoRemarcacao.sessaoId, usuario_email: adminEmail, senha }),
    })
    const json = await res.json()
    setAvisoEmpurrarLoading(false)
    // Conflito (409) chega com mensagem pronta dizendo qual data bateu em
    // qual paciente. Nada foi alterado nesse caso - o comercial pode fechar
    // e escolher manter como está.
    if (!res.ok) { setAvisoEmpurrarErro(json.error ?? 'Não foi possível empurrar as seguintes.'); return }
    setAvisoEmpurrarSenhaOpen(false)
    setAvisoRemarcacao(null)
    setAvisoEmpurrarSucesso(json.movidas)
    setAvisoEmpurrarCalendario(json.aviso ?? null)
    loadData()
  }

  async function handleReembolso(senha: string) {
    if (!prontuarioSale) return
    const sessoesSel = prontuarioSessoes.filter(s => reeSessoes.includes(s.id))
    const valorFinal = reembolsoCalc?.valor_reembolso ?? 0
    await postOcorrencia(
      senha,
      {
        tipo: 'solicitacao_reembolso',
        titulo: `Solicitação de reembolso parcial — ${entreguesProntuario} sessão(ões) realizadas`,
        descricao: `${reembolsoCalc?.explicacao ?? ''}. Sessões a cancelar: ${sessoesSel.map(s => s.numero_sessao).join(', ')}. Motivo: ${reeMotivo}`,
        dados_extras: {
          sessoes_ids: reeSessoes,
          sessoes_numeros: sessoesSel.map(s => s.numero_sessao),
          valor_reembolso: valorFinal,
          motivo: reeMotivo,
          paciente_nome: prontuarioSale.nome,
          paciente_email: prontuarioSale.email,
        },
      },
      () => {
        setReeSenhaOpen(false); setOcorrenciaTipo(null)
        setReeSessoes([]); setReeMotivo('')
        showToast('✓ Solicitação enviada para aprovação do CEO!')
      },
      setReeLoading, setReeErro
    )
  }

  // ── Render helpers ──
  function renderFiltros(showTerapeuta: boolean) {
    return (
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input type="text" placeholder="Buscar paciente..." value={busca} onChange={e => setBusca(e.target.value)}
          className="bg-gray-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500/50 w-44" />
        {showTerapeuta && (
          <select value={filtroTerapeuta} onChange={e => setFiltroTerapeuta(e.target.value)}
            className="bg-gray-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500/50">
            <option value="all">Todos os terapeutas</option>
            {pageData.terapeutas.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
        )}
        <select value={filtroFormato} onChange={e => setFiltroFormato(e.target.value)}
          className="bg-gray-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500/50">
          <option value="all">Todos os formatos</option>
          {pageData.formatos.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <div className="flex items-center gap-1">
          {(Object.keys(PRESET_LABELS) as Preset[]).map(p => (
            <button key={p} onClick={() => setPreset(p)}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                preset === p ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white border border-white/10'
              }`}>{PRESET_LABELS[p]}</button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={dateStart} onChange={e => setDateStart(e.target.value)}
              className="bg-gray-800 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none" />
            <span className="text-xs text-gray-500">até</span>
            <input type="date" value={dateEnd} onChange={e => setDateEnd(e.target.value)}
              className="bg-gray-800 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none" />
          </div>
        )}
      </div>
    )
  }

  function Spinner() {
    return (
      <div className="flex justify-center h-40 items-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  function EmptyRow({ cols, msg }: { cols: number; msg: string }) {
    return <tr><td colSpan={cols} className="px-4 py-10 text-center text-gray-600 text-xs">{msg}</td></tr>
  }

  // ── Main render ──
  return (
    <div className="min-h-screen bg-gray-950 pb-24 md:pb-8">
      <Header />
      <main className="max-w-7xl mx-auto px-4 py-6">

        {/* Título + email */}
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-white">Vendas · Terapeutas</h1>
            <p className="text-sm text-gray-400 mt-1">Gestão de mentorias — Pedro | Denise</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 whitespace-nowrap">Seu e-mail:</span>
            <input type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)}
              className="bg-gray-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500/50 w-48" />
            <button onClick={loadData} className="p-1.5 text-gray-500 hover:text-white transition-colors">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Abas principais */}
        <div className="flex items-center gap-2 mb-4">
          {[
            { id: 'aprovadas', label: `Aprovadas [${pageData.counts.aprovadas}]`, cls: 'bg-green-600' },
            { id: 'reembolsos', label: `Reembolsos [${pageData.counts.reembolsos}]`, cls: 'bg-gray-600' },
          ].map(({ id, label, cls }) => (
            <button key={id} onClick={() => setAbaAtiva(id as AbaAtiva)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                abaAtiva === id ? `${cls} text-white` : 'bg-gray-800 text-gray-400 hover:text-white border border-white/10'
              }`}>{label}</button>
          ))}
        </div>

        {erro && (
          <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400">{erro}</div>
        )}

        {/* ABA: APROVADAS */}
        {abaAtiva === 'aprovadas' && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <button onClick={() => setSubAba('pendentes')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  subAba === 'pendentes' ? 'bg-amber-600/80 text-white' : 'text-gray-400 hover:text-white border border-white/10'
                }`}>
                Agendamentos Pendentes [{pageData.counts.pendentes}]
              </button>
              <button onClick={() => setSubAba('ativos')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  subAba === 'ativos' ? 'bg-blue-600/80 text-white' : 'text-gray-400 hover:text-white border border-white/10'
                }`}>
                Pacientes Ativos [{pageData.counts.ativos}]
              </button>
            </div>

            {/* SUB-ABA: PENDENTES */}
            {subAba === 'pendentes' && (
              <>
                {renderFiltros(false)}
                {loading ? <Spinner /> : (
                  <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-white/10">
                            {['Data da compra', 'Paciente', 'Formato', 'Qtd. Sessões', 'Fat. Bruto', 'Líquido', 'Vendedor', 'Ações'].map(h => (
                              <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-medium whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {vendasPendentesDisplay.length === 0 ? (
                            <EmptyRow cols={8} msg="Nenhuma venda pendente de agendamento" />
                          ) : vendasPendentesDisplay.map(sale => (
                            <tr key={sale.id} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                              <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDt(sale.data_hora)}</td>
                              <td className="px-4 py-3">
                                <p className="text-white font-medium">{sale.nome}</p>
                                <p className="text-xs text-gray-500">{sale.email}</p>
                                {rotuloDiagnosticoDaVenda(sale, []) && (
                                  <span className="inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full font-semibold border bg-violet-500/20 text-violet-300 border-violet-500/40">
                                    {rotuloDiagnosticoDaVenda(sale, [])}
                                  </span>
                                )}
                                {ofertaDiagnosticoNaoMapeada(sale) && (
                                  <p className="mt-1 text-[10px] text-amber-400 max-w-[260px]">
                                    Oferta do Diagnóstico Guiado não mapeada: o pacote não pode ser montado até alguém
                                    associar essa oferta a um formato. Avise o time técnico.
                                  </p>
                                )}
                              </td>
                              <td className="px-4 py-3 text-gray-300 text-xs max-w-[180px] truncate">{sale.produto}</td>
                              <td className="px-4 py-3 text-center">
                                <span className="text-indigo-400 font-medium">
                                  {inferirNumeroSessoesPorValor(sale, [...pageData.vendas_pendentes, ...pageData.vendas_ativos])}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-white whitespace-nowrap">{fmtBRL(sale.valor_pago_cliente)}</td>
                              <td className="px-4 py-3 text-green-500 whitespace-nowrap">{fmtBRL(sale.valor_liquido)}</td>
                              <td className="px-4 py-3 text-gray-500 text-xs">—</td>
                              <td className="px-4 py-3">
                                {ofertaDiagnosticoNaoMapeada(sale) ? (
                                  <span title="Oferta não mapeada: o formato do pacote é desconhecido."
                                    className="text-xs text-gray-600 whitespace-nowrap cursor-not-allowed">Oferta não mapeada</span>
                                ) : (
                                <button onClick={() => {
                                  setAgendarVendaId(sale.id)
                                  setAgendarTerapeutaId(pageData.terapeutas[0]?.id ?? '')
                                  setAgendarDataPrimeira(''); setAgendarErro(''); setAgendarSubstituicaoCiente(false)
                                  setAgendarNumSessoesInput(String(inferirNumeroSessoesPorValor(sale, [...pageData.vendas_pendentes, ...pageData.vendas_ativos])))
                                }} className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors whitespace-nowrap">
                                  <Calendar className="w-3 h-3" /> Agendar
                                </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* SUB-ABA: ATIVOS */}
            {subAba === 'ativos' && (
              <>
                {renderFiltros(true)}
                {loading ? <Spinner /> : (
                  <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-white/10">
                            {['Data da compra', 'Paciente', 'Qtd. Sessões', 'Sessões Feitas', 'Fat. Bruto', 'Líquido', 'Vendedor', 'Progresso', 'Ações'].map(h => (
                              <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-medium whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {vendasAtivosDisplay.length === 0 ? (
                            <EmptyRow cols={9} msg="Nenhum paciente ativo encontrado" />
                          ) : vendasAtivosDisplay.map(sale => {
                            const sessoes = pageData.sessoes_por_venda[sale.id] ?? []
                            const total = sessoes[0]?.total_sessoes ?? sessoes.length
                            const entregues = sessoes.filter(s => s.status === 'entregue').length
                            const progresso = total > 0 ? Math.min((entregues / total) * 100, 100) : 0
                            const concluido = entregues === total && total > 0
                            return (
                              <tr key={sale.id} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                                <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDt(sale.data_hora)}</td>
                                <td className="px-4 py-3">
                                  <p className="text-white font-medium">{sale.nome}</p>
                                  <p className="text-xs text-gray-500">{sale.email}</p>
                                  {rotuloDiagnosticoDaVenda(sale, sessoes) && (
                                    <span className="inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full font-semibold border bg-violet-500/20 text-violet-300 border-violet-500/40">
                                      {rotuloDiagnosticoDaVenda(sale, sessoes)}
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-gray-300">{total}</td>
                                <td className="px-4 py-3 text-green-500 font-medium">{entregues}</td>
                                <td className="px-4 py-3 text-white whitespace-nowrap">{fmtBRL(sale.valor_pago_cliente)}</td>
                                <td className="px-4 py-3 text-green-500 whitespace-nowrap">{fmtBRL(sale.valor_liquido)}</td>
                                <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{getVendedor(sale.id)}</td>
                                <td className="px-4 py-3 min-w-[120px]">
                                  <div className="w-full bg-gray-800 rounded-full h-1.5">
                                    <div className="bg-green-500 h-1.5 rounded-full transition-all" style={{ width: `${progresso}%` }} />
                                  </div>
                                  <p className={`text-[10px] mt-0.5 ${concluido ? 'text-green-500' : 'text-gray-500'}`}>
                                    {concluido ? 'Concluído ✓' : `${entregues} de ${total} sessões`}
                                  </p>
                                </td>
                                <td className="px-4 py-3">
                                  <button onClick={() => setProntuarioVendaId(sale.id)}
                                    className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors whitespace-nowrap">
                                    Ver prontuário
                                  </button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ABA: REEMBOLSOS */}
        {abaAtiva === 'reembolsos' && (
          <>
            {renderFiltros(false)}
            {loading ? <Spinner /> : (
              <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10">
                        {['Data', 'Paciente', 'Formato', 'Valor', 'Status', 'Sessões canceladas'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {vendasReembolsosDisplay.length === 0 ? (
                        <EmptyRow cols={6} msg="Nenhum reembolso no período" />
                      ) : vendasReembolsosDisplay.map(sale => {
                        const sessoes = pageData.sessoes_por_venda[sale.id] ?? []
                        const canceladas = sessoes.filter(s => s.status === 'cancelada').length
                        return (
                          <tr key={sale.id} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                            <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDt(sale.data_hora)}</td>
                            <td className="px-4 py-3">
                              <p className="text-white font-medium">{sale.nome}</p>
                              <p className="text-xs text-gray-500">{sale.email}</p>
                            </td>
                            <td className="px-4 py-3 text-gray-300 text-xs max-w-[180px] truncate">{sale.produto}</td>
                            <td className="px-4 py-3 text-red-400 whitespace-nowrap">{fmtBRL(sale.valor_pago_cliente)}</td>
                            <td className="px-4 py-3">
                              <span className="text-xs text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full capitalize">{sale.status}</span>
                            </td>
                            <td className="px-4 py-3 text-gray-400">{canceladas > 0 ? canceladas : '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* ── MODAL: AGENDAR ── */}
      {agendarVendaId && !agendarSenhaOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">
                {agendarEhSubstituicao ? 'Refazer o pacote inteiro' : 'Agendar sessões'} - {agendarVenda?.nome}
              </h3>
              <button onClick={() => setAgendarVendaId(null)} className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              {/* Reagendamento total: a venda JÁ tem sessões. Nada aqui é
                  "acrescentar" - confirmar apaga o que existe e cria tudo de
                  novo. O modal dizia só "Agendar sessões", então quem clicava
                  no link "Agendar" da tela do terapeuta não tinha como saber
                  que estava destruindo o pacote de outra pessoa. Continua
                  sendo uma operação legítima (é como se corrige um pacote
                  inteiro marcado errado), só que agora declarada. */}
              {agendarEhSubstituicao && (
                <div className={`rounded-lg p-3 border ${agendarResumo.bloqueado ? 'bg-red-500/10 border-red-500/40' : 'bg-amber-500/10 border-amber-500/40'}`}>
                  <p className={`text-xs font-semibold flex items-center gap-1.5 ${agendarResumo.bloqueado ? 'text-red-300' : 'text-amber-300'}`}>
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    {agendarResumo.motivoBloqueio === 'entregue'
                      ? `Esta venda tem ${agendarResumo.entregues} sessão(ões) já entregue(s)`
                      : agendarResumo.motivoBloqueio === 'numeracao'
                        ? `Esta venda tem ${agendarResumo.colidem.length} sessão(ões) que o refazer não apaga (sessão ${agendarResumo.colidem.join(', ')})`
                        : `Esta venda já tem ${agendarResumo.substituiveis} sessão(ões) agendada(s)`}
                  </p>
                  {agendarResumo.motivoBloqueio === 'entregue' ? (
                    <p className="text-[11px] text-gray-300 mt-1.5">
                      Um pacote com sessão entregue não pode ser refeito do zero: as sessões novas
                      começariam da número 1 e colidiriam com as que já foram feitas. Para mudar as datas
                      das que faltam, feche esta janela e remarque uma a uma pelo prontuário do paciente.
                    </p>
                  ) : agendarResumo.motivoBloqueio === 'numeracao' ? (
                    /* Sessão cancelada (reembolso parcial aprovado) fica no banco
                       com o número dela. Refazer criaria de novo a sessão 1..N e
                       o banco recusaria - depois de as pendentes já terem sido
                       apagadas e os convites cancelados. */
                    <p className="text-[11px] text-gray-300 mt-1.5">
                      Essa(s) sessão(ões) continuam no banco com o número delas (cancelamento por reembolso,
                      por exemplo) e o refazer não as apaga. Como o pacote novo teria {agendarNumSessoes} sessão(ões)
                      numeradas de 1 a {agendarNumSessoes}, os números bateriam de frente. Para mudar as datas das
                      que faltam, feche esta janela e remarque uma a uma pelo prontuário do paciente.
                    </p>
                  ) : (
                    <p className="text-[11px] text-gray-300 mt-1.5">
                      Confirmar aqui <strong className="text-white">não acrescenta sessões</strong>: apaga as {agendarResumo.substituiveis} sessão(ões)
                      abaixo{agendarResumo.comConvite > 0 ? `, cancela os ${agendarResumo.comConvite} convite(s) que o paciente já recebeu no Google Agenda` : ''} e
                      cria o pacote inteiro de novo, do zero, com as datas e a comissão desta tela.
                      Quem já tinha essas sessões perde todas elas.
                    </p>
                  )}
                  <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                    {agendarSessoesExistentes
                      .slice()
                      .sort((a, b) => a.numero_sessao - b.numero_sessao)
                      .map(sx => (
                        <div key={sx.id} className="flex items-center gap-2 text-[11px]">
                          <span className="text-gray-500 w-16 shrink-0">Sessão {sx.numero_sessao}:</span>
                          <span className="text-gray-200">{fmtDt(sx.data_agendada)}</span>
                          <span className="text-gray-500">{sx.terapeutas?.nome ?? '?'}</span>
                          <span className={sx.status === 'entregue' ? 'text-green-400' : 'text-amber-400'}>{sx.status}</span>
                          {sx.link_meet && <span className="text-gray-600">convite enviado</span>}
                        </div>
                      ))}
                  </div>
                </div>
              )}
              {agendarDiagnostico ? (
                /* Pacote conjunto: quem faz cada sessão é regra do produto, não
                   escolha da tela. Mostrar um seletor de terapeuta aqui daria a
                   impressão de que dá pra mandar as 9 sessões pra uma pessoa só. */
                <div className="bg-violet-500/10 border border-violet-500/30 rounded-lg p-3">
                  <p className="text-xs font-semibold text-violet-300">
                    Diagnóstico Guiado · Formato {agendarDiagnostico.formato} · {agendarDiagnostico.totalSessoes} sessões
                  </p>
                  <p className="text-[11px] text-gray-400 mt-1">
                    Pacote conjunto: {pedroTerapeuta?.nome ?? 'Pedro'} faz {agendarDiagnostico.sessoesPedro === 1 ? 'a 1ª sessão' : `as ${agendarDiagnostico.sessoesPedro} primeiras sessões`} e a Denise as demais,
                    com 7 dias entre todas. A quantidade de sessões e quem atende cada uma vêm do formato. As datas nascem com 7 dias entre elas e você pode ajustar cada uma.
                  </p>
                  {!pedroTerapeuta && (
                    <p className="text-[11px] text-red-400 mt-1">
                      Pedro não aparece como terapeuta ativo - o pacote não pode ser montado até isso ser corrigido no cadastro.
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Terapeuta <span className="text-red-400">*</span></label>
                  <select value={agendarTerapeutaId} onChange={e => setAgendarTerapeutaId(e.target.value)}
                    className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50">
                    {pageData.terapeutas.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="text-xs text-gray-400 block mb-1">Data e horário da 1ª sessão <span className="text-red-400">*</span></label>
                <input type="datetime-local" value={agendarDataPrimeira} onChange={e => setAgendarDataPrimeira(e.target.value)}
                  className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
              </div>
              {!agendarDiagnostico && (
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Quantidade de sessões <span className="text-red-400">*</span></label>
                  <input type="number" min={1} value={agendarNumSessoesInput} onChange={e => setAgendarNumSessoesInput(e.target.value)}
                    className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
                  <p className="text-[10px] text-gray-600 mt-1">
                    Sugerido a partir do nome do produto - confira o pacote real (ex: planilha de acompanhamento) antes de confirmar.
                  </p>
                </div>
              )}
              {agendarDatasEditadas.length > 0 && (
                agendarDiagnostico ? (
                  /* As datas nascem na régua de 7 dias e podem ser ajustadas uma
                     a uma: viagem, feriado e indisponibilidade do paciente são
                     rotina, e travar isso obrigaria o comercial a agendar tudo e
                     remarcar em seguida. Quem atende cada sessão continua vindo
                     do formato e não é editável. Mudar a 1ª data recalcula as
                     demais pela régua, desfazendo ajustes manuais - por isso o
                     aviso aparece assim que alguma sai dos 7 dias. */
                  <div className="bg-gray-800/60 rounded-lg p-3">
                    <p className="text-xs text-gray-400 mb-2 font-medium">
                      As {agendarNumSessoes} sessões do pacote (7 dias entre todas por padrão, edite se precisar):
                    </p>
                    <div className="space-y-1.5">
                      {agendarDatasEditadas.map((valor, i) => (
                        <div key={i} className="flex items-center gap-3 text-xs">
                          <span className="text-gray-500 w-16 shrink-0">Sessão {i + 1}:</span>
                          {i === 0 ? (
                            <span className="flex-1 text-gray-300 py-1.5">{fmtDatetimeLocalBR(valor)} <span className="text-gray-600">(campo acima)</span></span>
                          ) : (
                            <input type="datetime-local" value={valor}
                              onChange={e => setAgendarDatasEditadas(prev => prev.map((v, idx) => idx === i ? e.target.value : v))}
                              className="flex-1 bg-gray-800 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500/50" />
                          )}
                          <span className="text-[10px] text-gray-500 w-24 shrink-0">
                            {i < agendarDiagnostico.sessoesPedro ? (pedroTerapeuta?.nome ?? 'Pedro') : 'Denise'}
                          </span>
                        </div>
                      ))}
                    </div>
                    {agendarAvisosDatas.invalidas.length > 0 && (
                      <p className="text-[11px] text-red-400 mt-2">
                        Preencha a data {agendarAvisosDatas.invalidas.length === 1 ? 'da sessão' : 'das sessões'} {agendarAvisosDatas.invalidas.join(', ')} para poder confirmar.
                      </p>
                    )}
                    {agendarAvisosDatas.duplicadas.length > 0 && (
                      <p className="text-[11px] text-red-400 mt-2">
                        {agendarAvisosDatas.duplicadas.length === 1 ? `A sessão ${agendarAvisosDatas.duplicadas[0]} está` : `As sessões ${agendarAvisosDatas.duplicadas.join(', ')} estão`} em cima de outra sessão deste pacote (menos de 1 hora de diferença). O paciente receberia dois convites sobrepostos.
                      </p>
                    )}
                    {agendarAvisosDatas.foraDeOrdem.length > 0 && (
                      <p className="text-[11px] text-amber-400 mt-2">
                        Fora de ordem: {agendarAvisosDatas.foraDeOrdem.length === 1
                          ? `a sessão ${agendarAvisosDatas.foraDeOrdem[0]} acontece antes da anterior`
                          : `as sessões ${agendarAvisosDatas.foraDeOrdem.join(', ')} acontecem antes da anterior`}. Confira se não trocou as datas de lugar.
                      </p>
                    )}
                    {agendarAvisosDatas.foraDaRegua.length > 0 && (
                      <p className="text-[11px] text-amber-400 mt-2">
                        Fora do intervalo de 7 dias: {agendarAvisosDatas.foraDaRegua.length === 1
                          ? `antes da sessão ${agendarAvisosDatas.foraDaRegua[0]}`
                          : `antes das sessões ${agendarAvisosDatas.foraDaRegua.join(', ')}`}. Pode confirmar assim mesmo - é só um aviso.
                      </p>
                    )}
                    <p className="text-[11px] text-gray-500 mt-2">
                      Mudar a data da 1ª sessão recalcula as demais em 7 em 7 dias.
                    </p>
                  </div>
                ) : (
                  <div className="bg-gray-800/60 rounded-lg p-3">
                    <p className="text-xs text-gray-400 mb-2 font-medium">Datas das {agendarNumSessoes} sessões (intervalo de 7 dias - edite se alguma sessão real sair da regra):</p>
                    <div className="space-y-1.5">
                      {agendarDatasEditadas.map((valor, i) => (
                        <div key={i} className="flex items-center gap-3 text-xs">
                          <span className="text-gray-500 w-16 shrink-0">Sessão {i + 1}:</span>
                          <input type="datetime-local" value={valor}
                            onChange={e => setAgendarDatasEditadas(prev => prev.map((v, idx) => idx === i ? e.target.value : v))}
                            className="flex-1 bg-gray-800 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500/50" />
                        </div>
                      ))}
                    </div>
                    {/* Os mesmos avisos do Diagnóstico. A rota recusa os dois
                        casos para qualquer produto; sem isto aqui, o comercial
                        só descobria depois de digitar a senha. */}
                    {agendarAvisosDatas.invalidas.length > 0 && (
                      <p className="text-[11px] text-red-400 mt-2">
                        Preencha a data {agendarAvisosDatas.invalidas.length === 1 ? 'da sessão' : 'das sessões'} {agendarAvisosDatas.invalidas.join(', ')} para poder confirmar.
                      </p>
                    )}
                    {agendarAvisosDatas.duplicadas.length > 0 && (
                      <p className="text-[11px] text-red-400 mt-2">
                        {agendarAvisosDatas.duplicadas.length === 1 ? `A sessão ${agendarAvisosDatas.duplicadas[0]} fica` : `As sessões ${agendarAvisosDatas.duplicadas.join(', ')} ficam`} em cima de outra sessão deste pacote (menos de 1 hora de diferença).
                      </p>
                    )}
                  </div>
                )
              )}
              {/* whitespace-pre-line: o conflito de agenda pode listar uma
                  data por linha quando várias sessões do pacote batem. */}
              {/* Só aparece no caminho destrutivo: no agendamento normal (venda
                  sem sessão nenhuma) nada é apagado e pedir confirmação extra
                  só atrapalharia o uso do dia a dia. */}
              {agendarEhSubstituicao && !agendarResumo.bloqueado && (
                <label className="flex items-start gap-2 text-[11px] text-gray-300 cursor-pointer bg-gray-800/60 rounded-lg p-2.5">
                  <input type="checkbox" checked={agendarSubstituicaoCiente}
                    onChange={e => setAgendarSubstituicaoCiente(e.target.checked)}
                    className="mt-0.5 accent-amber-500" />
                  <span>
                    Entendi que as {agendarResumo.substituiveis} sessão(ões) acima serão apagadas
                    {agendarResumo.comConvite > 0 ? ' e os convites do paciente cancelados' : ''}, e que o pacote será recriado do zero.
                  </span>
                </label>
              )}
              {agendarSessoesErro && (
                /* A releitura falhou: o que está na tela veio do carregamento
                   da página e pode estar velho. A rota ainda barra o caso
                   destrutivo, mas quem confirma tem que saber disso. */
                <p className="text-[11px] text-amber-400">
                  Não deu pra conferir agora as sessões desta venda ({agendarSessoesErro}). O que aparece
                  acima é do carregamento da página e pode estar desatualizado.
                </p>
              )}
              {agendarErro && <p className="text-xs text-red-400 whitespace-pre-line">{agendarErro}</p>}
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setAgendarVendaId(null)}
                className="flex-1 px-4 py-2 text-sm text-gray-400 bg-gray-800 border border-white/10 rounded-lg">Cancelar</button>
              {/* Travado enquanto a releitura das sessões não volta: confirmar
                  antes disso é decidir com o dado do carregamento da página,
                  que é exatamente o que essa releitura existe pra evitar. */}
              <button disabled={agendarResumo.bloqueado || agendarSessoesCarregando || agendarAvisosDatas.invalidas.length > 0 || agendarAvisosDatas.duplicadas.length > 0} onClick={() => {
                if (agendarDiagnostico && !pedroTerapeuta) {
                  setAgendarErro('Pedro precisa estar cadastrado como terapeuta ativo para montar o pacote do Diagnóstico Guiado.')
                  return
                }
                if (!agendarTerapeutaEfetivo || !agendarDataPrimeira) {
                  setAgendarErro(agendarDiagnostico ? 'Informe a data da 1ª sessão' : 'Selecione o terapeuta e a data')
                  return
                }
                // Data em branco e horario repetido sao os dois casos que a
                // edicao manual criou e que NAO podem chegar no banco: campo
                // vazio vira 01/01/2000 (o parser do V8 aceita a string
                // incompleta), e duas sessoes no mesmo horario passam pela
                // trava de conflito, porque ela olha so o banco e ignora as
                // sessoes desta propria venda. Fora de ordem e fora da regua
                // seguem liberados: sao escolha do comercial, so avisadas.
                if (agendarAvisosDatas.invalidas.length > 0) {
                  setAgendarErro(`Preencha a data ${agendarAvisosDatas.invalidas.length === 1 ? 'da sessão' : 'das sessões'} ${agendarAvisosDatas.invalidas.join(', ')}.`)
                  return
                }
                if (agendarAvisosDatas.duplicadas.length > 0) {
                  setAgendarErro(`As sessões ${agendarAvisosDatas.duplicadas.join(', ')} ficam em cima de outra sessão deste pacote, com menos de 1 hora de diferença. Ajuste antes de confirmar.`)
                  return
                }
                // A rota recusa esse caso com 400; a tela para antes pra
                // ninguém digitar data e senha à toa.
                if (agendarResumo.bloqueado) {
                  setAgendarErro(agendarResumo.motivoBloqueio === 'entregue'
                    ? 'Esta venda tem sessão entregue: refaça as datas uma a uma pelo prontuário.'
                    : `Esta venda tem sessão(ões) que o refazer não apaga ocupando a numeração 1 a ${agendarNumSessoes} (sessão ${agendarResumo.colidem.join(', ')}): refaça as datas uma a uma pelo prontuário.`)
                  return
                }
                if (agendarEhSubstituicao && !agendarSubstituicaoCiente) {
                  setAgendarErro('Marque a confirmação acima: este agendamento apaga as sessões que já existem.')
                  return
                }
                setAgendarErro(''); setAgendarSenhaOpen(true)
              }} className={`flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${
                agendarResumo.bloqueado || agendarSessoesCarregando
                  || agendarAvisosDatas.invalidas.length > 0 || agendarAvisosDatas.duplicadas.length > 0
                  ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  : agendarEhSubstituicao ? 'bg-amber-600 hover:bg-amber-500' : 'bg-green-600 hover:bg-green-500'}`}>
                {agendarSessoesCarregando
                  ? 'Conferindo as sessões desta venda...'
                  : agendarResumo.bloqueado
                    ? 'Não é possível refazer'
                    : agendarEhSubstituicao ? `Apagar e refazer as ${agendarResumo.substituiveis} sessões` : 'Confirmar agendamento'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: PRONTUÁRIO ── */}
      {prontuarioVendaId && prontuarioSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-white/10 rounded-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">

            {/* Header sticky */}
            <div className="sticky top-0 bg-gray-900 border-b border-white/10 px-6 py-4 flex items-start justify-between z-10">
              <div>
                <h3 className="text-sm font-semibold text-white">Prontuário — {prontuarioSale.nome}</h3>
                <p className="text-xs text-gray-400 mt-0.5">{prontuarioSale.email}</p>
                {rotuloDiagnosticoDaVenda(prontuarioSale, prontuarioSessoes) && (
                  <span className="inline-block mt-1.5 text-[10px] px-2 py-0.5 rounded-full font-semibold border bg-violet-500/20 text-violet-300 border-violet-500/40">
                    {rotuloDiagnosticoDaVenda(prontuarioSale, prontuarioSessoes)}
                  </span>
                )}
              </div>
              <button onClick={() => setProntuarioVendaId(null)} className="text-gray-500 hover:text-white mt-0.5">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-6">

              {/* SEÇÃO 1 — Informações do paciente */}
              <div>
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Informações do paciente</h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    { label: 'Nome', value: prontuarioSale.nome },
                    { label: 'E-mail', value: prontuarioSale.email },
                    { label: 'Telefone', value: prontuarioSale.telefone ?? '—' },
                    { label: 'Formato comprado', value: prontuarioSale.produto },
                    { label: 'Data da compra', value: fmtDt(prontuarioSale.data_hora) },
                    { label: 'Fat. bruto', value: fmtBRL(prontuarioSale.valor_pago_cliente) },
                    { label: 'Valor líquido', value: fmtBRL(prontuarioSale.valor_liquido) },
                    { label: 'Plataforma', value: prontuarioSale.plataforma ?? '—' },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-gray-800/40 rounded-lg p-3">
                      <p className="text-[10px] text-gray-500 mb-0.5">{label}</p>
                      <p className="text-xs text-white">{value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* SEÇÃO 2 — Histórico de sessões */}
              <div>
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  Histórico de sessões ({prontuarioSessoes.length})
                </h4>

                {/* Barra de progresso geral */}
                {prontuarioSessoes.length > 0 && (
                  <div className="mb-4">
                    <div className="w-full bg-gray-800 rounded-full h-2">
                      <div className="bg-green-500 h-2 rounded-full transition-all"
                        style={{ width: `${totalProntuario > 0 ? (entreguesProntuario / totalProntuario) * 100 : 0}%` }} />
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1">{entreguesProntuario} de {totalProntuario} sessões entregues</p>
                  </div>
                )}

                <div className="space-y-3">
                  {prontuarioSessoes.length === 0 ? (
                    <p className="text-xs text-gray-600 text-center py-4">Nenhuma sessão criada ainda.</p>
                  ) : prontuarioSessoes.map(s => {
                    const badge = STATUS_BADGE[s.status] ?? { label: s.status, cls: 'text-gray-400 bg-gray-400/10' }
                    const remarcacoes = pageData.remarcacoes_por_sessao[s.id] ?? []
                    return (
                      <div key={s.id} className="bg-gray-800/40 border border-white/5 rounded-xl p-4">
                        {/* Header do card */}
                        <div className="flex items-center gap-2 mb-3 flex-wrap">
                          <span className="text-xs text-gray-500 font-medium">Sessão {s.numero_sessao} de {s.total_sessoes}</span>
                          <span className={`text-[11px] px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                          {formatoProntuario && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold border bg-violet-500/20 text-violet-300 border-violet-500/40">
                              {rotuloDiagnostico({ formato: formatoProntuario.formato, numeroSessao: s.numero_sessao, totalSessoes: s.total_sessoes })}
                            </span>
                          )}
                          {s.status !== 'entregue' && s.status !== 'cancelada' && (
                            <span className={`text-[11px] px-2 py-0.5 rounded-full ${(SC_BADGE[s.status_consulta ?? 'aguardando'] ?? SC_BADGE.aguardando).cls}`}>
                              {(SC_BADGE[s.status_consulta ?? 'aguardando'] ?? SC_BADGE.aguardando).label}
                            </span>
                          )}
                          {s.numero_sessao === s.total_sessoes && (
                            <span className="text-[10px] text-red-400 border border-red-400/30 px-1.5 py-0.5 rounded">Última sessão</span>
                          )}
                        </div>

                        {/* Dados */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-3">
                          <div>
                            <p className="text-gray-500">Data agendada</p>
                            <p className="text-white">{fmtDt(s.data_agendada)}</p>
                          </div>
                          {s.status === 'entregue' && (
                            <div>
                              <p className="text-gray-500">Data entregue</p>
                              <p className="text-green-500">{fmtDt(s.data_entrega)}</p>
                            </div>
                          )}
                          <div>
                            <p className="text-gray-500">Terapeuta</p>
                            <p className="text-white">{(s.terapeutas as { nome: string } | null)?.nome ?? '—'}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Comissão</p>
                            <p className="text-green-500">{fmtBRL(s.comissao_valor)}</p>
                          </div>
                          {s.link_meet && (
                            <div>
                              <p className="text-gray-500">Meet</p>
                              <LinkMeetCell id={s.id} link={s.link_meet} copiadoId={linkCopiadoId} onCopy={copiarLinkMeet} />
                            </div>
                          )}
                          {s.agendado_por && (
                            <div>
                              <p className="text-gray-500">Agendado por</p>
                              <p className="text-gray-300 text-[11px]">{s.agendado_por}</p>
                            </div>
                          )}
                        </div>

                        {/* Ações */}
                        <div className="flex items-center gap-3 flex-wrap">
                          {(s.status === 'agendada' || s.status === 'pendente') && (s.status_consulta ?? 'aguardando') === 'aguardando' && (
                            <button onClick={() => { setScSessaoId(s.id); setScAcao('iniciar'); setScErro(''); setScSenhaOpen(true) }}
                              className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors">
                              ▶ Iniciar consulta
                            </button>
                          )}
                          {(s.status === 'agendada' || s.status === 'pendente') && (
                            <button onClick={() => { setScSessaoId(s.id); setScAcao('concluir'); setScConcluirData(nowForDatetimeLocal()); setScErro('') }}
                              className="flex items-center gap-1 text-xs text-green-500 hover:text-green-400 transition-colors">
                              <CheckCircle className="w-3 h-3" /> Concluir consulta
                            </button>
                          )}
                          {s.status === 'entregue' && (
                            <button onClick={() => { setScSessaoId(s.id); setScAcao('anular'); setAnularMotivo(''); setScErro('') }}
                              className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors">
                              Anular sessão
                            </button>
                          )}
                          {(s.status === 'agendada' || s.status === 'pendente') && (
                            <button onClick={() => {
                              setOcorrenciaTipo('remarcacao')
                              setRemSessaoId(s.id)
                              setRemNovaData(s.data_agendada ? isoToDatetimeLocalBRT(s.data_agendada) : '')
                              setRemSolicitadoPor(''); setRemMotivo(''); setRemErro('')
                            }} className="flex items-center gap-1 text-xs text-yellow-400 hover:text-yellow-300 transition-colors">
                              <RefreshCw className="w-3 h-3" /> Remarcar
                            </button>
                          )}
                        </div>

                        {/* Histórico de remarcações desta sessão */}
                        {remarcacoes.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
                            <p className="text-[10px] text-gray-500 uppercase tracking-wide font-medium">
                              Histórico de remarcações ({remarcacoes.length})
                            </p>
                            {remarcacoes.map(r => (
                              <div key={r.id} className="bg-yellow-500/5 border border-yellow-500/15 rounded-lg p-2.5 text-xs space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-yellow-400 text-[10px] font-medium px-1.5 py-0.5 bg-yellow-400/10 rounded">⚠️ Remarcada</span>
                                  <span className="text-gray-500 text-[10px]">Remarcado em {fmtDt(r.created_at)}</span>
                                </div>
                                <p className="text-gray-400"><span className="text-gray-500">Por:</span> {r.remarcado_por_nome} ({r.remarcado_por_tipo})</p>
                                <p className="text-gray-400"><span className="text-gray-500">Solicitado pelo/a:</span> {r.solicitado_por}</p>
                                <p className="text-gray-400"><span className="text-gray-500">De:</span> {fmtDt(r.data_anterior)} → <span className="text-gray-500">Para:</span> {fmtDt(r.data_nova)}</p>
                                <div className="bg-gray-800/60 rounded p-2 text-gray-300">
                                  <span className="text-gray-500">Motivo: </span>{r.motivo}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* SEÇÃO 3 — OCORRÊNCIAS */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Ocorrências</h4>
                  {ocorrenciaTipo === null && (
                    <button onClick={() => setOcorrenciaTipo('select')}
                      className="text-xs text-green-500 hover:text-green-400 font-medium transition-colors">
                      + Registrar Ocorrência
                    </button>
                  )}
                </div>

                {/* Seleção de tipo */}
                {ocorrenciaTipo === 'select' && (
                  <div className="bg-gray-800/50 border border-white/5 rounded-xl p-4 mb-4">
                    <p className="text-xs text-gray-400 mb-3 font-medium">Selecione o tipo de ocorrência:</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {[
                        { tipo: 'nota' as const, icon: '📝', title: 'Nota / Observação', desc: 'Registre uma nota ou observação sobre o paciente' },
                        { tipo: 'remarcacao' as const, icon: '📅', title: 'Remarcar Consulta', desc: 'Solicite a remarcação de uma consulta agendada' },
                        { tipo: 'reembolso' as const, icon: '💰', title: 'Solicitação de Reembolso Parcial', desc: 'Reembolso de sessões não realizadas — vai para aprovação do CEO' },
                      ].map(({ tipo, icon, title, desc }) => (
                        <button key={tipo} onClick={() => setOcorrenciaTipo(tipo)}
                          className="text-left p-3 bg-gray-800 hover:bg-gray-700 border border-white/10 hover:border-white/20 rounded-xl transition-colors">
                          <p className="text-base mb-1">{icon}</p>
                          <p className="text-xs font-medium text-white mb-1">{title}</p>
                          <p className="text-[10px] text-gray-500 leading-relaxed">{desc}</p>
                        </button>
                      ))}
                    </div>
                    <button onClick={() => setOcorrenciaTipo(null)}
                      className="mt-3 text-xs text-gray-500 hover:text-gray-400 transition-colors">Cancelar</button>
                  </div>
                )}

                {/* Formulário: NOTA */}
                {ocorrenciaTipo === 'nota' && (
                  <div className="bg-gray-800/50 border border-white/5 rounded-xl p-4 mb-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-white">📝 Nova nota / observação</p>
                      <button onClick={() => setOcorrenciaTipo(null)} className="text-gray-500 hover:text-white"><X className="w-3.5 h-3.5" /></button>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Título <span className="text-red-400">*</span></label>
                      <input type="text" value={notaTitulo} onChange={e => setNotaTitulo(e.target.value)} maxLength={100}
                        placeholder="Ex: Observação após sessão 2..."
                        className="w-full bg-gray-700 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Descrição <span className="text-red-400">*</span> (mín. 10 caracteres)</label>
                      <textarea value={notaDesc} onChange={e => setNotaDesc(e.target.value)} rows={4}
                        placeholder="Descreva a nota ou observação sobre este paciente..."
                        className="w-full bg-gray-700 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50 resize-y" />
                      <p className="text-[10px] text-gray-600 mt-0.5">{notaDesc.length} caracteres</p>
                    </div>
                    {notaErro && <p className="text-xs text-red-400">{notaErro}</p>}
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => setOcorrenciaTipo(null)}
                        className="px-3 py-1.5 text-xs text-gray-400 bg-gray-700 rounded-lg">Cancelar</button>
                      <button onClick={() => { if (!notaValida) { setNotaErro('Preencha o título e a descrição (mín. 10 caracteres)'); return } setNotaErro(''); setNotaSenhaOpen(true) }}
                        disabled={!notaValida}
                        className="px-4 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg transition-colors">
                        Salvar nota
                      </button>
                    </div>
                  </div>
                )}

                {/* Formulário: REMARCAR */}
                {ocorrenciaTipo === 'remarcacao' && (
                  <div className="bg-gray-800/50 border border-white/5 rounded-xl p-4 mb-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-white">📅 Remarcar consulta</p>
                      <button onClick={() => setOcorrenciaTipo(null)} className="text-gray-500 hover:text-white"><X className="w-3.5 h-3.5" /></button>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Qual sessão remarcar? <span className="text-red-400">*</span></label>
                      <select value={remSessaoId} onChange={e => {
                        const s = prontuarioSessoes.find(x => x.id === e.target.value)
                        setRemSessaoId(e.target.value)
                        setRemNovaData(s?.data_agendada ? isoToDatetimeLocalBRT(s.data_agendada) : '')
                      }} className="w-full bg-gray-700 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50">
                        <option value="">Selecionar sessão...</option>
                        {sessoesPendentesProntuario.map(s => (
                          <option key={s.id} value={s.id}>
                            Sessão {s.numero_sessao} — {fmtDt(s.data_agendada)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-gray-500 block mb-1">Nova data e horário <span className="text-red-400">*</span></label>
                        <input type="datetime-local" value={remNovaData} onChange={e => setRemNovaData(e.target.value)}
                          className="w-full bg-gray-700 border border-white/10 rounded-lg px-2 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50" />
                        {remNovaData && new Date(remNovaData) <= new Date() && (
                          <p className="text-[10px] text-red-400 mt-0.5">A nova data deve ser no futuro</p>
                        )}
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500 block mb-1">Solicitado por <span className="text-red-400">*</span></label>
                        <select value={remSolicitadoPor} onChange={e => setRemSolicitadoPor(e.target.value)}
                          className="w-full bg-gray-700 border border-white/10 rounded-lg px-2 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50">
                          <option value="">Selecionar...</option>
                          <option value="paciente">Paciente</option>
                          <option value="terapeuta">Terapeuta</option>
                          <option value="comercial">Comercial/Admin</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Motivo da remarcação <span className="text-red-400">*</span> (mín. 10 caracteres)</label>
                      <textarea value={remMotivo} onChange={e => setRemMotivo(e.target.value)} rows={3}
                        placeholder="Descreva o motivo pelo qual a consulta está sendo remarcada..."
                        className="w-full bg-gray-700 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50 resize-y" />
                      {remMotivo.length > 0 && remMotivo.length < 10 && (
                        <p className="text-[10px] text-red-400 mt-0.5">O motivo é obrigatório (mínimo 10 caracteres)</p>
                      )}
                    </div>
                    {remErro && <p className="text-xs text-red-400">{remErro}</p>}
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => setOcorrenciaTipo(null)}
                        className="px-3 py-1.5 text-xs text-gray-400 bg-gray-700 rounded-lg">Cancelar</button>
                      <button onClick={() => {
                        if (!remSessaoId) { setRemErro('Selecione a sessão'); return }
                        if (!remSolicitadoPor) { setRemErro('Informe quem solicitou a remarcação'); return }
                        if (remMotivo.length < 10) { setRemErro('Descreva o motivo com pelo menos 10 caracteres'); return }
                        if (!remNovaData || new Date(remNovaData) <= new Date()) { setRemErro('A nova data deve ser no futuro'); return }
                        setRemErro(''); setRemSenhaOpen(true)
                      }} disabled={!remValido}
                        className="px-4 py-1.5 text-xs font-medium text-white bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 rounded-lg transition-colors">
                        Confirmar remarcação
                      </button>
                    </div>
                  </div>
                )}

                {/* Formulário: REEMBOLSO */}
                {ocorrenciaTipo === 'reembolso' && (
                  <div className="bg-gray-800/50 border border-white/5 rounded-xl p-4 mb-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-white">💰 Solicitação de reembolso parcial</p>
                      <button onClick={() => setOcorrenciaTipo(null)} className="text-gray-500 hover:text-white"><X className="w-3.5 h-3.5" /></button>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-2">Sessões elegíveis para reembolso <span className="text-red-400">*</span></label>
                      {sessoesPendentesProntuario.length === 0 ? (
                        <p className="text-xs text-gray-600">Nenhuma sessão pendente/agendada para reembolso.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {sessoesPendentesProntuario.map(s => {
                            const valorSessao = prontuarioSale
                              ? prontuarioSale.valor_pago_cliente / (totalProntuario || 1)
                              : 0
                            return (
                              <label key={s.id} className="flex items-center gap-2.5 cursor-pointer p-2 bg-gray-700/50 rounded-lg hover:bg-gray-700">
                                <input type="checkbox" checked={reeSessoes.includes(s.id)}
                                  onChange={e => setReeSessoes(p => e.target.checked ? [...p, s.id] : p.filter(x => x !== s.id))}
                                  className="accent-indigo-500 w-3.5 h-3.5" />
                                <span className="text-xs text-white">
                                  Sessão {s.numero_sessao} — {fmtDt(s.data_agendada)} — <span className="text-green-500">{fmtBRL(valorSessao)}</span>
                                </span>
                              </label>
                            )
                          })}
                        </div>
                      )}
                    </div>
                    {reembolsoCalc && (
                      <div className="bg-gray-700/50 rounded-lg p-3 space-y-1">
                        <p className="text-[10px] text-gray-500">Cálculo por tabela de preços:</p>
                        <p className="text-lg font-bold text-red-400">{fmtBRL(reembolsoCalc.valor_reembolso)}</p>
                        <p className="text-[11px] text-gray-400 leading-relaxed">{reembolsoCalc.explicacao}</p>
                      </div>
                    )}
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Motivo do reembolso <span className="text-red-400">*</span> (mín. 20 caracteres)</label>
                      <textarea value={reeMotivo} onChange={e => setReeMotivo(e.target.value)} rows={3}
                        placeholder="Descreva detalhadamente o motivo do reembolso..."
                        className="w-full bg-gray-700 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50 resize-y" />
                      {reeMotivo.length > 0 && reeMotivo.length < 20 && (
                        <p className="text-[10px] text-red-400 mt-0.5">{20 - reeMotivo.length} caracteres restantes</p>
                      )}
                    </div>
                    <div className="flex items-start gap-2 bg-yellow-500/8 border border-yellow-500/20 rounded-lg p-3">
                      <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 shrink-0 mt-0.5" />
                      <p className="text-[11px] text-yellow-400">Esta solicitação será enviada para aprovação do CEO antes de ser processada. As sessões NÃO serão canceladas imediatamente.</p>
                    </div>
                    {reeErro && <p className="text-xs text-red-400">{reeErro}</p>}
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => setOcorrenciaTipo(null)}
                        className="px-3 py-1.5 text-xs text-gray-400 bg-gray-700 rounded-lg">Cancelar</button>
                      <button onClick={() => {
                        if (reeSessoes.length === 0) { setReeErro('Selecione pelo menos uma sessão'); return }
                        if (reeMotivo.length < 20) { setReeErro('Descreva o motivo com pelo menos 20 caracteres'); return }
                        setReeErro(''); setReeSenhaOpen(true)
                      }} disabled={!reeValido}
                        className="px-4 py-1.5 text-xs font-medium text-white bg-orange-600 hover:bg-orange-500 disabled:opacity-50 rounded-lg transition-colors">
                        Enviar solicitação
                      </button>
                    </div>
                  </div>
                )}

                {/* Lista de ocorrências */}
                <div className="space-y-2">
                  {prontuarioOcorrencias.length === 0 ? (
                    <p className="text-xs text-gray-600 text-center py-4">Nenhuma ocorrência registrada.</p>
                  ) : prontuarioOcorrencias.map(o => {
                    const meta = OCORRENCIA_META[o.tipo] ?? { icon: '📌', label: o.tipo, cls: 'text-gray-400 bg-gray-400/10 border-gray-400/20' }
                    return (
                      <div key={o.id} className={`border rounded-xl p-3 ${meta.cls}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span>{meta.icon}</span>
                            <span className="text-[11px] font-medium">{meta.label}</span>
                          </div>
                          <span className="text-[10px] opacity-60">{fmtDt(o.created_at)}</span>
                        </div>
                        <p className="text-xs text-white font-medium mb-0.5">{o.titulo}</p>
                        <p className="text-xs opacity-80 leading-relaxed">{o.descricao}</p>
                        <p className="text-[10px] opacity-50 mt-2">
                          Registrado por {o.criado_por_nome} ({o.criado_por_tipo}) — {o.criado_por_email}
                        </p>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* SEÇÃO 4 — Resumo financeiro */}
              {prontuarioSessoes.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Resumo financeiro</h4>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: 'Comissão total', value: fmtBRL(prontuarioSessoes.reduce((a, s) => a + (s.comissao_valor || 0), 0)), color: 'text-white' },
                      { label: 'Comissão gerada', value: fmtBRL(prontuarioSessoes.filter(s => s.status === 'entregue').reduce((a, s) => a + (s.comissao_valor || 0), 0)), color: 'text-green-500' },
                      { label: 'Comissão pendente', value: fmtBRL(prontuarioSessoes.filter(s => ['pendente', 'agendada'].includes(s.status)).reduce((a, s) => a + (s.comissao_valor || 0), 0)), color: 'text-gray-400' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="bg-gray-800/40 rounded-lg p-3">
                        <p className="text-[10px] text-gray-500 mb-1">{label}</p>
                        <p className={`text-sm font-bold ${color}`}>{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── SenhaModals ── */}
      <SenhaModal isOpen={agendarSenhaOpen && !agendarConflitoCompromisso}
        onClose={() => { setAgendarSenhaOpen(false); setAgendarErro('') }}
        onConfirm={handleAgendar} titulo="Confirmar agendamento"
        descricao="Digite sua senha para registrar as sessões" loading={agendarLoading} erro={agendarErro} />

      {/* Horário bloqueado pela PRÓPRIA equipe. A rotina aqui é reservar a vaga
          na agenda do terapeuta antes de agendar, e o agendamento era recusado
          pela própria reserva (caso real da Juliane Eller em 02/09/2026). Só
          aparece quando a rota confirma que TODOS os conflitos são
          compromissos: consulta de outro paciente nunca chega aqui. */}
      {agendarConflitoCompromisso && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-amber-500/30 rounded-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-sm font-semibold text-white mb-1">Horário bloqueado na agenda</h3>
            <p className="text-xs text-gray-500 mb-3">Não é consulta de outro paciente</p>
            <p className="text-sm text-gray-300 mb-4 whitespace-pre-line">{agendarConflitoCompromisso.mensagem}</p>
            <p className="text-xs text-gray-500 mb-5 leading-relaxed">
              Isso é um compromisso da agenda - almoço, gravação, ou uma reserva feita a mão para
              segurar esta vaga. Se o bloqueio foi criado para este mesmo agendamento, pode seguir.
              Se for compromisso de verdade, cancele e escolha outro horário.
            </p>
            <div className="flex gap-2">
              {/* Fecha o modal de senha JUNTO e mantém a mensagem. O formulário
                  de datas só renderiza com `!agendarSenhaOpen`, então limpar só
                  este modal devolvia o comercial para um pedido de senha em
                  branco, sem contexto e sem caminho para o campo de data - no
                  exato momento em que ele precisa saber qual horário estava
                  ocupado para escolher outro. */}
              <button onClick={() => { setAgendarConflitoCompromisso(null); setAgendarSenhaOpen(false) }}
                className="flex-1 px-3 py-2 text-sm text-gray-400 bg-gray-800 border border-white/10 rounded-lg">
                Escolher outro horário
              </button>
              {/* Sem `disabled={agendarLoading}`: o modal desmonta na linha
                  abaixo, antes de `agendarLoading` virar true, então o disabled
                  seria código morto dando falsa sensação de proteção contra
                  clique duplo. O que impede o clique duplo é o desmonte. */}
              <button onClick={() => {
                  const senha = agendarConflitoCompromisso.senha
                  setAgendarConflitoCompromisso(null)
                  handleAgendar(senha, true)
                }}
                className="flex-1 px-3 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-500 rounded-lg transition-colors">
                Agendar assim mesmo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Anular sessão — precisa de motivo antes da senha */}
      {scSessaoId && scAcao === 'anular' && !scSenhaOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-sm font-semibold text-white mb-1">Anular sessão concluída</h3>
            <p className="text-xs text-gray-400 mb-4">Informe o motivo. A sessão voltará ao status &quot;Agendada&quot;.</p>
            <textarea value={anularMotivo} onChange={e => setAnularMotivo(e.target.value)} rows={3}
              placeholder="Motivo da anulação (mínimo 10 caracteres)..."
              className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500/50 resize-none mb-3" />
            {scErro && <p className="text-xs text-red-400 mb-3">{scErro}</p>}
            <div className="flex gap-2">
              <button onClick={() => { setScSessaoId(null); setAnularMotivo('') }}
                className="flex-1 px-3 py-2 text-sm text-gray-400 bg-gray-800 border border-white/10 rounded-lg">Cancelar</button>
              <button onClick={() => {
                if (anularMotivo.trim().length < 10) { setScErro('Mínimo 10 caracteres'); return }
                setScErro(''); setScSenhaOpen(true)
              }} className="flex-1 px-3 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors">
                Próximo →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Concluir sessão — precisa da data de entrega antes da senha */}
      {scSessaoId && scAcao === 'concluir' && !scSenhaOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-sm font-semibold text-white mb-1">Concluir sessão</h3>
            <p className="text-xs text-gray-400 mb-4">Data e horário em que a sessão foi de fato entregue (pode ser uma data passada, no caso de lançamento manual).</p>
            <input type="datetime-local" value={scConcluirData} onChange={e => setScConcluirData(e.target.value)}
              className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-green-500/50 mb-3" />
            {scErro && <p className="text-xs text-red-400 mb-3">{scErro}</p>}
            <div className="flex gap-2">
              <button onClick={() => { setScSessaoId(null); setScConcluirData('') }}
                className="flex-1 px-3 py-2 text-sm text-gray-400 bg-gray-800 border border-white/10 rounded-lg">Cancelar</button>
              <button onClick={() => {
                if (!scConcluirData) { setScErro('Informe a data de entrega'); return }
                setScErro(''); setScSenhaOpen(true)
              }} className="flex-1 px-3 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-500 rounded-lg transition-colors">
                Próximo →
              </button>
            </div>
          </div>
        </div>
      )}

      <SenhaModal isOpen={scSenhaOpen} onClose={() => { setScSenhaOpen(false); setScErro('') }}
        onConfirm={handleStatusConsulta}
        titulo={scAcao === 'iniciar' ? 'Iniciar consulta' : scAcao === 'concluir' ? 'Concluir consulta' : 'Anular sessão'}
        descricao="Digite sua senha para confirmar" loading={scLoading} erro={scErro} />

      <SenhaModal isOpen={notaSenhaOpen} onClose={() => { setNotaSenhaOpen(false); setNotaErro('') }}
        onConfirm={handleNota} titulo="Salvar nota" descricao="Digite sua senha para registrar a ocorrência"
        loading={notaLoading} erro={notaErro} />

      <SenhaModal isOpen={remSenhaOpen} onClose={() => { setRemSenhaOpen(false); setRemErro('') }}
        onConfirm={handleRemarcar} titulo="Confirmar remarcação"
        descricao="Digite sua senha para remarcar a sessão" loading={remLoading} erro={remErro} />

      {/* Aviso de intervalo do Diagnóstico Guiado - aparece assim que uma
          remarcação deixa menos de 7 dias até a sessão vizinha do pacote. */}
      {avisoRemarcacao && !avisoEmpurrarSenhaOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-sm font-semibold text-white mb-1">Intervalo entre sessões</h3>
            {avisoRemarcacao.paciente && (
              <p className="text-xs text-gray-500 mb-3">{avisoRemarcacao.paciente}</p>
            )}
            <p className="text-sm text-gray-300 mb-4">{avisoRemarcacao.mensagem}</p>
            {/* As duas opções têm custo real - o texto precisa deixar isso
                explícito, sem eufemismo, porque quem decide é o comercial. */}
            <p className="text-xs text-gray-500 mb-4 leading-relaxed">
              <span className="text-gray-300 font-medium">Manter</span> deixa a próxima sessão a menos de 7 dias
              desta. <span className="text-gray-300 font-medium">Empurrar</span> remarca todas as sessões
              seguintes deste pacote, mantendo 7 dias entre elas, e o paciente precisa ser avisado.
            </p>
            {/* Desde que as datas do pacote passaram a ser editáveis (02/09/2026),
                "empurrar" deixou de apenas restaurar uma régua que já era
                verdade: ele pode APAGAR datas que o comercial combinou com o
                paciente de propósito. Listar as datas atuais é o mínimo para
                ninguém perder essa escolha sem ver. */}
            {avisoRemarcacao.seguintes.length > 0 && (
              <div className="bg-gray-800/60 rounded-lg p-3 mb-5">
                <p className="text-[11px] text-amber-400 mb-2">
                  Empurrar substitui as datas destas {avisoRemarcacao.seguintes.length} sessão(ões):
                </p>
                <div className="space-y-0.5">
                  {avisoRemarcacao.seguintes.map(x => (
                    <div key={x.numero} className="flex items-center gap-2 text-[11px]">
                      <span className="text-gray-500 w-16 shrink-0">Sessão {x.numero}:</span>
                      <span className="text-gray-300">{x.dataAtual}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {avisoEmpurrarErro && <p className="text-xs text-red-400 mb-3 whitespace-pre-line">{avisoEmpurrarErro}</p>}
            <div className="flex gap-2">
              <button onClick={() => { setAvisoRemarcacao(null); setAvisoEmpurrarErro('') }}
                className="flex-1 px-3 py-2 text-sm text-gray-400 bg-gray-800 border border-white/10 rounded-lg">
                Manter as demais como estão
              </button>
              <button onClick={() => { setAvisoEmpurrarErro(''); setAvisoEmpurrarSenhaOpen(true) }}
                className="flex-1 px-3 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors">
                Empurrar as seguintes
              </button>
            </div>
          </div>
        </div>
      )}

      <SenhaModal isOpen={avisoEmpurrarSenhaOpen} onClose={() => { setAvisoEmpurrarSenhaOpen(false); setAvisoEmpurrarErro('') }}
        onConfirm={handleEmpurrarSeguintes} titulo="Empurrar sessões seguintes"
        descricao="Digite sua senha para remarcar as sessões seguintes deste pacote"
        loading={avisoEmpurrarLoading} erro={avisoEmpurrarErro} />

      <SenhaModal isOpen={reeSenhaOpen} onClose={() => { setReeSenhaOpen(false); setReeErro('') }}
        onConfirm={handleReembolso} titulo="Enviar solicitação de reembolso"
        descricao="Digite sua senha para enviar para aprovação do CEO" loading={reeLoading} erro={reeErro} />

      {/* Confirmação de agendamento */}
      {agendarSucesso && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setAgendarSucesso(null)}>
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-sm mx-4 text-center" onClick={e => e.stopPropagation()}>
            <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 ${agendarSucesso.aviso ? 'bg-amber-500/10' : 'bg-green-500/10'}`}>
              {agendarSucesso.aviso
                ? <AlertTriangle className="w-7 h-7 text-amber-500" />
                : <CheckCircle className="w-7 h-7 text-green-500" />}
            </div>
            <h3 className="text-base font-semibold text-white mb-1">Agendamento confirmado!</h3>
            <p className="text-sm text-gray-400 mb-5">
              {agendarSucesso.sessoes} sessão(ões) agendada(s){agendarSucesso.nome ? ` para ${agendarSucesso.nome}` : ''} com sucesso.
            </p>
            {/* As sessões existem no banco; o que pode ter faltado é o convite
                do Google. Sem isso a tela dizia "confirmado" e o paciente
                ficava sem convite nenhum, sem ninguém saber. */}
            {agendarSucesso.aviso && (
              <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 mb-5 text-left">
                {agendarSucesso.aviso}
              </p>
            )}
            <button onClick={() => setAgendarSucesso(null)}
              className="w-full py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors">
              OK
            </button>
          </div>
        </div>
      )}

      {/* Confirmação de sessões empurradas (Diagnóstico Guiado) */}
      {avisoEmpurrarSucesso !== null && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => { setAvisoEmpurrarSucesso(null); setAvisoEmpurrarCalendario(null) }}>
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-sm mx-4 text-center" onClick={e => e.stopPropagation()}>
            <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 ${avisoEmpurrarCalendario ? 'bg-amber-500/10' : 'bg-green-500/10'}`}>
              {avisoEmpurrarCalendario
                ? <AlertTriangle className="w-7 h-7 text-amber-500" />
                : <CheckCircle className="w-7 h-7 text-green-500" />}
            </div>
            <h3 className="text-base font-semibold text-white mb-1">
              {avisoEmpurrarSucesso === 0 ? 'Nada para empurrar' : 'Sessões remarcadas'}
            </h3>
            {/* movidas=0 significa que não havia sessão seguinte no pacote -
                nada mudou, então não faz sentido pedir pra avisar o paciente
                de uma mudança que não aconteceu (achado da revisão). */}
            <p className="text-sm text-gray-400 mb-5">
              {avisoEmpurrarSucesso === 0
                ? 'Não havia sessões seguintes neste pacote para mover. Nada foi alterado.'
                : `${avisoEmpurrarSucesso} sessão(ões) seguinte(s) ${avisoEmpurrarSucesso === 1 ? 'foi remarcada' : 'foram remarcadas'} pra manter os 7 dias entre elas. Avise o paciente sobre as novas datas.`}
            </p>
            {avisoEmpurrarCalendario && (
              <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5 mb-5 text-left">
                {avisoEmpurrarCalendario}
              </p>
            )}
            <button onClick={() => { setAvisoEmpurrarSucesso(null); setAvisoEmpurrarCalendario(null) }}
              className="w-full py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors">
              OK
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-[100] bg-gray-800 border border-white/10 text-white text-xs px-4 py-2.5 rounded-full shadow-lg">
          {toast}
        </div>
      )}

      <MobileNav />
    </div>
  )
}
