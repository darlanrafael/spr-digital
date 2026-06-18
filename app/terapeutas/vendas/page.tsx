'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Calendar, RefreshCw, AlertCircle } from 'lucide-react'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import SenhaModal from '@/components/SenhaModal'
import { getSupabaseClient } from '@/lib/supabase'

type Sale = {
  id: string
  nome: string
  email: string
  produto: string
  valor_pago_cliente: number
  valor_liquido: number
  data_hora: string
}

type Sessao = {
  id: string
  sale_id: string
  terapeuta_id: string
  numero_sessao: number
  total_sessoes: number
  status: string
  data_agendada: string | null
  link_meet: string | null
  comissao_valor: number
  comissao_paga: boolean
  paciente_nome: string
  paciente_email: string
  terapeutas: { nome: string } | null
}

type Terapeuta = { id: string; nome: string }

type AgendarForm = {
  sale_id: string
  terapeuta_id: string
  data_primeira_sessao: string
  link_meet: string
}

type RemarcarForm = { sessao_id: string; nova_data: string; motivo: string }

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

export default function TerapeutasVendas() {
  const [sales, setSales] = useState<Sale[]>([])
  const [sessoes, setSessoes] = useState<Sessao[]>([])
  const [terapeutas, setTerapeutas] = useState<Terapeuta[]>([])
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [adminEmail, setAdminEmail] = useState('rafael@spr.com')

  // Modal agendar
  const [agendarModal, setAgendarModal] = useState(false)
  const [agendarForm, setAgendarForm] = useState<AgendarForm>({ sale_id: '', terapeuta_id: '', data_primeira_sessao: '', link_meet: '' })
  const [agendarSenhaModal, setAgendarSenhaModal] = useState(false)
  const [agendarErro, setAgendarErro] = useState('')
  const [agendarLoading, setAgendarLoading] = useState(false)

  // Modal remarcar
  const [remarcarModal, setRemarcarModal] = useState(false)
  const [remarcarForm, setRemarcarForm] = useState<RemarcarForm>({ sessao_id: '', nova_data: '', motivo: '' })
  const [remarcarSenhaModal, setRemarcarSenhaModal] = useState(false)
  const [remarcarErro, setRemarcarErro] = useState('')
  const [remarcarLoading, setRemarcarLoading] = useState(false)

  async function loadData() {
    const client = getSupabaseClient()
    if (!client) return
    setLoading(true)
    const [saleResp, sessResp, tResp] = await Promise.all([
      client.from('sales').select('id,nome,email,produto,valor_pago_cliente,valor_liquido,data_hora')
        .ilike('produto', '%Pedro | Denise%').order('data_hora', { ascending: false }),
      client.from('sessoes').select('id,sale_id,terapeuta_id,numero_sessao,total_sessoes,status,data_agendada,link_meet,comissao_valor,comissao_paga,paciente_nome,paciente_email,terapeutas(nome)'),
      client.from('terapeutas').select('id,nome').eq('ativo', true).order('nome'),
    ])
    setSales((saleResp.data ?? []) as Sale[])
    setSessoes((sessResp.data ?? []) as unknown as Sessao[])
    setTerapeutas((tResp.data ?? []) as Terapeuta[])
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  function toggleExpand(id: string) {
    setExpandidas(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function statusGeral(sale_id: string): { label: string; color: string } {
    const ss = sessoes.filter(s => s.sale_id === sale_id)
    if (ss.length === 0) return { label: 'Sem sessões', color: 'text-gray-500 bg-gray-500/10' }
    if (ss.every(s => s.status === 'entregue')) return { label: 'Concluída', color: 'text-green-500 bg-green-500/10' }
    if (ss.every(s => s.status === 'cancelada')) return { label: 'Cancelada', color: 'text-red-400 bg-red-400/10' }
    if (ss.some(s => s.status === 'entregue')) return { label: 'Em andamento', color: 'text-blue-400 bg-blue-400/10' }
    return { label: 'Pendente', color: 'text-amber-400 bg-amber-400/10' }
  }

  async function handleAgendar(senha: string) {
    setAgendarLoading(true)
    setAgendarErro('')
    const res = await fetch('/api/terapeutas/sessoes/agendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...agendarForm, usuario_email: adminEmail, senha }),
    })
    const json = await res.json()
    setAgendarLoading(false)
    if (!res.ok) { setAgendarErro(json.error ?? 'Erro ao agendar'); return }
    setAgendarSenhaModal(false)
    setAgendarModal(false)
    setAgendarForm({ sale_id: '', terapeuta_id: '', data_primeira_sessao: '', link_meet: '' })
    loadData()
  }

  async function handleRemarcar(senha: string) {
    setRemarcarLoading(true)
    setRemarcarErro('')
    const res = await fetch('/api/terapeutas/sessoes/remarcar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...remarcarForm, usuario_email: adminEmail, senha }),
    })
    const json = await res.json()
    setRemarcarLoading(false)
    if (!res.ok) { setRemarcarErro(json.error ?? 'Erro ao remarcar'); return }
    setRemarcarSenhaModal(false)
    setRemarcarModal(false)
    loadData()
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-24 md:pb-8">
      <Header />
      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-white">Vendas · Terapeutas</h1>
            <p className="text-sm text-gray-400 mt-1">{sales.length} vendas — Mentoria Particular</p>
          </div>
          <button onClick={loadData} className="p-2 text-gray-500 hover:text-white transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  {['Data', 'Paciente', 'Formato', 'Bruto', 'Líquido', 'Sessões', 'Status', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sales.map(sale => {
                  const ss = sessoes.filter(s => s.sale_id === sale.id).sort((a, b) => a.numero_sessao - b.numero_sessao)
                  const total = ss[0]?.total_sessoes ?? 0
                  const entregues = ss.filter(s => s.status === 'entregue').length
                  const st = statusGeral(sale.id)
                  const expanded = expandidas.has(sale.id)
                  return (
                    <>
                      <tr key={sale.id} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                        <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{fmtDt(sale.data_hora)}</td>
                        <td className="px-4 py-3">
                          <p className="text-white font-medium">{sale.nome}</p>
                          <p className="text-xs text-gray-500">{sale.email}</p>
                        </td>
                        <td className="px-4 py-3 text-gray-300 text-xs max-w-[160px] truncate">{sale.produto}</td>
                        <td className="px-4 py-3 text-white whitespace-nowrap">{fmtBRL(sale.valor_pago_cliente)}</td>
                        <td className="px-4 py-3 text-gray-300 whitespace-nowrap">{fmtBRL(sale.valor_liquido)}</td>
                        <td className="px-4 py-3">
                          {ss.length > 0
                            ? <span className="text-white">{entregues}/{total}</span>
                            : <span className="text-gray-600 text-xs">—</span>
                          }
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                setAgendarForm({ sale_id: sale.id, terapeuta_id: terapeutas[0]?.id ?? '', data_primeira_sessao: '', link_meet: '' })
                                setAgendarModal(true)
                              }}
                              className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors whitespace-nowrap"
                            >
                              <Calendar className="w-3 h-3" /> Agendar
                            </button>
                            <button onClick={() => toggleExpand(sale.id)} className="text-gray-500 hover:text-white transition-colors">
                              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr key={`${sale.id}-expand`} className="border-b border-white/5 bg-gray-800/40">
                          <td colSpan={8} className="px-6 py-4">
                            {ss.length === 0 ? (
                              <p className="text-gray-500 text-xs">Nenhuma sessão agendada ainda.</p>
                            ) : (
                              <div className="space-y-2">
                                {ss.map(s => {
                                  const st2 = STATUS_LABEL[s.status] ?? { label: s.status, color: 'text-gray-400' }
                                  const isUltima = s.numero_sessao === s.total_sessoes
                                  return (
                                    <div key={s.id} className="flex items-center gap-4 text-xs text-gray-400">
                                      <span className="text-gray-600 w-8">#{s.numero_sessao}</span>
                                      <span className={`px-2 py-0.5 rounded-full ${st2.color}`}>{st2.label}</span>
                                      <span>{fmtDt(s.data_agendada)}</span>
                                      <span className="text-gray-500">{(s.terapeutas as { nome: string } | null)?.nome ?? '—'}</span>
                                      <span className="text-green-500">{fmtBRL(s.comissao_valor)}</span>
                                      {s.link_meet && <a href={s.link_meet} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">Meet</a>}
                                      {isUltima && <span className="text-red-400 border border-red-400/30 px-1.5 py-0.5 rounded text-[10px]">Última sessão</span>}
                                      {(s.status === 'agendada' || s.status === 'pendente') && (
                                        <button
                                          onClick={() => {
                                            setRemarcarForm({ sessao_id: s.id, nova_data: s.data_agendada?.slice(0, 16) ?? '', motivo: '' })
                                            setRemarcarModal(true)
                                          }}
                                          className="flex items-center gap-1 text-purple-400 hover:text-purple-300"
                                        >
                                          <RefreshCw className="w-3 h-3" /> Remarcar
                                        </button>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* Modal Agendar */}
      {agendarModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-sm font-semibold text-white mb-4">Agendar sessões</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Terapeuta</label>
                <select value={agendarForm.terapeuta_id} onChange={e => setAgendarForm(f => ({ ...f, terapeuta_id: e.target.value }))}
                  className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50">
                  {terapeutas.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Data e hora da 1ª sessão</label>
                <input type="datetime-local" value={agendarForm.data_primeira_sessao}
                  onChange={e => setAgendarForm(f => ({ ...f, data_primeira_sessao: e.target.value }))}
                  className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Link Meet (opcional)</label>
                <input type="text" value={agendarForm.link_meet} placeholder="https://meet.google.com/..."
                  onChange={e => setAgendarForm(f => ({ ...f, link_meet: e.target.value }))}
                  className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Seu e-mail (quem está agendando)</label>
                <input type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)}
                  className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setAgendarModal(false)} className="flex-1 px-4 py-2 text-sm text-gray-400 bg-gray-800 border border-white/10 rounded-lg">Cancelar</button>
              <button onClick={() => { if (!agendarForm.data_primeira_sessao || !agendarForm.terapeuta_id) return; setAgendarSenhaModal(true) }}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors">
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      <SenhaModal
        isOpen={agendarSenhaModal}
        onClose={() => { setAgendarSenhaModal(false); setAgendarErro('') }}
        onConfirm={handleAgendar}
        titulo="Confirmar agendamento"
        descricao="Digite sua senha para registrar o agendamento"
        loading={agendarLoading}
        erro={agendarErro}
      />

      {/* Modal Remarcar */}
      {remarcarModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-sm font-semibold text-white mb-4">Remarcar sessão</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Nova data e hora</label>
                <input type="datetime-local" value={remarcarForm.nova_data}
                  onChange={e => setRemarcarForm(f => ({ ...f, nova_data: e.target.value }))}
                  className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Motivo (opcional)</label>
                <input type="text" value={remarcarForm.motivo} placeholder="Ex: Paciente solicitou"
                  onChange={e => setRemarcarForm(f => ({ ...f, motivo: e.target.value }))}
                  className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Seu e-mail</label>
                <input type="email" value={adminEmail} onChange={e => setAdminEmail(e.target.value)}
                  className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setRemarcarModal(false)} className="flex-1 px-4 py-2 text-sm text-gray-400 bg-gray-800 border border-white/10 rounded-lg">Cancelar</button>
              <button onClick={() => { if (!remarcarForm.nova_data) return; setRemarcarSenhaModal(true) }}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors">
                Confirmar
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
