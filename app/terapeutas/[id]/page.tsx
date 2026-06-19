'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { CheckCircle, RefreshCw, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import SenhaModal from '@/components/SenhaModal'
import { getSupabaseClient } from '@/lib/supabase'

type Terapeuta = {
  id: string
  nome: string
  email: string
  percentual_comissao: number
}

type Sessao = {
  id: string
  sale_id: string
  numero_sessao: number
  total_sessoes: number
  status: string
  data_agendada: string | null
  data_entrega: string | null
  link_meet: string | null
  comissao_valor: number
  comissao_paga: boolean
  paciente_nome: string
  paciente_email: string
  entregue_confirmado_por: string | null
}

function fmtBRL(n: number) {
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pendente: { label: 'Pendente', color: 'text-amber-400 bg-amber-400/10' },
  agendada: { label: 'Agendada', color: 'text-blue-400 bg-blue-400/10' },
  entregue: { label: 'Entregue', color: 'text-green-500 bg-green-500/10' },
  cancelada: { label: 'Cancelada', color: 'text-red-400 bg-red-400/10' },
  remarcada: { label: 'Remarcada', color: 'text-purple-400 bg-purple-400/10' },
}

export default function PainelTerapeuta() {
  const params = useParams()
  const id = params.id as string

  const [terapeuta, setTerapeuta] = useState<Terapeuta | null>(null)
  const [sessoes, setSessoes] = useState<Sessao[]>([])
  const [loading, setLoading] = useState(true)
  const [adminEmail, setAdminEmail] = useState('rafael@spr.com')

  // Modal confirmar entrega
  const [confirmarSessaoId, setConfirmarSessaoId] = useState<string | null>(null)
  const [confirmarErro, setConfirmarErro] = useState('')
  const [confirmarLoading, setConfirmarLoading] = useState(false)

  // Modal remarcar
  const [remarcarSessaoId, setRemarcarSessaoId] = useState<string | null>(null)
  const [remarcarData, setRemarcarData] = useState('')
  const [remarcarMotivo, setRemarcarMotivo] = useState('')
  const [remarcarSenhaModal, setRemarcarSenhaModal] = useState(false)
  const [remarcarErro, setRemarcarErro] = useState('')
  const [remarcarLoading, setRemarcarLoading] = useState(false)

  async function loadData() {
    const client = getSupabaseClient()
    if (!client) return
    setLoading(true)
    const [tResp, sResp] = await Promise.all([
      client.from('terapeutas').select('id,nome,email,percentual_comissao').eq('id', id).single(),
      client.from('sessoes').select('id,sale_id,numero_sessao,total_sessoes,status,data_agendada,data_entrega,link_meet,comissao_valor,comissao_paga,paciente_nome,paciente_email,entregue_confirmado_por')
        .eq('terapeuta_id', id).order('sale_id').order('numero_sessao', { ascending: true }),
    ])
    if (tResp.data) setTerapeuta(tResp.data as unknown as Terapeuta)
    setSessoes((sResp.data ?? []) as Sessao[])
    setLoading(false)
  }

  useEffect(() => { if (id) loadData() }, [id])

  const entregues = sessoes.filter(s => s.status === 'entregue')
  const pendentes = sessoes.filter(s => s.status === 'pendente' || s.status === 'agendada')
  const receitaGerada = entregues.filter(s => !s.comissao_paga).reduce((a, s) => a + s.comissao_valor, 0)
  const receitaFutura = pendentes.reduce((a, s) => a + s.comissao_valor, 0)

  async function handleConfirmar(senha: string) {
    if (!confirmarSessaoId) return
    setConfirmarLoading(true)
    setConfirmarErro('')
    const res = await fetch('/api/terapeutas/sessoes/confirmar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessao_id: confirmarSessaoId, usuario_email: adminEmail, senha }),
    })
    const json = await res.json()
    setConfirmarLoading(false)
    if (!res.ok) { setConfirmarErro(json.error ?? 'Erro'); return }
    setConfirmarSessaoId(null)
    loadData()
  }

  async function handleRemarcar(senha: string) {
    if (!remarcarSessaoId || !remarcarData) return
    setRemarcarLoading(true)
    setRemarcarErro('')
    const res = await fetch('/api/terapeutas/sessoes/remarcar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessao_id: remarcarSessaoId, nova_data: remarcarData, motivo: remarcarMotivo, usuario_email: adminEmail, senha }),
    })
    const json = await res.json()
    setRemarcarLoading(false)
    if (!res.ok) { setRemarcarErro(json.error ?? 'Erro'); return }
    setRemarcarSenhaModal(false)
    setRemarcarSessaoId(null)
    loadData()
  }

  // Agrupar sessões por sale_id para mostrar "faltam X"
  const saleIds = [...new Set(sessoes.map(s => s.sale_id))]

  return (
    <div className="min-h-screen bg-gray-950 pb-24 md:pb-8">
      <Header />
      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="mb-6">
          <Link href="/terapeutas/lista" className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 mb-4 transition-colors">
            <ArrowLeft className="w-3 h-3" /> Voltar para lista
          </Link>
          {terapeuta && (
            <div>
              <h1 className="text-xl font-semibold text-white">{terapeuta.nome}</h1>
              <p className="text-sm text-gray-400 mt-0.5">{terapeuta.email} · Comissão {terapeuta.percentual_comissao}%</p>
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {[
                {
                  label: 'Sessões entregues',
                  sub: 'Confirmadas',
                  value: entregues.length,
                  color: 'text-green-500',
                },
                {
                  label: 'Sessões futuras',
                  sub: 'Agendadas e pendentes',
                  value: pendentes.length,
                  color: 'text-yellow-400',
                },
                {
                  label: 'Receita gerada',
                  sub: 'Sessões entregues — aguardando pagamento',
                  value: fmtBRL(receitaGerada),
                  color: 'text-green-500',
                },
                {
                  label: 'Receita futura',
                  sub: 'Baseado nas sessões agendadas e pendentes',
                  value: fmtBRL(receitaFutura),
                  color: 'text-gray-400',
                },
              ].map(({ label, sub, value, color }) => (
                <div key={label} className="bg-gray-900 border border-white/10 rounded-xl p-4">
                  <p className="text-xs text-gray-400 mb-1">{label}</p>
                  <p className={`text-lg font-bold ${color}`}>{value}</p>
                  <p className="text-[10px] text-gray-600 mt-0.5 leading-tight">{sub}</p>
                </div>
              ))}
            </div>

            {/* Email do usuário */}
            <div className="mb-4 flex items-center gap-3">
              <label className="text-xs text-gray-500 whitespace-nowrap">Seu e-mail (para autenticação):</label>
              <input type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)}
                className="bg-gray-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500/50 w-56" />
            </div>

            {/* Tabela de sessões */}
            <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10">
                <h2 className="text-sm font-semibold text-white">Sessões ({sessoes.length})</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5">
                      {['#', 'Paciente', 'Data agendada', 'Status', 'Comissão', 'Faltam', 'Ações'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {saleIds.map(saleId => {
                      const grupo = sessoes.filter(s => s.sale_id === saleId)
                      return grupo.map((s, idx) => {
                        const st = STATUS_LABEL[s.status] ?? { label: s.status, color: 'text-gray-400' }
                        const faltam = s.total_sessoes - s.numero_sessao
                        const isUltima = s.numero_sessao === s.total_sessoes
                        return (
                          <tr key={s.id} className={`border-b border-white/5 hover:bg-white/2 transition-colors ${idx === 0 && grupo.length > 1 ? 'border-t border-indigo-500/20' : ''}`}>
                            <td className="px-4 py-3 text-gray-500">{s.numero_sessao}</td>
                            <td className="px-4 py-3">
                              {idx === 0 && (
                                <>
                                  <p className="text-white font-medium">{s.paciente_nome}</p>
                                  <p className="text-xs text-gray-500">{s.paciente_email}</p>
                                </>
                              )}
                            </td>
                            <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{fmtDt(s.data_agendada)}</td>
                            <td className="px-4 py-3">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
                            </td>
                            <td className="px-4 py-3 text-green-500 whitespace-nowrap">{fmtBRL(s.comissao_valor)}</td>
                            <td className="px-4 py-3">
                              {isUltima ? (
                                <span className="text-[10px] text-red-400 border border-red-400/30 px-1.5 py-0.5 rounded">Última sessão</span>
                              ) : (
                                <span className="text-xs text-gray-500">Faltam {faltam}</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                {s.status === 'agendada' && (
                                  <button
                                    onClick={() => setConfirmarSessaoId(s.id)}
                                    className="flex items-center gap-1 text-xs text-green-500 hover:text-green-400 transition-colors"
                                  >
                                    <CheckCircle className="w-3 h-3" /> Confirmar
                                  </button>
                                )}
                                {(s.status === 'agendada' || s.status === 'pendente') && (
                                  <button
                                    onClick={() => {
                                      setRemarcarSessaoId(s.id)
                                      setRemarcarData(s.data_agendada?.slice(0, 16) ?? '')
                                      setRemarcarMotivo('')
                                    }}
                                    className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors"
                                  >
                                    <RefreshCw className="w-3 h-3" /> Remarcar
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })
                    })}
                    {sessoes.length === 0 && (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-600 text-xs">Nenhuma sessão cadastrada</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </>
        )}
      </main>

      {/* Modal confirmar entrega */}
      <SenhaModal
        isOpen={!!confirmarSessaoId}
        onClose={() => { setConfirmarSessaoId(null); setConfirmarErro('') }}
        onConfirm={handleConfirmar}
        titulo="Confirmar entrega de sessão"
        descricao="Digite sua senha para confirmar que a sessão foi realizada"
        loading={confirmarLoading}
        erro={confirmarErro}
      />

      {/* Modal remarcar — data primeiro */}
      {remarcarSessaoId && !remarcarSenhaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-sm font-semibold text-white mb-4">Remarcar sessão</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Nova data e hora</label>
                <input type="datetime-local" value={remarcarData} onChange={e => setRemarcarData(e.target.value)}
                  className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Motivo (opcional)</label>
                <input type="text" value={remarcarMotivo} onChange={e => setRemarcarMotivo(e.target.value)}
                  placeholder="Ex: Paciente solicitou"
                  className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setRemarcarSessaoId(null)} className="flex-1 px-4 py-2 text-sm text-gray-400 bg-gray-800 border border-white/10 rounded-lg">Cancelar</button>
              <button onClick={() => { if (!remarcarData) return; setRemarcarSenhaModal(true) }}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors">
                Próximo
              </button>
            </div>
          </div>
        </div>
      )}

      <SenhaModal
        isOpen={remarcarSenhaModal}
        onClose={() => { setRemarcarSenhaModal(false); setRemarcarErro('') }}
        onConfirm={handleRemarcar}
        titulo="Confirmar remarcação"
        descricao="Digite sua senha para remarcar a sessão"
        loading={remarcarLoading}
        erro={remarcarErro}
      />

      <MobileNav />
    </div>
  )
}
