'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import { getSupabaseClient } from '@/lib/supabase'

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
  paciente_nome: string
  paciente_email: string
  terapeutas: { nome: string } | null
}

type Terapeuta = { id: string; nome: string }

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

function fmtBRL(n: number) {
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function TerapeutasAgenda() {
  const hoje = new Date()
  const [ano, setAno] = useState(hoje.getFullYear())
  const [mes, setMes] = useState(hoje.getMonth())
  const [sessoes, setSessoes] = useState<Sessao[]>([])
  const [terapeutas, setTerapeutas] = useState<Terapeuta[]>([])
  const [filtroTerapeuta, setFiltroTerapeuta] = useState('')
  const [detalhe, setDetalhe] = useState<Sessao | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const client = getSupabaseClient()
      if (!client) return
      setLoading(true)
      const inicio = new Date(ano, mes, 1).toISOString()
      const fim = new Date(ano, mes + 1, 0, 23, 59, 59).toISOString()
      const [sResp, tResp] = await Promise.all([
        client.from('sessoes')
          .select('id,sale_id,terapeuta_id,numero_sessao,total_sessoes,status,data_agendada,link_meet,comissao_valor,paciente_nome,paciente_email,terapeutas(nome)')
          .gte('data_agendada', inicio).lte('data_agendada', fim),
        client.from('terapeutas').select('id,nome').eq('ativo', true).order('nome'),
      ])
      setSessoes((sResp.data ?? []) as unknown as Sessao[])
      setTerapeutas((tResp.data ?? []) as Terapeuta[])
      setLoading(false)
    }
    load()
  }, [ano, mes])

  function navMes(dir: -1 | 1) {
    const d = new Date(ano, mes + dir, 1)
    setAno(d.getFullYear())
    setMes(d.getMonth())
  }

  // Montar grid do calendário
  const primeiroDia = new Date(ano, mes, 1).getDay()
  const diasNoMes = new Date(ano, mes + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array(primeiroDia).fill(null),
    ...Array.from({ length: diasNoMes }, (_, i) => i + 1),
  ]
  // Preencher até múltiplo de 7
  while (cells.length % 7 !== 0) cells.push(null)

  const sessoesFiltradas = filtroTerapeuta
    ? sessoes.filter(s => s.terapeuta_id === filtroTerapeuta)
    : sessoes

  function sessoesNoDia(dia: number): Sessao[] {
    return sessoesFiltradas.filter(s => {
      if (!s.data_agendada) return false
      const d = new Date(s.data_agendada)
      return d.getFullYear() === ano && d.getMonth() === mes && d.getDate() === dia
    }).sort((a, b) => (a.data_agendada ?? '') < (b.data_agendada ?? '') ? -1 : 1)
  }

  const hojeCell = hoje.getFullYear() === ano && hoje.getMonth() === mes ? hoje.getDate() : null

  return (
    <div className="min-h-screen bg-gray-950 pb-24 md:pb-8">
      <Header />
      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Cabeçalho */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-white">Agenda</h1>
            <p className="text-sm text-gray-400 mt-1">{MESES[mes]} {ano}</p>
          </div>
          <div className="flex items-center gap-3">
            <select value={filtroTerapeuta} onChange={e => setFiltroTerapeuta(e.target.value)}
              className="bg-gray-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none">
              <option value="">Todos os terapeutas</option>
              {terapeutas.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select>
            <div className="flex items-center gap-1">
              <button onClick={() => navMes(-1)} className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button onClick={() => navMes(1)} className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-60">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden">
            {/* Header dos dias da semana */}
            <div className="grid grid-cols-7 border-b border-white/10">
              {DIAS.map(d => (
                <div key={d} className="px-2 py-3 text-center text-xs text-gray-500 font-medium">{d}</div>
              ))}
            </div>

            {/* Células do calendário */}
            <div className="grid grid-cols-7">
              {cells.map((dia, idx) => {
                const ss = dia ? sessoesNoDia(dia) : []
                const isHoje = dia === hojeCell
                return (
                  <div key={idx} className={`min-h-[90px] p-1.5 border-b border-r border-white/5 ${!dia ? 'bg-gray-900/50' : ''}`}>
                    {dia && (
                      <>
                        <span className={`text-xs font-medium inline-flex w-6 h-6 items-center justify-center rounded-full mb-1 ${
                          isHoje ? 'bg-indigo-600 text-white' : 'text-gray-400'
                        }`}>{dia}</span>
                        <div className="space-y-0.5">
                          {ss.slice(0, 3).map(s => (
                            <button key={s.id} onClick={() => setDetalhe(s)}
                              className="w-full text-left text-[10px] px-1.5 py-0.5 rounded bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 truncate transition-colors">
                              {s.data_agendada ? new Date(s.data_agendada).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''} {s.paciente_nome.split(' ')[0]}
                            </button>
                          ))}
                          {ss.length > 3 && (
                            <span className="text-[10px] text-gray-500">+{ss.length - 3} mais</span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </main>

      {/* Modal detalhe da sessão */}
      {detalhe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setDetalhe(null)}>
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Detalhes da sessão</h3>
              <button onClick={() => setDetalhe(null)} className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3 text-sm">
              <Row label="Paciente" value={detalhe.paciente_nome} />
              <Row label="Email" value={detalhe.paciente_email} />
              <Row label="Terapeuta" value={(detalhe.terapeutas as { nome: string } | null)?.nome ?? '—'} />
              <Row label="Sessão" value={`${detalhe.numero_sessao}/${detalhe.total_sessoes}`} />
              <Row label="Status" value={detalhe.status} />
              <Row label="Data/hora" value={detalhe.data_agendada ? new Date(detalhe.data_agendada).toLocaleString('pt-BR') : '—'} />
              <Row label="Comissão" value={fmtBRL(detalhe.comissao_valor)} />
              {detalhe.link_meet && (
                <div className="flex justify-between items-center">
                  <span className="text-gray-500">Link Meet</span>
                  <a href={detalhe.link_meet} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline text-xs truncate max-w-[180px]">Abrir</a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <MobileNav />
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-start gap-4">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className="text-white text-right">{value}</span>
    </div>
  )
}
