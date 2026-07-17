'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { User, ChevronRight } from 'lucide-react'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import { getSupabaseClient } from '@/lib/supabase'

// Dados ao vivo — sem isso a Vercel cacheia a página como estática e serve
// versões antigas do CDN mesmo depois de um deploy novo.
export const dynamic = 'force-dynamic'

type Terapeuta = {
  id: string
  nome: string
  email: string
  percentual_comissao: number
  ativo: boolean
  vendas_a_partir_de: string | null
}

type Sessao = {
  sale_id: string
  terapeuta_id: string
  status: string
  comissao_valor: number
  comissao_paga: boolean
}

function fmtBRL(n: number) {
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

type TerapeutaSession = {
  id: string
  nome: string
  email: string
  tipo: string
  terapeuta_id: string | null
}

export default function TerapeutasLista() {
  const router = useRouter()
  const [terapeutas, setTerapeutas] = useState<Terapeuta[]>([])
  const [sessoes, setSessoes] = useState<Sessao[]>([])
  const [vendaDataPorSale, setVendaDataPorSale] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const raw = localStorage.getItem('terapeutas_session')
    if (raw) {
      try {
        const session = JSON.parse(raw) as TerapeutaSession
        if (session.tipo === 'terapeuta' && session.terapeuta_id) {
          router.replace(`/terapeutas/${session.terapeuta_id}`)
          return
        }
      } catch { /* ignore */ }
    }

    async function load() {
      const client = getSupabaseClient()
      if (!client) return
      const [tResp, sResp] = await Promise.all([
        client.from('terapeutas').select('id,nome,email,percentual_comissao,ativo,vendas_a_partir_de').order('nome'),
        client.from('sessoes').select('sale_id,terapeuta_id,status,comissao_valor,comissao_paga'),
      ])
      const terapeutasData = (tResp.data ?? []) as Terapeuta[]
      const sessoesData = (sResp.data ?? []) as Sessao[]
      setTerapeutas(terapeutasData)
      setSessoes(sessoesData)

      // Terapeuta em modo "começar do zero" (vendas_a_partir_de): sessão só
      // conta se a venda que a originou é depois do corte — mesma regra da
      // página do terapeuta, senão o card volta a mostrar histórico antigo
      // que já devia estar zerado.
      const temCorte = terapeutasData.some(t => t.vendas_a_partir_de)
      if (temCorte) {
        const saleIds = [...new Set(sessoesData.map(s => s.sale_id))]
        const dataPorSale: Record<string, string> = {}
        const BATCH = 200
        for (let i = 0; i < saleIds.length; i += BATCH) {
          const batch = saleIds.slice(i, i + BATCH)
          const { data } = await client.from('sales').select('id,data_hora').in('id', batch)
          for (const v of (data ?? []) as { id: string; data_hora: string }[]) dataPorSale[v.id] = v.data_hora
        }
        setVendaDataPorSale(dataPorSale)
      }
      setLoading(false)
    }
    load()
  }, [])

  function statsDoTerapeuta(t: Terapeuta) {
    let ts = sessoes.filter(s => s.terapeuta_id === t.id)
    if (t.vendas_a_partir_de) {
      const corte = t.vendas_a_partir_de
      ts = ts.filter(s => {
        const dataVenda = vendaDataPorSale[s.sale_id]
        return dataVenda ? new Date(dataVenda).getTime() >= new Date(corte).getTime() : false
      })
    }
    const ativas = ts.filter(s => s.status === 'agendada' || s.status === 'pendente').length
    const receita = ts.filter(s => s.status === 'entregue' && !s.comissao_paga).reduce((a, s) => a + s.comissao_valor, 0)
    return { ativas, receita }
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-24 md:pb-8">
      <Header />
      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-white">Terapeutas</h1>
          <p className="text-sm text-gray-400 mt-1">{terapeutas.filter(t => t.ativo).length} terapeuta(s) ativo(s)</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : terapeutas.length === 0 ? (
          <div className="text-center py-16">
            <User className="w-10 h-10 text-gray-700 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">Nenhum terapeuta cadastrado.</p>
            <p className="text-gray-600 text-xs mt-1">Acesse Admin para cadastrar terapeutas.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {terapeutas.map(t => {
              const { ativas, receita } = statsDoTerapeuta(t)
              return (
                <button
                  key={t.id}
                  onClick={() => router.push(`/terapeutas/${t.id}`)}
                  className="bg-gray-900 border border-white/10 rounded-xl p-5 text-left hover:border-indigo-500/40 hover:bg-gray-800/60 transition-all group"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-10 h-10 rounded-full bg-indigo-600/20 flex items-center justify-center">
                      <User className="w-5 h-5 text-indigo-400" />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${t.ativo ? 'text-green-500 bg-green-500/10' : 'text-gray-500 bg-gray-500/10'}`}>
                        {t.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                      <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-indigo-400 transition-colors" />
                    </div>
                  </div>

                  <h3 className="text-white font-semibold mb-0.5">{t.nome}</h3>
                  <p className="text-xs text-gray-500 mb-4">{t.email}</p>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-gray-500">Sessões ativas</p>
                      <p className="text-lg font-bold text-white">{ativas}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Receita a pagar</p>
                      <p className="text-lg font-bold text-green-500">{fmtBRL(receita)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Comissão</p>
                      <p className="text-sm font-medium text-indigo-400">{t.percentual_comissao}%</p>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </main>
      <MobileNav />
    </div>
  )
}
