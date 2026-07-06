'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { CheckCircle, RefreshCw, ArrowLeft, X } from 'lucide-react'
import Link from 'next/link'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import SenhaModal from '@/components/SenhaModal'
import { getSupabaseClient } from '@/lib/supabase'
import { getSession } from '@/lib/auth'

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
  status_consulta: string | null
  data_agendada: string | null
  data_entrega: string | null
  link_meet: string | null
  comissao_valor: number
  comissao_paga: boolean
  paciente_nome: string
  paciente_email: string
  entregue_confirmado_por: string | null
  iniciado_em: string | null
  concluido_em: string | null
}

type SaleInfo = {
  id: string
  nome: string
  email: string
  telefone: string | null
  produto: string
  plataforma: string | null
  valor_pago_cliente: number
  valor_liquido: number
  data_hora: string
  status: string | null
}

type Ocorrencia = {
  id: string
  sale_id: string
  tipo: string
  titulo: string
  descricao: string
  criado_por_nome: string
  criado_por_tipo: string
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

type PacienteAgrupado = {
  email: string
  nome: string
  saleIds: string[]
  sessoes: Sessao[]
  entregues: number
  total: number
  ativo: boolean
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

type TerapeutaSession = {
  id: string
  nome: string
  email: string
  tipo: string
  terapeuta_id: string | null
}

export default function PainelTerapeuta() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [terapeuta, setTerapeuta] = useState<Terapeuta | null>(null)
  const [sessoes, setSessoes] = useState<Sessao[]>([])
  const [vendas, setVendas] = useState<Record<string, SaleInfo>>({})
  const [ocorrencias, setOcorrencias] = useState<Record<string, Ocorrencia[]>>({})
  const [remarcacoes, setRemarcacoes] = useState<Record<string, Remarcacao[]>>({})
  const [loading, setLoading] = useState(true)
  const [adminEmail, setAdminEmail] = useState('')
  const [isTerapeutaSession, setIsTerapeutaSession] = useState(false)
  const [sessionNome, setSessionNome] = useState('')

  // Modal status_consulta (iniciar / concluir / anular) — visão admin
  const [statusSessaoId, setStatusSessaoId] = useState<string | null>(null)
  const [statusAcao, setStatusAcao] = useState<'iniciar' | 'concluir' | 'anular'>('iniciar')
  const [statusErro, setStatusErro] = useState('')
  const [statusLoading, setStatusLoading] = useState(false)
  const [anularMotivo, setAnularMotivo] = useState('')

  // Modal remarcar — visão admin
  const [remarcarSessaoId, setRemarcarSessaoId] = useState<string | null>(null)
  const [remarcarData, setRemarcarData] = useState('')
  const [remarcarMotivo, setRemarcarMotivo] = useState('')
  const [remarcarSenhaModal, setRemarcarSenhaModal] = useState(false)
  const [remarcarErro, setRemarcarErro] = useState('')
  const [remarcarLoading, setRemarcarLoading] = useState(false)

  // Visão terapeuta — pacientes e prontuário
  const [pacienteTab, setPacienteTab] = useState<'ativos' | 'concluidos'>('ativos')
  const [prontuarioEmail, setProntuarioEmail] = useState<string | null>(null)
  const [notaFormOpen, setNotaFormOpen] = useState(false)
  const [notaTitulo, setNotaTitulo] = useState('')
  const [notaDesc, setNotaDesc] = useState('')
  const [notaErro, setNotaErro] = useState('')
  const [notaLoading, setNotaLoading] = useState(false)
  const [notaSenhaOpen, setNotaSenhaOpen] = useState(false)

  async function loadData(isTerapeuta: boolean) {
    const client = getSupabaseClient()
    if (!client) return
    setLoading(true)
    const [tResp, sResp] = await Promise.all([
      client.from('terapeutas').select('id,nome,email,percentual_comissao').eq('id', id).single(),
      client.from('sessoes').select('id,sale_id,numero_sessao,total_sessoes,status,status_consulta,data_agendada,data_entrega,link_meet,comissao_valor,comissao_paga,paciente_nome,paciente_email,entregue_confirmado_por,iniciado_em,concluido_em')
        .eq('terapeuta_id', id).order('sale_id').order('numero_sessao', { ascending: true }),
    ])
    if (tResp.data) setTerapeuta(tResp.data as unknown as Terapeuta)
    const sessoesData = (sResp.data ?? []) as Sessao[]
    setSessoes(sessoesData)

    if (isTerapeuta) {
      const saleIds = [...new Set(sessoesData.map(s => s.sale_id))]
      const sessaoIds = sessoesData.map(s => s.id)
      if (saleIds.length > 0) {
        const [vendasResp, ocResp, remResp] = await Promise.all([
          client.from('sales').select('id,nome,email,telefone,produto,plataforma,valor_pago_cliente,valor_liquido,data_hora,status').in('id', saleIds),
          client.from('ocorrencias_prontuario').select('id,sale_id,tipo,titulo,descricao,criado_por_nome,criado_por_tipo,created_at').in('sale_id', saleIds).order('created_at', { ascending: false }),
          sessaoIds.length > 0
            ? client.from('remarcacoes_historico').select('*').in('sessao_id', sessaoIds).order('created_at', { ascending: true })
            : Promise.resolve({ data: [] as Remarcacao[] }),
        ])
        const vendasMap: Record<string, SaleInfo> = {}
        for (const v of (vendasResp.data ?? []) as SaleInfo[]) vendasMap[v.id] = v
        setVendas(vendasMap)

        const ocMap: Record<string, Ocorrencia[]> = {}
        for (const o of (ocResp.data ?? []) as Ocorrencia[]) {
          if (!ocMap[o.sale_id]) ocMap[o.sale_id] = []
          ocMap[o.sale_id].push(o)
        }
        setOcorrencias(ocMap)

        const remMap: Record<string, Remarcacao[]> = {}
        for (const r of (remResp.data ?? []) as Remarcacao[]) {
          if (!remMap[r.sessao_id]) remMap[r.sessao_id] = []
          remMap[r.sessao_id].push(r)
        }
        setRemarcacoes(remMap)
      }
    }
    setLoading(false)
  }

  useEffect(() => {
    // Admin session takes absolute priority over terapeutas_session
    const adminSession = getSession()
    if (adminSession) {
      setAdminEmail(adminSession.email)
      setSessionNome(adminSession.name)
      // isTerapeutaSession stays false — admin sees full view
      if (id) loadData(false)
      return
    }

    const raw = localStorage.getItem('terapeutas_session')
    if (raw) {
      try {
        const session = JSON.parse(raw) as TerapeutaSession
        setAdminEmail(session.email)
        setSessionNome(session.nome)
        if (session.tipo === 'terapeuta') {
          setIsTerapeutaSession(true)
          if (session.terapeuta_id && session.terapeuta_id !== id) {
            router.replace(`/terapeutas/${session.terapeuta_id}`)
            return
          }
          if (id) loadData(true)
          return
        }
      } catch { /* ignore */ }
    }
    if (id) loadData(false)
  }, [id])

  // Reset formulário de nota quando o prontuário abre/fecha
  useEffect(() => {
    setNotaFormOpen(false)
    setNotaTitulo(''); setNotaDesc(''); setNotaErro('')
  }, [prontuarioEmail])

  const entregues = sessoes.filter(s => s.status === 'entregue')
  const pendentes = sessoes.filter(s => s.status === 'pendente' || s.status === 'agendada')
  const receitaGerada = entregues.filter(s => !s.comissao_paga).reduce((a, s) => a + s.comissao_valor, 0)
  const receitaFutura = pendentes.filter(s => !s.comissao_paga).reduce((a, s) => a + s.comissao_valor, 0)

  // ── Agrupamento por paciente (visão terapeuta) ──
  const pacientes = useMemo(() => {
    const map: Record<string, PacienteAgrupado> = {}
    for (const s of sessoes) {
      const key = s.paciente_email
      if (!map[key]) {
        map[key] = { email: key, nome: s.paciente_nome, saleIds: [], sessoes: [], entregues: 0, total: 0, ativo: false }
      }
      const p = map[key]
      if (!p.saleIds.includes(s.sale_id)) p.saleIds.push(s.sale_id)
      p.sessoes.push(s)
      p.total++
      if (s.status === 'entregue') p.entregues++
      if (s.status === 'pendente' || s.status === 'agendada') p.ativo = true
    }
    return Object.values(map).sort((a, b) => a.nome.localeCompare(b.nome))
  }, [sessoes])

  const pacientesAtivos = pacientes.filter(p => p.ativo)
  const pacientesConcluidos = pacientes.filter(p => !p.ativo)
  const pacientesListaAtual = pacienteTab === 'ativos' ? pacientesAtivos : pacientesConcluidos

  const prontuarioPaciente = prontuarioEmail ? pacientes.find(p => p.email === prontuarioEmail) ?? null : null
  const prontuarioSessoesOrdenadas = useMemo(() => {
    if (!prontuarioPaciente) return []
    return [...prontuarioPaciente.sessoes].sort((a, b) => {
      const dA = vendas[a.sale_id]?.data_hora ?? ''
      const dB = vendas[b.sale_id]?.data_hora ?? ''
      if (dA !== dB) return dA.localeCompare(dB)
      return a.numero_sessao - b.numero_sessao
    })
  }, [prontuarioPaciente, vendas])
  const prontuarioSaleMaisRecente = useMemo(() => {
    if (!prontuarioPaciente) return null
    const vendasDoPaciente = prontuarioPaciente.saleIds.map(sid => vendas[sid]).filter((v): v is SaleInfo => !!v)
    if (vendasDoPaciente.length === 0) return null
    return [...vendasDoPaciente].sort((a, b) => b.data_hora.localeCompare(a.data_hora))[0]
  }, [prontuarioPaciente, vendas])
  const prontuarioOcorrencias = useMemo(() => {
    if (!prontuarioPaciente) return []
    return prontuarioPaciente.saleIds
      .flatMap(sid => ocorrencias[sid] ?? [])
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [prontuarioPaciente, ocorrencias])

  async function handleStatusAcao(senha: string) {
    if (!statusSessaoId) return
    setStatusLoading(true)
    setStatusErro('')
    if (statusAcao === 'anular' && anularMotivo.trim().length < 10) {
      setStatusErro('Informe o motivo (mínimo 10 caracteres)'); setStatusLoading(false); return
    }
    const res = await fetch('/api/terapeutas/sessoes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessao_id: statusSessaoId,
        acao: statusAcao,
        motivo: statusAcao === 'anular' ? anularMotivo : undefined,
        usuario_nome: sessionNome || adminEmail.split('@')[0],
        usuario_tipo: isTerapeutaSession ? 'terapeuta' : 'admin',
        usuario_email: adminEmail,
        senha,
      }),
    })
    const json = await res.json()
    setStatusLoading(false)
    if (!res.ok) { setStatusErro(json.error ?? 'Erro'); return }
    setStatusSessaoId(null); setAnularMotivo('')
    loadData(isTerapeutaSession)
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
    loadData(isTerapeutaSession)
  }

  async function handleNota(senha: string) {
    if (!prontuarioSaleMaisRecente) return
    setNotaLoading(true)
    setNotaErro('')
    const res = await fetch('/api/terapeutas/vendas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sale_id: prontuarioSaleMaisRecente.id,
        tipo: 'nota',
        titulo: notaTitulo,
        descricao: notaDesc,
        senha,
        usuario_nome: sessionNome || adminEmail.split('@')[0],
        usuario_tipo: 'terapeuta',
        usuario_email: adminEmail,
      }),
    })
    const json = await res.json()
    setNotaLoading(false)
    if (!res.ok) { setNotaErro(json.error ?? 'Erro'); return }
    setNotaSenhaOpen(false); setNotaFormOpen(false)
    setNotaTitulo(''); setNotaDesc('')
    loadData(true)
  }

  const notaValida = notaTitulo.trim().length > 0 && notaDesc.trim().length >= 10

  // Agrupar sessões por sale_id para mostrar "faltam X" — visão admin
  const saleIds = [...new Set(sessoes.map(s => s.sale_id))]

  return (
    <div className="min-h-screen bg-gray-950 pb-24 md:pb-8">
      <Header />
      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="mb-6">
          {!isTerapeutaSession && (
            <Link href="/terapeutas/lista" className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 mb-4 transition-colors">
              <ArrowLeft className="w-3 h-3" /> Voltar para lista
            </Link>
          )}
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
        ) : isTerapeutaSession ? (
          <>
            {/* Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
              {[
                { label: 'Sessões vendidas', sub: 'Total', value: sessoes.length, color: 'text-white' },
                { label: 'Sessões entregues', sub: 'Confirmadas', value: entregues.length, color: 'text-green-500' },
                { label: 'Sessões futuras', sub: 'Agendadas e pendentes', value: pendentes.length, color: 'text-yellow-400' },
                { label: 'Comissão gerada', sub: 'Sessões entregues — aguardando pagamento', value: fmtBRL(receitaGerada), color: 'text-green-500' },
                { label: 'Comissão futura', sub: 'Sessões agendadas e pendentes não pagas', value: fmtBRL(receitaFutura), color: 'text-gray-400' },
              ].map(({ label, sub, value, color }) => (
                <div key={label} className="bg-gray-900 border border-white/10 rounded-xl p-4">
                  <p className="text-xs text-gray-400 mb-1">{label}</p>
                  <p className={`text-lg font-bold ${color}`}>{value}</p>
                  <p className="text-[10px] text-gray-600 mt-0.5 leading-tight">{sub}</p>
                </div>
              ))}
            </div>

            <div className="mb-4 flex items-center gap-2">
              <span className="text-xs text-gray-500">Autenticando como:</span>
              <span className="text-xs text-gray-300 font-medium">{adminEmail}</span>
            </div>

            {/* Abas de pacientes */}
            <div className="flex items-center gap-1 bg-gray-900 border border-white/10 rounded-xl p-1 mb-4 w-fit">
              {([
                { key: 'ativos', label: `Pacientes ativos (${pacientesAtivos.length})` },
                { key: 'concluidos', label: `Concluídos (${pacientesConcluidos.length})` },
              ] as const).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setPacienteTab(tab.key)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    pacienteTab === tab.key ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden">
              <div className="divide-y divide-white/5">
                {pacientesListaAtual.length === 0 ? (
                  <p className="px-4 py-8 text-center text-gray-600 text-xs">Nenhum paciente aqui ainda.</p>
                ) : pacientesListaAtual.map(p => (
                  <div key={p.email} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm text-white font-medium">{p.nome}</p>
                      <p className="text-xs text-gray-500">{p.email}</p>
                      <p className="text-[10px] text-gray-600 mt-0.5">{p.entregues} de {p.total} sessões entregues</p>
                    </div>
                    <button onClick={() => setProntuarioEmail(p.email)}
                      className="text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors whitespace-nowrap">
                      Ver prontuário
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>
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
                  label: 'Comissão gerada',
                  sub: 'Sessões entregues — aguardando pagamento',
                  value: fmtBRL(receitaGerada),
                  color: 'text-green-500',
                },
                {
                  label: 'Comissão futura',
                  sub: 'Sessões agendadas e pendentes não pagas',
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
                              <div className="flex items-center gap-2 flex-wrap">
                                {(s.status === 'agendada' || s.status === 'pendente') && (s.status_consulta ?? 'aguardando') === 'aguardando' && (
                                  <button onClick={() => { setStatusSessaoId(s.id); setStatusAcao('iniciar'); setStatusErro('') }}
                                    className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors whitespace-nowrap">
                                    ▶ Iniciar
                                  </button>
                                )}
                                {s.status_consulta === 'em_atendimento' && (
                                  <button onClick={() => { setStatusSessaoId(s.id); setStatusAcao('concluir'); setStatusErro('') }}
                                    className="flex items-center gap-1 text-xs text-green-500 hover:text-green-400 transition-colors whitespace-nowrap">
                                    <CheckCircle className="w-3 h-3" /> Concluir
                                  </button>
                                )}
                                {s.status === 'entregue' && (
                                  <button onClick={() => { setStatusSessaoId(s.id); setStatusAcao('anular'); setAnularMotivo(''); setStatusErro('') }}
                                    className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors whitespace-nowrap">
                                    Anular
                                  </button>
                                )}
                                {(s.status === 'agendada' || s.status === 'pendente') && (
                                  <button onClick={() => { setRemarcarSessaoId(s.id); setRemarcarData(s.data_agendada?.slice(0, 16) ?? ''); setRemarcarMotivo('') }}
                                    className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors whitespace-nowrap">
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

      {/* Modal anular — precisa de motivo antes da senha (visão admin) */}
      {statusSessaoId && statusAcao === 'anular' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-sm font-semibold text-white mb-1">Anular sessão concluída</h3>
            <p className="text-xs text-gray-400 mb-4">Informe o motivo da anulação. A sessão voltará ao status &quot;Agendada&quot;.</p>
            <textarea value={anularMotivo} onChange={e => setAnularMotivo(e.target.value)} rows={3}
              placeholder="Motivo da anulação (mínimo 10 caracteres)..."
              className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500/50 resize-none mb-3" />
            {statusErro && <p className="text-xs text-red-400 mb-3">{statusErro}</p>}
            <div className="flex gap-2">
              <button onClick={() => { setStatusSessaoId(null); setAnularMotivo('') }}
                className="flex-1 px-3 py-2 text-sm text-gray-400 bg-gray-800 border border-white/10 rounded-lg">Cancelar</button>
              <button onClick={() => {
                if (anularMotivo.trim().length < 10) { setStatusErro('Mínimo 10 caracteres'); return }
                setStatusErro('')
              }}
                className="flex-1 px-3 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors">
                Próximo →
              </button>
            </div>
          </div>
        </div>
      )}

      <SenhaModal
        isOpen={!!statusSessaoId && (statusAcao !== 'anular' || anularMotivo.trim().length >= 10)}
        onClose={() => { setStatusSessaoId(null); setStatusErro(''); setAnularMotivo('') }}
        onConfirm={handleStatusAcao}
        titulo={statusAcao === 'iniciar' ? 'Iniciar consulta' : statusAcao === 'concluir' ? 'Concluir consulta' : 'Anular sessão'}
        descricao="Digite sua senha para confirmar"
        loading={statusLoading}
        erro={statusErro}
      />

      {/* Modal remarcar — data primeiro (visão admin) */}
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

      {/* Modal: PRONTUÁRIO (visão terapeuta) — sem ações de agenda */}
      {prontuarioPaciente && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-white/10 rounded-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">

            <div className="sticky top-0 bg-gray-900 border-b border-white/10 px-6 py-4 flex items-start justify-between z-10">
              <div>
                <h3 className="text-sm font-semibold text-white">Prontuário — {prontuarioPaciente.nome}</h3>
                <p className="text-xs text-gray-400 mt-0.5">{prontuarioPaciente.email}</p>
              </div>
              <button onClick={() => setProntuarioEmail(null)} className="text-gray-500 hover:text-white mt-0.5">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-6">

              {/* SEÇÃO 1 — Informações do paciente */}
              {prontuarioSaleMaisRecente && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Informações do paciente</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {[
                      { label: 'Nome', value: prontuarioSaleMaisRecente.nome },
                      { label: 'E-mail', value: prontuarioSaleMaisRecente.email },
                      { label: 'Telefone', value: prontuarioSaleMaisRecente.telefone ?? '—' },
                      { label: 'Formato comprado', value: prontuarioSaleMaisRecente.produto },
                      { label: 'Data da compra', value: fmtDt(prontuarioSaleMaisRecente.data_hora) },
                      { label: 'Plataforma', value: prontuarioSaleMaisRecente.plataforma ?? '—' },
                    ].map(({ label, value }) => (
                      <div key={label} className="bg-gray-800/40 rounded-lg p-3">
                        <p className="text-[10px] text-gray-500 mb-0.5">{label}</p>
                        <p className="text-xs text-white">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* SEÇÃO 2 — Histórico de sessões (somente leitura) */}
              <div>
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  Histórico de sessões ({prontuarioSessoesOrdenadas.length})
                </h4>

                {prontuarioSessoesOrdenadas.length > 0 && (
                  <div className="mb-4">
                    <div className="w-full bg-gray-800 rounded-full h-2">
                      <div className="bg-green-500 h-2 rounded-full transition-all"
                        style={{ width: `${(prontuarioPaciente.entregues / prontuarioPaciente.total) * 100}%` }} />
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1">{prontuarioPaciente.entregues} de {prontuarioPaciente.total} sessões entregues</p>
                  </div>
                )}

                <div className="space-y-3">
                  {prontuarioSessoesOrdenadas.length === 0 ? (
                    <p className="text-xs text-gray-600 text-center py-4">Nenhuma sessão criada ainda.</p>
                  ) : prontuarioSessoesOrdenadas.map(s => {
                    const badge = STATUS_LABEL[s.status] ?? { label: s.status, color: 'text-gray-400 bg-gray-400/10' }
                    const remarcacoesSessao = remarcacoes[s.id] ?? []
                    return (
                      <div key={s.id} className="bg-gray-800/40 border border-white/5 rounded-xl p-4">
                        <div className="flex items-center gap-2 mb-3 flex-wrap">
                          <span className="text-xs text-gray-500 font-medium">Sessão {s.numero_sessao} de {s.total_sessoes}</span>
                          <span className={`text-[11px] px-2 py-0.5 rounded-full ${badge.color}`}>{badge.label}</span>
                          {s.numero_sessao === s.total_sessoes && (
                            <span className="text-[10px] text-red-400 border border-red-400/30 px-1.5 py-0.5 rounded">Última sessão</span>
                          )}
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-1">
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
                            <p className="text-gray-500">Comissão</p>
                            <p className="text-green-500">{fmtBRL(s.comissao_valor)}</p>
                          </div>
                        </div>

                        {remarcacoesSessao.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
                            <p className="text-[10px] text-gray-500 uppercase tracking-wide font-medium">
                              Histórico de remarcações ({remarcacoesSessao.length})
                            </p>
                            {remarcacoesSessao.map(r => (
                              <div key={r.id} className="bg-yellow-500/5 border border-yellow-500/15 rounded-lg p-2.5 text-xs space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-yellow-400 text-[10px] font-medium px-1.5 py-0.5 bg-yellow-400/10 rounded">⚠️ Remarcada</span>
                                  <span className="text-gray-500 text-[10px]">Remarcado em {fmtDt(r.created_at)}</span>
                                </div>
                                <p className="text-gray-400"><span className="text-gray-500">De:</span> {fmtDt(r.data_anterior)} → <span className="text-gray-500">Para:</span> {fmtDt(r.data_nova)}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* SEÇÃO 3 — Ocorrências (só notas) */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Ocorrências</h4>
                  {!notaFormOpen && (
                    <button onClick={() => setNotaFormOpen(true)}
                      className="text-xs text-green-500 hover:text-green-400 font-medium transition-colors">
                      + Registrar Nota
                    </button>
                  )}
                </div>

                {notaFormOpen && (
                  <div className="bg-gray-800/50 border border-white/5 rounded-xl p-4 mb-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-white">📝 Nova nota / observação</p>
                      <button onClick={() => setNotaFormOpen(false)} className="text-gray-500 hover:text-white"><X className="w-3.5 h-3.5" /></button>
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
                      <button onClick={() => setNotaFormOpen(false)}
                        className="px-3 py-1.5 text-xs text-gray-400 bg-gray-700 rounded-lg">Cancelar</button>
                      <button onClick={() => { if (!notaValida) { setNotaErro('Preencha o título e a descrição (mín. 10 caracteres)'); return } setNotaErro(''); setNotaSenhaOpen(true) }}
                        disabled={!notaValida}
                        className="px-4 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg transition-colors">
                        Salvar nota
                      </button>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  {prontuarioOcorrencias.length === 0 ? (
                    <p className="text-xs text-gray-600 text-center py-3">Nenhuma ocorrência registrada.</p>
                  ) : prontuarioOcorrencias.map(o => (
                    <div key={o.id} className="bg-gray-800/40 border border-white/5 rounded-lg p-3 text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-white font-medium">{o.titulo}</span>
                        <span className="text-gray-600 text-[10px]">{fmtDt(o.created_at)}</span>
                      </div>
                      <p className="text-gray-400">{o.descricao}</p>
                      <p className="text-gray-600 text-[10px] mt-1">Por: {o.criado_por_nome}</p>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      <SenhaModal
        isOpen={notaSenhaOpen}
        onClose={() => { setNotaSenhaOpen(false); setNotaErro('') }}
        onConfirm={handleNota}
        titulo="Salvar nota"
        descricao="Digite sua senha para registrar a ocorrência"
        loading={notaLoading}
        erro={notaErro}
      />

      <MobileNav />
    </div>
  )
}
