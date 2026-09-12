'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ChevronDown, ChevronUp, Download } from 'lucide-react'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import SenhaModal from '@/components/SenhaModal'
import Pagination from '@/components/Pagination'
import { getSession } from '@/lib/auth'
import { resumoDoFechamento } from '@/lib/resumo-do-fechamento-terapeuta'
import { agruparPorProduto } from '@/lib/sessoes-por-produto'

// Dados ao vivo — sem isso a Vercel cacheia a página como estática e serve
// versões antigas do CDN mesmo depois de um deploy novo.
export const dynamic = 'force-dynamic'

type Terapeuta = { id: string; nome: string; ativo: boolean }

type SessaoPendente = {
  id: string
  sale_id: string
  numero_sessao: number
  total_sessoes: number
  comissao_valor: number
  data_entrega: string | null
  data_agendada: string | null
  paciente_nome: string
  /** Vem de `sales`, nao de `sessoes`. A tela agrupa por ele. */
  produto?: string | null
  /** So vem preenchido no bloco de ENTREGUES, que inclui as ja pagas. */
  comissao_paga?: boolean | null
}

const SESSOES_PAGE_SIZE = 12

type FechamentoHistorico = {
  id: string
  terapeuta_id: string
  terapeuta_nome: string
  data_confirmacao: string
  valor_total: number
  quantidade_sessoes: number
  sessoes: SessaoPendente[]
}

function fmtBRL(n: number) {
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}
// Só a data, para a faixa de período do histórico de fechamento. Fuso
// explícito: o banco guarda UTC, e uma entrega das 21h30 BRT cai no dia
// seguinte se a conversão for deixada para o navegador.
// A lista em ordem de GRUPO, com um cabecalho de produto antes da primeira
// sessao de cada um.
//
// Agrupa sem abrir mao da paginacao: em vez de N tabelas, e uma lista ordenada
// por grupo com linha de cabecalho no lugar certo. A pagina continua cortando
// em 12 linhas e o cabecalho reaparece no topo da pagina seguinte se o grupo
// continuar. Ver lib/sessoes-por-produto.ts.
type LinhaAgrupada<T> = { tipo: 'cabecalho'; produto: string; qtd: number; total: number; valorPorSessao: number | null; ids: string[] }
  | { tipo: 'sessao'; sessao: T; produto: string }

function linhasAgrupadas<T extends { id: string; sale_id: string; produto?: string | null; comissao_valor: number }>(sessoes: T[]): LinhaAgrupada<T>[] {
  const linhas: LinhaAgrupada<T>[] = []
  for (const g of agruparPorProduto(sessoes)) {
    // Os ids vao no cabecalho de proposito. A primeira versao refazia a conta de
    // quem pertence ao grupo na tela, comparando `x.produto` cru com o titulo -
    // e produto com espaco em volta, ou vazio (que o agrupador rotula como "Sem
    // produto identificado"), ficava de fora da selecao em silencio. Quem sabe
    // o grupo e quem agrupou.
    linhas.push({ tipo: 'cabecalho', produto: g.produto, qtd: g.sessoes.length, total: g.total, valorPorSessao: g.valorPorSessao, ids: g.sessoes.map(x => x.id) })
    for (const sessao of g.sessoes) linhas.push({ tipo: 'sessao', sessao, produto: g.produto })
  }
  return linhas
}

