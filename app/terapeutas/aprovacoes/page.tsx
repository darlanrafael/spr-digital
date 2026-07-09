'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle, X, RefreshCw, AlertTriangle } from 'lucide-react'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import SenhaModal from '@/components/SenhaModal'

// Dados ao vivo — sem isso a Vercel cacheia a página como estática e serve
// versões antigas do CDN mesmo depois de um deploy novo.
export const dynamic = 'force-dynamic'

type Solicitacao = {
  id: string
  sale_id: string
  paciente_nome: string
  paciente_email: string
  sessoes_ids: string[]
  sessoes_numeros: number[]
  valor_reembolso: number
  motivo: string
  solicitado_por_nome: string
  solicitado_por_tipo: string
  solicitado_por_email: string
  status: string
  aprovado_por_nome: string | null
  aprovado_por_email: string | null
  justificativa_rejeicao: string | null
  created_at: string
  updated_at: string
}

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

export default function TerapeutasAprovacoes() {
  const [pendentes, setPendentes] = useState<Solicitacao[]>([])
  const [historico, setHistorico] = useState<Solicitacao[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [adminEmail, setAdminEmail] = useState('rafael@spr.com')

  // Toast
  const [toast, setToast] = useState('')
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function showToast(msg: string) {
    setToast(msg)
    if (toastRef.current) clearTimeout(toastRef.current)
    toastRef.current = setTimeout(() => setToast(''), 3500)
  }

  // Modal aprovar
  const [aprovarId, setAprovarId] = useState<string | null>(null)
  const [aprovarSenhaOpen, setAprovarSenhaOpen] = useState(false)
  const [aprovarLoading, setAprovarLoading] = useState(false)
  const [aprovarErro, setAprovarErro] = useState('')

  // Modal rejeitar
  const [rejeitarId, setRejeitarId] = useState<string | null>(null)
  const [rejeitarJustificativa, setRejeitarJustificativa] = useState('')
  const [rejeitarSenhaOpen, setRejeitarSenhaOpen] = useState(false)
  const [rejeitarLoading, setRejeitarLoading] = useState(false)
  const [rejeitarErro, setRejeitarErro] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    setErro('')
    try {
      const res = await fetch('/api/terapeutas/aprovacoes')
      if (!res.ok) throw new Error(await res.text())
      const json = await res.json()
      setPendentes(json.pendentes ?? [])
      setHistorico(json.historico ?? [])
    } catch (e) {
      setErro(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  function nomeFromEmail(email: string) {
    return email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }

  async function handleAprovar(senha: string) {
    if (!aprovarId) return
    setAprovarLoading(true); setAprovarErro('')
    const res = await fetch('/api/terapeutas/aprovacoes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: aprovarId,
        acao: 'aprovar',
        senha,
        usuario_nome: nomeFromEmail(adminEmail),
        usuario_email: adminEmail,
      }),
    })
    const json = await res.json()
    setAprovarLoading(false)
    if (!res.ok) { setAprovarErro(json.error ?? 'Erro'); return }
    setAprovarSenhaOpen(false)
    setAprovarId(null)
    showToast('✓ Reembolso aprovado e sessões canceladas!')
    loadData()
  }

  async function handleRejeitar(senha: string) {
    if (!rejeitarId) return
    if (rejeitarJustificativa.trim().length < 10) {
      setRejeitarErro('Justificativa obrigatória (mínimo 10 caracteres)')
      return
    }
    setRejeitarLoading(true); setRejeitarErro('')
    const res = await fetch('/api/terapeutas/aprovacoes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: rejeitarId,
        acao: 'rejeitar',
        justificativa: rejeitarJustificativa,
        senha,
        usuario_nome: nomeFromEmail(adminEmail),
        usuario_email: adminEmail,
      }),
    })
    const json = await res.json()
    setRejeitarLoading(false)
    if (!res.ok) { setRejeitarErro(json.error ?? 'Erro'); return }
    setRejeitarSenhaOpen(false)
    setRejeitarId(null)
    setRejeitarJustificativa('')
    showToast('✓ Solicitação rejeitada.')
    loadData()
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-24 md:pb-8">
      <Header />
      <main className="max-w-4xl mx-auto px-4 py-6">

        {/* Cabeçalho */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-white">Aprovações Pendentes</h1>
            <p className="text-sm text-gray-400 mt-1">Solicitações aguardando sua decisão</p>
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

        {/* Badge de alerta */}
        {!loading && pendentes.length > 0 && (
          <div className="mb-5 flex items-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl">
            <span className="flex items-center gap-1.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
              </span>
              <span className="text-sm font-medium text-red-400">
                {pendentes.length} solicitação(ões) aguardando aprovação
              </span>
            </span>
          </div>
        )}

        {erro && (
          <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400">{erro}</div>
        )}

        {loading ? (
          <div className="flex justify-center h-40 items-center">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Pendentes */}
            <div className="space-y-4 mb-8">
              {pendentes.length === 0 ? (
                <div className="text-center py-16">
                  <CheckCircle className="w-10 h-10 text-green-500/40 mx-auto mb-3" />
                  <p className="text-sm text-gray-500">Nenhuma solicitação pendente</p>
                  <p className="text-xs text-gray-600 mt-1">Tudo em dia!</p>
                </div>
              ) : pendentes.map(sol => (
                <div key={sol.id} className="bg-gray-900 border border-orange-500/20 rounded-xl overflow-hidden">
                  {/* Header */}
                  <div className="px-5 py-4 border-b border-white/5 flex items-start justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">{sol.paciente_nome}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{sol.paciente_email}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Solicitado em</p>
                      <p className="text-xs text-gray-300">{fmtDt(sol.created_at)}</p>
                    </div>
                  </div>

                  <div className="px-5 py-4 space-y-4">
                    {/* Solicitante */}
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-gray-500">Solicitado por:</span>
                      <span className="text-white font-medium">{sol.solicitado_por_nome}</span>
                      <span className="text-indigo-400 capitalize bg-indigo-400/10 px-2 py-0.5 rounded-full">{sol.solicitado_por_tipo}</span>
                    </div>

                    {/* Sessões */}
                    <div>
                      <p className="text-xs text-gray-500 mb-1.5">Sessões a cancelar:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {(sol.sessoes_numeros as number[]).map(n => (
                          <span key={n} className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 px-2 py-0.5 rounded">
                            Sessão {n}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Valor */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">Valor a reembolsar:</span>
                      <span className="text-xl font-bold text-red-400">{fmtBRL(sol.valor_reembolso)}</span>
                    </div>

                    {/* Motivo */}
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Motivo:</p>
                      <div className="bg-gray-800/60 rounded-lg p-3 text-xs text-gray-300 leading-relaxed">{sol.motivo}</div>
                    </div>

                    {/* Ações */}
                    <div className="flex items-center gap-3 pt-1">
                      <button onClick={() => { setAprovarId(sol.id); setAprovarErro(''); setAprovarSenhaOpen(true) }}
                        className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-green-600 hover:bg-green-500 rounded-lg transition-colors">
                        <CheckCircle className="w-3.5 h-3.5" /> Aprovar reembolso
                      </button>
                      <button onClick={() => { setRejeitarId(sol.id); setRejeitarJustificativa(''); setRejeitarErro('') }}
                        className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors">
                        <X className="w-3.5 h-3.5" /> Rejeitar
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Histórico */}
            {historico.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Histórico</h2>
                <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-white/10">
                          {['Data', 'Paciente', 'Valor', 'Status', 'Decidido por', 'Data decisão'].map(h => (
                            <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-medium whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {historico.map(sol => (
                          <tr key={sol.id} className="border-b border-white/5 hover:bg-white/2">
                            <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDt(sol.created_at)}</td>
                            <td className="px-4 py-3">
                              <p className="text-white text-xs">{sol.paciente_nome}</p>
                              <p className="text-[10px] text-gray-500">{sol.paciente_email}</p>
                            </td>
                            <td className="px-4 py-3 text-red-400 text-xs whitespace-nowrap">{fmtBRL(sol.valor_reembolso)}</td>
                            <td className="px-4 py-3">
                              <span className={`text-[11px] px-2 py-0.5 rounded-full ${
                                sol.status === 'aprovado' ? 'text-green-500 bg-green-500/10' : 'text-red-400 bg-red-400/10'
                              }`}>
                                {sol.status === 'aprovado' ? '✓ Aprovado' : '✗ Rejeitado'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-gray-300 text-xs">{sol.aprovado_por_nome ?? '—'}</td>
                            <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDt(sol.updated_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Modal rejeitar (inline) */}
      {rejeitarId && !rejeitarSenhaOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-sm mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Rejeitar solicitação</h3>
              <button onClick={() => { setRejeitarId(null); setRejeitarJustificativa('') }} className="text-gray-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="mb-4">
              <div className="flex items-start gap-2 bg-yellow-500/8 border border-yellow-500/20 rounded-lg p-3 mb-3">
                <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-yellow-400">A solicitação será rejeitada e o paciente continuará com as sessões ativas.</p>
              </div>
              <label className="text-xs text-gray-400 block mb-2">Justificativa <span className="text-red-400">*</span> (mín. 10 caracteres)</label>
              <textarea value={rejeitarJustificativa} onChange={e => setRejeitarJustificativa(e.target.value)} rows={4}
                placeholder="Explique o motivo da rejeição..."
                className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50 resize-y" />
              {rejeitarErro && <p className="text-xs text-red-400 mt-1">{rejeitarErro}</p>}
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setRejeitarId(null); setRejeitarJustificativa('') }}
                className="flex-1 px-4 py-2 text-sm text-gray-400 bg-gray-800 border border-white/10 rounded-lg">Cancelar</button>
              <button onClick={() => {
                if (rejeitarJustificativa.trim().length < 10) { setRejeitarErro('Justificativa obrigatória (mínimo 10 caracteres)'); return }
                setRejeitarErro(''); setRejeitarSenhaOpen(true)
              }} className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors">
                Continuar
              </button>
            </div>
          </div>
        </div>
      )}

      <SenhaModal isOpen={aprovarSenhaOpen} onClose={() => { setAprovarSenhaOpen(false); setAprovarErro('') }}
        onConfirm={handleAprovar} titulo="Confirmar aprovação de reembolso"
        descricao="Esta ação cancelará as sessões selecionadas. Digite sua senha para confirmar."
        loading={aprovarLoading} erro={aprovarErro} />

      <SenhaModal isOpen={rejeitarSenhaOpen} onClose={() => { setRejeitarSenhaOpen(false); setRejeitarErro('') }}
        onConfirm={handleRejeitar} titulo="Confirmar rejeição"
        descricao="Digite sua senha para registrar a rejeição da solicitação."
        loading={rejeitarLoading} erro={rejeitarErro} />

      {toast && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-[100] bg-gray-800 border border-white/10 text-white text-xs px-4 py-2.5 rounded-full shadow-lg">
          {toast}
        </div>
      )}

      <MobileNav />
    </div>
  )
}
