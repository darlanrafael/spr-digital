'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Download } from 'lucide-react'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import SenhaModal from '@/components/SenhaModal'
import Pagination from '@/components/Pagination'
import { getSession } from '@/lib/auth'

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
  const [terapeutas, setTerapeutas] = useState<Terapeuta[]>([])
  const [terapeutaId, setTerapeutaId] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [sessionNome, setSessionNome] = useState('')
  const [sessionTipo, setSessionTipo] = useState('admin')

  const [preview, setPreview] = useState<{ sessoes: SessaoPendente[]; total: number }>({ sessoes: [], total: 0 })
  const [futuras, setFuturas] = useState<{ sessoes: SessaoPendente[]; total: number }>({ sessoes: [], total: 0 })
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
    const session = getSession()
    if (session) {
      setAdminEmail(session.email)
      setSessionNome(session.name)
    } else {
      const raw = localStorage.getItem('terapeutas_session')
      if (raw) {
        try {
          const ts = JSON.parse(raw) as TerapeutaSession
          setAdminEmail(ts.email)
          setSessionNome(ts.nome)
          setSessionTipo(ts.tipo)
        } catch { /* ignore */ }
      }
    }
    fetch('/api/terapeutas/admin/terapeutas')
      .then(r => r.json())
      .then((data: Terapeuta[]) => {
        const ativos = (data ?? []).filter(t => t.ativo)
        setTerapeutas(ativos)
        if (ativos.length > 0) setTerapeutaId(ativos[0].id)
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
                        {preview.sessoes
                          .slice((previewPage - 1) * SESSOES_PAGE_SIZE, previewPage * SESSOES_PAGE_SIZE)
                          .map(s => (
                          <tr key={s.id} className="border-b border-white/5">
                            <td className="px-4 py-3 text-white">{s.paciente_nome}</td>
                            <td className="px-4 py-3 text-gray-300">{s.numero_sessao} de {s.total_sessoes}</td>
                            <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDt(s.data_entrega)}</td>
                            <td className="px-4 py-3 text-green-500 whitespace-nowrap">{fmtBRL(s.comissao_valor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {preview.sessoes.length > SESSOES_PAGE_SIZE && (
                    <Pagination
                      currentPage={previewPage}
                      totalPages={Math.ceil(preview.sessoes.length / SESSOES_PAGE_SIZE)}
                      onPrevious={() => setPreviewPage(p => Math.max(1, p - 1))}
                      onNext={() => setPreviewPage(p => Math.min(Math.ceil(preview.sessoes.length / SESSOES_PAGE_SIZE), p + 1))}
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
                          {futuras.sessoes
                            .slice((futurasPage - 1) * SESSOES_PAGE_SIZE, futurasPage * SESSOES_PAGE_SIZE)
                            .map(s => (
                            <tr key={s.id} className="border-b border-white/5 cursor-pointer hover:bg-white/2 transition-colors" onClick={() => toggleFuturaSelecionada(s.id)}>
                              <td className="px-4 py-3">
                                <input type="checkbox" checked={futurasSelecionadas.has(s.id)} onChange={() => toggleFuturaSelecionada(s.id)}
                                  onClick={e => e.stopPropagation()}
                                  className="w-4 h-4 rounded accent-purple-600" />
                              </td>
                              <td className="px-4 py-3 text-white">{s.paciente_nome}</td>
                              <td className="px-4 py-3 text-gray-300">{s.numero_sessao} de {s.total_sessoes}</td>
                              <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDt(s.data_agendada)}</td>
                              <td className="px-4 py-3 text-purple-400 whitespace-nowrap">{fmtBRL(s.comissao_valor)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {futuras.sessoes.length > SESSOES_PAGE_SIZE && (
                      <Pagination
                        currentPage={futurasPage}
                        totalPages={Math.ceil(futuras.sessoes.length / SESSOES_PAGE_SIZE)}
                        onPrevious={() => setFuturasPage(p => Math.max(1, p - 1))}
                        onNext={() => setFuturasPage(p => Math.min(Math.ceil(futuras.sessoes.length / SESSOES_PAGE_SIZE), p + 1))}
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
                        <div className="text-left">
                          <p className="text-sm text-white">{fmtDt(f.data_confirmacao)}</p>
                          <p className="text-xs text-gray-500">{f.quantidade_sessoes} sessão(ões)</p>
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