function fmtData(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' })
}
function exportFechamentoCSV(f: FechamentoHistorico) {
  const header = 'Paciente,Sessão,Total sessões,Data entrega,Comissão'
  const rows = f.sessoes.map(s =>
    `"${s.paciente_nome}",${s.numero_sessao},${s.total_sessoes},"${s.data_entrega ?? ''}",${s.comissao_valor}`
  )
  const csv = '﻿' + [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `fechamento-${f.data_confirmacao.slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

type TerapeutaSession = { nome: string; email: string; tipo: string }

export default function FechamentosTerapeutasPage() {
  const searchParams = useSearchParams()
  const [terapeutas, setTerapeutas] = useState<Terapeuta[]>([])
  const [terapeutaId, setTerapeutaId] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [sessionNome, setSessionNome] = useState('')
  const [sessionTipo, setSessionTipo] = useState('admin')

  const [preview, setPreview] = useState<{ sessoes: SessaoPendente[]; total: number }>({ sessoes: [], total: 0 })
  const [futuras, setFuturas] = useState<{ sessoes: SessaoPendente[]; total: number }>({ sessoes: [], total: 0 })
  // Entregues desde o ultimo fechamento, INCLUINDO as ja pagas. A tela de
  // pagamento mostra so o pendente, e sessao paga por antecipacao sumia - foi
  // isso que fez o usuario contar 13 atendimentos onde a tela mostrava 10.
  const [desdeUltimo, setDesdeUltimo] = useState<{
    sessoes: { sessao: SessaoPendente; pagoEm: string | null; fechamentoId: string | null }[]
    corte: string | null; aPagar: number; jaPago: number; total: number
  }>({ sessoes: [], corte: null, aPagar: 0, jaPago: 0, total: 0 })
  const [desdeUltimoAberto, setDesdeUltimoAberto] = useState(false)
  // Pagina como as outras listas. Sem isto o bloco renderiza TODAS as entregues
  // de uma vez, e para terapeuta sem fechamento anterior nao ha corte: o Pedro
  // tem 357 entregues e sairiam 357 linhas numa tela so.
  const [desdeUltimoPage, setDesdeUltimoPage] = useState(1)
  const [futurasAberto, setFuturasAberto] = useState(false)
  const [futurasSelecionadas, setFuturasSelecionadas] = useState<Set<string>>(new Set())
  const [historico, setHistorico] = useState<FechamentoHistorico[]>([])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')
  const [expandido, setExpandido] = useState<string | null>(null)
  const [historicoSessoesPage, setHistoricoSessoesPage] = useState(1)

  const [previewPage, setPreviewPage] = useState(1)
  const [futurasPage, setFuturasPage] = useState(1)

  const [senhaOpen, setSenhaOpen] = useState(false)
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [confirmErro, setConfirmErro] = useState('')
  const [sucessoMsg, setSucessoMsg] = useState('')

  useEffect(() => {
    // "Seu e-mail" só lia a sessão de admin do dashboard principal — qualquer
    // usuário logado direto pelo módulo de Terapeutas (comercial, etc.)
    // ficava sem e-mail nenhum aqui, e a senha nunca batia.
    //
    // terapeutas_session tem prioridade: a senha aqui é validada contra
    // usuarios_sistema (tabela do módulo de terapeutas), então um spr_session
    // esquecido no navegador (login do dashboard principal, de outra conta ou
    // de um teste anterior) sempre falha com "Senha inválida" se usado no
    // lugar do login real da pessoa no módulo.
    const raw = localStorage.getItem('terapeutas_session')
    let usouTerapeutaSession = false
    if (raw) {
      try {
        const ts = JSON.parse(raw) as TerapeutaSession
        setAdminEmail(ts.email)
        setSessionNome(ts.nome)
        setSessionTipo(ts.tipo)
        usouTerapeutaSession = true
      } catch { /* ignore, cai pro fallback abaixo */ }
    }
    if (!usouTerapeutaSession) {
      const session = getSession()
      if (session) {
        setAdminEmail(session.email)
        setSessionNome(session.name)
      }
    }
    fetch('/api/terapeutas/admin/terapeutas')
      .then(r => r.json())
      .then((data: Terapeuta[]) => {
        const ativos = (data ?? []).filter(t => t.ativo)
        setTerapeutas(ativos)
        // Prioriza o terapeuta que veio na URL (ex: link "Fechamentos" clicado
        // de dentro da página de um terapeuta específico) — sem isso sempre
        // caía no primeiro em ordem alfabética (Denise), mesmo vindo do Pedro.
        const daUrl = searchParams.get('terapeutaId')
        const daUrlValido = daUrl && ativos.some(t => t.id === daUrl)
        if (daUrlValido) setTerapeutaId(daUrl!)
        else if (ativos.length > 0) setTerapeutaId(ativos[0].id)
      })
      .catch(() => {})
  }, [])

  async function loadPreview(id: string) {
    if (!id) return
    setLoading(true)
    setErro('')
    setSucessoMsg('')
    try {
      const res = await fetch(`/api/terapeutas/fechamentos?terapeutaId=${id}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Erro ao carregar')
      setPreview(json.preview ?? { sessoes: [], total: 0 })
      setFuturas(json.futuras ?? { sessoes: [], total: 0 })
      setHistorico(json.historico ?? [])
      setDesdeUltimo(json.desdeUltimo ?? { sessoes: [], corte: null, aPagar: 0, jaPago: 0, total: 0 })
      setDesdeUltimoPage(1)
      setPreviewPage(1); setFuturasPage(1)
      setFuturasSelecionadas(new Set())
    } catch (e) {
      setErro(String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (terapeutaId) loadPreview(terapeutaId)
  }, [terapeutaId])

  function toggleFuturaSelecionada(id: string) {
    setFuturasSelecionadas(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const totalAntecipado = futuras.sessoes
    .filter(s => futurasSelecionadas.has(s.id))
    .reduce((a, s) => a + (s.comissao_valor || 0), 0)
  const totalFinal = preview.total + totalAntecipado
  const qtdFinal = preview.sessoes.length + futurasSelecionadas.size

  async function handleConfirmar(senha: string) {
    setConfirmLoading(true)
    setConfirmErro('')
    const res = await fetch('/api/terapeutas/fechamentos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        terapeuta_id: terapeutaId,
        sessoes_futuras_ids: Array.from(futurasSelecionadas),
        senha,
        usuario_nome: sessionNome || adminEmail.split('@')[0],
        usuario_tipo: sessionTipo,
        usuario_email: adminEmail,
      }),
    })
    const json = await res.json()
    setConfirmLoading(false)
    if (!res.ok) { setConfirmErro(json.error ?? 'Erro'); return }
    setSenhaOpen(false)
    setSucessoMsg(`Fechamento confirmado — ${json.quantidade_sessoes} sessão(ões), ${fmtBRL(json.valor_total)}`)
    loadPreview(terapeutaId)
  }

  const terapeutaSelecionado = terapeutas.find(t => t.id === terapeutaId)

  return (
    <div className="min-h-screen bg-gray-950 pb-24 md:pb-8">
      <Header />
      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-white">Fechamentos · Terapeutas</h1>
            <p className="text-sm text-gray-400 mt-1">Confirme o pagamento de comissão das sessões já entregues — ou antecipe sessões futuras quando precisar</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 whitespace-nowrap">Seu e-mail:</span>
            <input type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)}
              className="bg-gray-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500/50 w-48" />
          </div>
        </div>

        <div className="mb-5">
          <label className="text-xs text-gray-400 block mb-1">Terapeuta</label>
          <select value={terapeutaId} onChange={e => setTerapeutaId(e.target.value)}
            className="bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50 w-64">
            {terapeutas.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
        </div>

        {sucessoMsg && (
          <div className="mb-4 px-4 py-3 bg-green-500/10 border border-green-500/20 rounded-xl text-xs text-green-400">{sucessoMsg}</div>
        )}
        {erro && (
          <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400">{erro}</div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Entregues desde o último fechamento — pagas E pendentes.
                Existe porque a lista de pendentes esconde o que já foi pago por
                antecipação, e sem isso não dá pra conferir com a agenda da
                terapeuta. Ver lib/entregues-desde-o-fechamento.ts. */}
            {desdeUltimo.sessoes.length > 0 && (
              <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden mb-4">
                <button onClick={() => setDesdeUltimoAberto(v => !v)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/2 transition-colors">
                  <div className="text-left">
                    <h2 className="text-sm font-semibold text-white">
                      Sessões entregues desde o último fechamento ({desdeUltimo.sessoes.length})
                    </h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {desdeUltimo.corte
                        ? <>Entregues a partir de {fmtData(desdeUltimo.corte)}. Inclui as que já foram pagas, para conferir com a agenda dela.</>
                        : 'Nenhum fechamento anterior — todas as sessões entregues.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-sm font-semibold text-green-500">{fmtBRL(desdeUltimo.aPagar)}</p>
                      <p className="text-[11px] text-gray-500">a pagar</p>
                    </div>
                    {desdeUltimoAberto ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
                  </div>
                </button>
                {desdeUltimoAberto && (
                  <div className="border-t border-white/10">
                    <div className="px-4 py-2.5 flex flex-wrap gap-x-6 gap-y-1 bg-gray-800/30 border-b border-white/5 text-[11px]">
                      <span className="text-gray-400">Total entregue: <strong className="text-white">{fmtBRL(desdeUltimo.total)}</strong> em {desdeUltimo.sessoes.length} sessão(ões)</span>
                      <span className="text-gray-400">A pagar: <strong className="text-green-500">{fmtBRL(desdeUltimo.aPagar)}</strong> em {desdeUltimo.sessoes.filter(s => !s.pagoEm && !s.sessao.comissao_paga).length}</span>
                      <span className="text-gray-400">Já pago: <strong className="text-amber-400">{fmtBRL(desdeUltimo.jaPago)}</strong> em {desdeUltimo.sessoes.filter(s => s.sessao.comissao_paga).length}</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-white/5">
                            {['Paciente', 'Sessão', 'Data entrega', 'Comissão', ''].map((h, i) => (
                              <th key={i} className="px-4 py-3 text-left text-xs text-gray-500 font-medium">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {desdeUltimo.sessoes
                            .slice((desdeUltimoPage - 1) * SESSOES_PAGE_SIZE, desdeUltimoPage * SESSOES_PAGE_SIZE)
                            .map(l => (
                            <tr key={l.sessao.id} className="border-b border-white/5">
                              <td className="px-4 py-3 text-white">{l.sessao.paciente_nome}</td>
                              <td className="px-4 py-3 text-gray-300">{l.sessao.numero_sessao} de {l.sessao.total_sessoes}</td>
                              <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDt(l.sessao.data_entrega)}</td>
                              <td className={`px-4 py-3 whitespace-nowrap ${l.sessao.comissao_paga ? 'text-gray-500' : 'text-green-500'}`}>
                                {fmtBRL(l.sessao.comissao_valor)}
                              </td>
                              <td className="px-4 py-3">
                                {l.sessao.comissao_paga && (
                                  <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-amber-500/15 text-amber-400 border-amber-500/30 whitespace-nowrap">
                                    {l.pagoEm ? `Pago no fechamento de ${fmtData(l.pagoEm)}` : 'Já pago'}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {desdeUltimo.sessoes.length > SESSOES_PAGE_SIZE && (
                      <Pagination
                        currentPage={desdeUltimoPage}
                        totalPages={Math.ceil(desdeUltimo.sessoes.length / SESSOES_PAGE_SIZE)}
                        onPrevious={() => setDesdeUltimoPage(p => Math.max(1, p - 1))}
                        onNext={() => setDesdeUltimoPage(p => Math.min(Math.ceil(desdeUltimo.sessoes.length / SESSOES_PAGE_SIZE), p + 1))}
                      />
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Preview de sessões pendentes de pagamento */}
            <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden mb-4">
              <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">
                  Sessões entregues pendentes de pagamento ({preview.sessoes.length})
                </h2>
                {preview.sessoes.length > 0 && (
                  <span className="text-sm font-bold text-yellow-400">{fmtBRL(preview.total)}</span>
                )}
              </div>
              {preview.sessoes.length === 0 ? (
                <p className="px-4 py-8 text-center text-gray-600 text-xs">Nenhuma sessão entregue pendente de pagamento para {terapeutaSelecionado?.nome ?? 'este terapeuta'}</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/5">
                          {['Paciente', 'Sessão', 'Data entrega', 'Comissão'].map(h => (
                            <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-medium">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {linhasAgrupadas(preview.sessoes)
                          .slice((previewPage - 1) * SESSOES_PAGE_SIZE, previewPage * SESSOES_PAGE_SIZE)
                          .map((l, i) => l.tipo === 'cabecalho' ? (
                            <tr key={`h-${l.produto}-${i}`} className="bg-white/[0.03] border-b border-white/5">
                              <td colSpan={4} className="px-4 py-2">
                                <span className="text-xs font-semibold text-indigo-300">{l.produto}</span>
                                <span className="text-[11px] text-gray-500">
                                  {' · '}{l.qtd} sessão(ões) · {fmtBRL(l.total)}
                                  {l.valorPorSessao !== null && ` · ${fmtBRL(l.valorPorSessao)} por sessão`}
                                </span>
                              </td>
                            </tr>
                          ) : (
                          <tr key={l.sessao.id} className="border-b border-white/5">
                            <td className="px-4 py-3 text-white">{l.sessao.paciente_nome}</td>
                            <td className="px-4 py-3 text-gray-300">{l.sessao.numero_sessao} de {l.sessao.total_sessoes}</td>
                            <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDt(l.sessao.data_entrega)}</td>
                            <td className="px-4 py-3 text-green-500 whitespace-nowrap">{fmtBRL(l.sessao.comissao_valor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Conta as LINHAS e nao as sessoes: os cabecalhos de grupo
                      ocupam linha, e paginar pelas sessoes deixaria a ultima
                      pagina faltando itens. */}
                  {linhasAgrupadas(preview.sessoes).length > SESSOES_PAGE_SIZE && (
                    <Pagination
                      currentPage={previewPage}
                      totalPages={Math.ceil(linhasAgrupadas(preview.sessoes).length / SESSOES_PAGE_SIZE)}
                      onPrevious={() => setPreviewPage(p => Math.max(1, p - 1))}
                      onNext={() => setPreviewPage(p => Math.min(Math.ceil(linhasAgrupadas(preview.sessoes).length / SESSOES_PAGE_SIZE), p + 1))}
                    />
                  )}
                </>
              )}
            </div>

            {/* Sessões futuras — antecipar pagamento (opcional, caso a caso) */}
            <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden mb-6">
              <button onClick={() => setFuturasAberto(v => !v)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/2 transition-colors">
                <div className="text-left">
                  <h2 className="text-sm font-semibold text-white">
                    Sessões futuras — antecipar pagamento ({futuras.sessoes.length})
                  </h2>
                  <p className="text-xs text-gray-500 mt-0.5">Sessões vendidas mas ainda não entregues. Marque só as que quiser adiantar pro terapeuta.</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {futurasSelecionadas.size > 0 && (
                    <span className="text-sm font-bold text-purple-400">{futurasSelecionadas.size} selecionada(s) — {fmtBRL(totalAntecipado)}</span>
                  )}
                  {futurasAberto ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
                </div>
              </button>
              {futurasAberto && (
                futuras.sessoes.length === 0 ? (
                  <p className="px-4 py-8 text-center text-gray-600 text-xs border-t border-white/10">Nenhuma sessão futura vendida pra {terapeutaSelecionado?.nome ?? 'este terapeuta'}</p>
                ) : (
                  <div className="border-t border-white/10">
                    <div className="px-4 py-2 flex items-center gap-3 border-b border-white/5 bg-gray-800/30">
                      <button onClick={() => setFuturasSelecionadas(new Set(futuras.sessoes.map(s => s.id)))}
                        className="text-xs text-purple-400 hover:text-purple-300 font-medium transition-colors">
                        Selecionar todos
                      </button>
                      <span className="text-gray-700">·</span>
                      <button onClick={() => setFuturasSelecionadas(new Set())}
                        className="text-xs text-gray-500 hover:text-gray-300 font-medium transition-colors">
                        Desmarcar todos
                      </button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-white/5">
                            <th className="px-4 py-3 w-8"></th>
                            {['Paciente', 'Sessão', 'Data agendada', 'Comissão'].map(h => (
                              <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-medium">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {linhasAgrupadas(futuras.sessoes)
                            .slice((futurasPage - 1) * SESSOES_PAGE_SIZE, futurasPage * SESSOES_PAGE_SIZE)
                            .map((l, i) => l.tipo === 'cabecalho' ? (
                              <tr key={`hf-${l.produto}-${i}`} className="bg-white/[0.03] border-b border-white/5">
                                <td className="px-4 py-2">
                                  {/* Marca o GRUPO inteiro. Antecipar o Diagnostico
                                      inteiro sem clicar em 64 caixas era o pedido
                                      implicito de separar por produto. */}
                                  <input
                                    type="checkbox"
                                    checked={l.ids.length > 0 && l.ids.every(id => futurasSelecionadas.has(id))}
                                    onChange={e => {
                                      setFuturasSelecionadas(prev => {
                                        const novo = new Set(prev)
                                        for (const id of l.ids) { if (e.target.checked) novo.add(id); else novo.delete(id) }
                                        return novo
                                      })
                                    }}
                                    onClick={ev => ev.stopPropagation()}
                                    className="w-4 h-4 rounded accent-purple-600"
                                    aria-label={`Antecipar todas as sessões de ${l.produto}`}
                                  />
                                </td>
                                <td colSpan={4} className="px-4 py-2">
                                  <span className="text-xs font-semibold text-indigo-300">{l.produto}</span>
                                  <span className="text-[11px] text-gray-500">
                                    {' · '}{l.qtd} sessão(ões) · {fmtBRL(l.total)}
                                    {l.valorPorSessao !== null && ` · ${fmtBRL(l.valorPorSessao)} por sessão`}
                                  </span>
                                </td>
                              </tr>
                            ) : (
                            <tr key={l.sessao.id} className="border-b border-white/5 cursor-pointer hover:bg-white/2 transition-colors" onClick={() => toggleFuturaSelecionada(l.sessao.id)}>
                              <td className="px-4 py-3">
                                <input type="checkbox" checked={futurasSelecionadas.has(l.sessao.id)} onChange={() => toggleFuturaSelecionada(l.sessao.id)}
                                  onClick={e => e.stopPropagation()}
                                  className="w-4 h-4 rounded accent-purple-600" />
                              </td>
                              <td className="px-4 py-3 text-white">{l.sessao.paciente_nome}</td>
                              <td className="px-4 py-3 text-gray-300">{l.sessao.numero_sessao} de {l.sessao.total_sessoes}</td>
                              <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDt(l.sessao.data_agendada)}</td>
                              <td className="px-4 py-3 text-purple-400 whitespace-nowrap">{fmtBRL(l.sessao.comissao_valor)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {linhasAgrupadas(futuras.sessoes).length > SESSOES_PAGE_SIZE && (
                      <Pagination
                        currentPage={futurasPage}
                        totalPages={Math.ceil(linhasAgrupadas(futuras.sessoes).length / SESSOES_PAGE_SIZE)}
                        onPrevious={() => setFuturasPage(p => Math.max(1, p - 1))}
                        onNext={() => setFuturasPage(p => Math.min(Math.ceil(linhasAgrupadas(futuras.sessoes).length / SESSOES_PAGE_SIZE), p + 1))}
                      />
                    )}
                  </div>
                )
              )}
            </div>

            {qtdFinal > 0 && (
              <div className="bg-gray-900 border border-white/10 rounded-xl p-4 mb-6 flex items-center justify-between">
                <div>
                  <p className="text-sm text-white font-medium">
                    {preview.sessoes.length} entregue(s){futurasSelecionadas.size > 0 ? ` + ${futurasSelecionadas.size} antecipada(s)` : ''} = {qtdFinal} sessão(ões)
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">Total a pagar</p>
                </div>
                <button onClick={() => { setConfirmErro(''); setSenhaOpen(true) }}
                  className="bg-green-600 hover:bg-green-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                  Confirmar fechamento — {fmtBRL(totalFinal)}
                </button>
              </div>
            )}

            {/* Histórico */}
            <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10">
                <h2 className="text-sm font-semibold text-white">Histórico de fechamentos ({historico.length})</h2>
              </div>
              {historico.length === 0 ? (
                <p className="px-4 py-8 text-center text-gray-600 text-xs">Nenhum fechamento realizado ainda para este terapeuta</p>
              ) : (
                <div className="divide-y divide-white/5">
                  {historico.map(f => (
                    <div key={f.id}>
                      <button onClick={() => { setExpandido(e => e === f.id ? null : f.id); setHistoricoSessoesPage(1) }}
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/2 transition-colors">
                        <div className="text-left min-w-0">
                          {/* O periodo apurado na faixa de cima, como no historico da
                              empresa desde 17/08/2026. A data de confirmacao NAO diz o
                              periodo: o fechamento de 14/08 cobre entregas de 17/06 a
                              17/08. Ver lib/resumo-do-fechamento-terapeuta.ts. */}
                          {(() => {
                            const r = resumoDoFechamento(f.sessoes)
                            return (
                              <>
                                <p className="text-sm text-white">
                                  {r.de && r.ate
                                    ? (r.de.slice(0, 10) === r.ate.slice(0, 10)
                                        ? fmtData(r.de)
                                        : <>{fmtData(r.de)} <span className="text-gray-500">→</span> {fmtData(r.ate)}</>)
                                    : 'Somente sessões antecipadas'}
                                </p>
                                <p className="text-xs text-gray-500">
                                  Confirmado em {fmtDt(f.data_confirmacao)}
                                  {' · '}{f.quantidade_sessoes} sessão(ões)
                                  {r.pacientes > 0 && ` · ${r.pacientes} paciente(s)`}
                                  {r.antecipadas > 0 && `, ${r.antecipadas} antecipada(s)`}
                                </p>
                              </>
                            )
                          })()}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold text-green-500">{fmtBRL(f.valor_total)}</span>
                          {expandido === f.id ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
                        </div>
                      </button>
                      {expandido === f.id && (
                        <div className="px-4 pb-4">
                          <div className="flex justify-end mb-2">
                            <button onClick={() => exportFechamentoCSV(f)}
                              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-lg transition-colors">
                              <Download className="w-3.5 h-3.5" /> Baixar CSV
                            </button>
                          </div>
                          <div className="overflow-x-auto bg-gray-800/40 rounded-lg">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-white/5">
                                  {['Paciente', 'Sessão', 'Data entrega', 'Comissão'].map(h => (
                                    <th key={h} className="px-3 py-2 text-left text-gray-500 font-medium">{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {f.sessoes
                                  .slice((historicoSessoesPage - 1) * SESSOES_PAGE_SIZE, historicoSessoesPage * SESSOES_PAGE_SIZE)
                                  .map(s => (
                                  <tr key={s.id} className="border-b border-white/5">
                                    <td className="px-3 py-2 text-white">{s.paciente_nome}</td>
                                    <td className="px-3 py-2 text-gray-300">{s.numero_sessao} de {s.total_sessoes}</td>
                                    <td className="px-3 py-2 text-gray-400 whitespace-nowrap">{fmtDt(s.data_entrega)}</td>
                                    <td className="px-3 py-2 text-green-500 whitespace-nowrap">{fmtBRL(s.comissao_valor)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {f.sessoes.length > SESSOES_PAGE_SIZE && (
                            <Pagination
                              currentPage={historicoSessoesPage}
                              totalPages={Math.ceil(f.sessoes.length / SESSOES_PAGE_SIZE)}
                              onPrevious={() => setHistoricoSessoesPage(p => Math.max(1, p - 1))}
                              onNext={() => setHistoricoSessoesPage(p => Math.min(Math.ceil(f.sessoes.length / SESSOES_PAGE_SIZE), p + 1))}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </main>

      <SenhaModal
        isOpen={senhaOpen}
        onClose={() => { setSenhaOpen(false); setConfirmErro('') }}
        onConfirm={handleConfirmar}
        titulo="Confirmar fechamento de comissão"
        descricao={`Digite sua senha para confirmar o pagamento de ${fmtBRL(totalFinal)}`}
        loading={confirmLoading}
        erro={confirmErro}
      />

      <MobileNav />
    </div>
  )
}
