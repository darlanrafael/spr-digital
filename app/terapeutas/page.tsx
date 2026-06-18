'use client'

import { useEffect, useState } from 'react'
import { Users, Calendar, CheckCircle, Clock, DollarSign, TrendingUp } from 'lucide-react'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import { getSupabaseClient } from '@/lib/supabase'

type Terapeuta = {
  id: string
  nome: string
  percentual_comissao: number
  ativo: boolean
}

type Sessao = {
  id: string
  sale_id: string
  terapeuta_id: string
  numero_sessao: number
  total_sessoes: number
  status: string
  data_agendada: string | null
  comissao_valor: number
  comissao_paga: boolean
  paciente_nome: string
  paciente_email: string
  terapeutas: { nome: string } | null
}

type Sale = {
  id: string
  valor_pago_cliente: number
  valor_liquido: number
}

function fmtBRL(n: number) {
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function TerapeutasDashboard() {
  const [terapeutas, setTerapeutas] = useState<Terapeuta[]>([])
  const [sessoes, setSessoes] = useState<Sessao[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const client = getSupabaseClient()
      if (!client) return
      const [tResp, sResp, salResp] = await Promise.all([
        client.from('terapeutas').select('id,nome,percentual_comissao,ativo').eq('ativo', true).order('nome'),
        client.from('sessoes').select('id,sale_id,terapeuta_id,numero_sessao,total_sessoes,status,data_agendada,comissao_valor,comissao_paga,paciente_nome,paciente_email,terapeutas(nome)'),
        client.from('sales').select('id,valor_pago_cliente,valor_liquido').ilike('produto', '%Pedro | Denise%'),
      ])
      setTerapeutas((tResp.data ?? []) as Terapeuta[])
      setSessoes((sResp.data ?? []) as unknown as Sessao[])
      setSales((salResp.data ?? []) as Sale[])
      setLoading(false)
    }
    load()
  }, [])

  const totalVendidas = sessoes.length > 0 ? [...new Set(sessoes.map(s => s.sale_id))].reduce((acc, sid) => {
    const first = sessoes.find(s => s.sale_id === sid)
    return acc + (first?.total_sessoes ?? 0)
  }, 0) : 0
  const totalEntregues = sessoes.filter(s => s.status === 'entregue').length
  const totalPendentes = sessoes.filter(s => s.status === 'pendente' || s.status === 'agendada').length
  const fatBruto = sales.reduce((a, s) => a + (s.valor_pago_cliente || 0), 0)
  const fatLiquido = sales.reduce((a, s) => a + (s.valor_liquido || 0), 0)
  const ticketMedio = sales.length > 0 ? fatBruto / sales.length : 0
  const comissaoGerada = sessoes.filter(s => s.status === 'entregue').reduce((a, s) => a + s.comissao_valor, 0)
  const comissaoPagar = sessoes.filter(s => s.status === 'entregue' && !s.comissao_paga).reduce((a, s) => a + s.comissao_valor, 0)

  const hoje = new Date()
  const hojeStr = hoje.toISOString().split('T')[0]
  const sessoesHoje = sessoes
    .filter(s => s.data_agendada && s.data_agendada.startsWith(hojeStr) && (s.status === 'agendada'))
    .sort((a, b) => (a.data_agendada ?? '').localeCompare(b.data_agendada ?? ''))

  const cards = [
    { label: 'Sessões vendidas', value: totalVendidas, icon: TrendingUp, color: 'text-indigo-400' },
    { label: 'Sessões entregues', value: totalEntregues, icon: CheckCircle, color: 'text-green-500' },
    { label: 'Sessões pendentes', value: totalPendentes, icon: Clock, color: 'text-amber-400' },
    { label: 'Faturamento bruto', value: fmtBRL(fatBruto), icon: DollarSign, color: 'text-white' },
    { label: 'Faturamento líquido', value: fmtBRL(fatLiquido), icon: DollarSign, color: 'text-white' },
    { label: 'Ticket médio', value: fmtBRL(ticketMedio), icon: TrendingUp, color: 'text-white' },
    { label: 'Comissão gerada', value: fmtBRL(comissaoGerada), icon: DollarSign, color: 'text-green-500' },
    { label: 'Comissão a pagar', value: fmtBRL(comissaoPagar), icon: DollarSign, color: 'text-amber-400' },
  ]

  const terapeutaStats = terapeutas.map(t => {
    const ts = sessoes.filter(s => s.terapeuta_id === t.id)
    const entregues = ts.filter(s => s.status === 'entregue')
    const pendentes = ts.filter(s => s.status === 'pendente' || s.status === 'agendada')
    const receitaGerada = entregues.filter(s => !s.comissao_paga).reduce((a, s) => a + s.comissao_valor, 0)
    const receitaFutura = pendentes.reduce((a, s) => a + s.comissao_valor, 0)
    const proxima = ts.filter(s => s.data_agendada && s.status === 'agendada').sort((a, b) => (a.data_agendada ?? '') > (b.data_agendada ?? '') ? 1 : -1)[0]
    return {
      ...t,
      vendidas: [...new Set(ts.map(s => s.sale_id))].reduce((acc, sid) => {
        const f = ts.find(s => s.sale_id === sid)
        return acc + (f?.total_sessoes ?? 0)
      }, 0),
      entregues: entregues.length,
      pendentes: pendentes.length,
      receitaGerada,
      receitaFutura,
      proxima: proxima?.data_agendada ?? null,
    }
  })

  return (
    <div className="min-h-screen bg-gray-950 pb-24 md:pb-8">
      <Header />
      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-white">Atendimentos · Terapeutas</h1>
          <p className="text-sm text-gray-400 mt-1">Visão geral de todos os atendimentos</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Cards resumo */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              {cards.map(({ label, value, icon: Icon, color }) => (
                <div key={label} className="bg-gray-900 border border-white/10 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className={`w-4 h-4 ${color}`} />
                    <span className="text-xs text-gray-400">{label}</span>
                  </div>
                  <p className={`text-lg font-bold ${color}`}>{value}</p>
                </div>
              ))}
            </div>

            {/* Tabela de terapeutas */}
            <div className="bg-gray-900 border border-white/10 rounded-xl mb-6">
              <div className="p-4 border-b border-white/10">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Users className="w-4 h-4 text-indigo-400" /> Terapeutas ativos
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5">
                      {['Nome', 'Vendidas', 'Entregues', 'Pendentes', 'Receita gerada', 'Receita futura', 'Próxima consulta'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {terapeutaStats.length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-600 text-xs">Nenhum terapeuta cadastrado</td></tr>
                    ) : terapeutaStats.map(t => (
                      <tr key={t.id} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                        <td className="px-4 py-3 text-white font-medium">{t.nome}</td>
                        <td className="px-4 py-3 text-gray-300">{t.vendidas}</td>
                        <td className="px-4 py-3 text-green-500">{t.entregues}</td>
                        <td className="px-4 py-3 text-amber-400">{t.pendentes}</td>
                        <td className="px-4 py-3 text-green-500">{fmtBRL(t.receitaGerada)}</td>
                        <td className="px-4 py-3 text-gray-300">{fmtBRL(t.receitaFutura)}</td>
                        <td className="px-4 py-3 text-gray-400">{fmtDt(t.proxima)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Sessões de hoje */}
            <div className="bg-gray-900 border border-white/10 rounded-xl">
              <div className="p-4 border-b border-white/10">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-indigo-400" />
                  Consultas hoje ({sessoesHoje.length})
                </h2>
              </div>
              {sessoesHoje.length === 0 ? (
                <p className="px-4 py-6 text-center text-gray-600 text-xs">Nenhuma consulta agendada para hoje</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/5">
                        {['Horário', 'Paciente', 'Terapeuta', 'Sessão'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sessoesHoje.map(s => (
                        <tr key={s.id} className="border-b border-white/5 hover:bg-white/2">
                          <td className="px-4 py-3 text-indigo-400 font-medium">
                            {s.data_agendada ? new Date(s.data_agendada).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-white">{s.paciente_nome}</p>
                            <p className="text-xs text-gray-500">{s.paciente_email}</p>
                          </td>
                          <td className="px-4 py-3 text-gray-300">{(s.terapeutas as { nome: string } | null)?.nome ?? '—'}</td>
                          <td className="px-4 py-3 text-gray-400">{s.numero_sessao}/{s.total_sessoes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </main>
      <MobileNav />
    </div>
  )
}
