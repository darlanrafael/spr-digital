'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import SenhaModal from '@/components/SenhaModal'
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
  paciente_nome: string
}

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

export default function FechamentosTerapeutasPage() {
  const [terapeutas, setTerapeutas] = useState<Terapeuta[]>([])
  const [terapeutaId, setTerapeutaId] = useState('')
  const [adminEmail, setAdminEmail] = useState('')

  const [preview, setPreview] = useState<{ sessoes: SessaoPendente[]; total: number }>({ sessoes: [], total: 0 })
  const [historico, setHistorico] = useState<FechamentoHistorico[]>([])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState('')
  const [expandido, setExpandido] = useState<string | null>(null)

  const [senhaOpen, setSenhaOpen] = useState(false)
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [confirmErro, setConfirmErro] = useState('')
  const [sucessoMsg, setSucessoMsg] = useState('')

  useEffect(() => {
    const session = getSession()
    if (session) setAdminEmail(session.email)
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
      setHistorico(json.historico ?? [])
    } catch (e) {
      setErro(String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (terapeutaId) loadPreview(terapeutaId)
  }, [terapeutaId])

  async function handleConfirmar(senha: string) {
    setConfirmLoading(true)
    setConfirmErro('')
    const res = await fetch('/api/terapeutas/fechamentos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        terapeuta_id: terapeutaId,
        senha,
        usuario_nome: adminEmail.split('@')[0],
        usuario_tipo: 'admin',
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
            <p className="text-sm text-gray-400 mt-1">Confirme o pagamento de comissão das sessões já entregues</p>
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
            <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden mb-6">
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
                        {preview.sessoes.map(s => (
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
                  <div className="p-4 border-t border-white/10 flex justify-end">
                    <button onClick={() => { setConfirmErro(''); setSenhaOpen(true) }}
                      className="bg-green-600 hover:bg-green-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                      Confirmar fechamento — {fmtBRL(preview.total)}
                    </button>
                  </div>
                </>
              )}
            </div>

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
                      <button onClick={() => setExpandido(e => e === f.id ? null : f.id)}
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
                                {f.sessoes.map(s => (
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
        descricao={`Digite sua senha para confirmar o pagamento de ${fmtBRL(preview.total)}`}
        loading={confirmLoading}
        erro={confirmErro}
      />

      <MobileNav />
    </div>
  )
}
