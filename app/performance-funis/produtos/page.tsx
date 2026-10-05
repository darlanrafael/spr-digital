'use client'

import { useEffect, useState } from 'react'
import { Space_Grotesk, Inter } from 'next/font/google'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import ProtectedRoute from '@/components/ProtectedRoute'
import PerfFunisTabs from '@/components/PerfFunisTabs'

export const dynamic = 'force-dynamic'

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] })
const ui = Inter({ subsets: ['latin'], weight: ['400', '500', '600'] })

type Produto = {
  id: string
  plataforma: string
  produto_id: string
  nome_exibicao: string | null
  nomes: string[] | null
}

export default function ProdutosFunisPage() {
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [rascunhos, setRascunhos] = useState<Record<string, string>>({})
  const [salvando, setSalvando] = useState<string | null>(null)
  const [salvoId, setSalvoId] = useState<string | null>(null)

  async function carregar() {
    setCarregando(true)
    setErro(null)
    try {
      const res = await fetch('/api/funis/produtos')
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Falha ao carregar produtos')
      setProdutos(json as Produto[])
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar produtos')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => { carregar() }, [])

  async function salvar(p: Produto) {
    const novo = (rascunhos[p.id] ?? p.nome_exibicao ?? '').trim()
    if (novo === (p.nome_exibicao ?? '')) return
    setSalvando(p.id)
    setErro(null)
    try {
      const res = await fetch('/api/funis/produtos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, nome_exibicao: novo }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Falha ao salvar')
      setProdutos(prev => prev.map(x => (x.id === p.id ? { ...x, nome_exibicao: novo } : x)))
      setRascunhos(prev => { const { [p.id]: _omit, ...resto } = prev; return resto })
      setSalvoId(p.id)
      setTimeout(() => setSalvoId(cur => (cur === p.id ? null : cur)), 2000)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao salvar')
    } finally {
      setSalvando(null)
    }
  }

  return (
    <ProtectedRoute>
      <div className={`min-h-screen bg-[#0E0F13] text-[#F4F5F7] ${ui.className}`}>
        <Header />
        <main className="max-w-screen-xl mx-auto px-4 pt-6 pb-24 md:pb-10">
          <PerfFunisTabs />
          <h1 className={`${display.className} text-2xl font-bold tracking-tight`}>Produtos</h1>
          <p className="mt-1 text-sm text-[#9CA3AF]">Catálogo de produtos dos funis. Edite o nome de exibição e confira os nomes já vistos.</p>

          {erro && (
            <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{erro}</div>
          )}

          <section className="mt-6 rounded-2xl border border-white/10 bg-[#15171D] p-3 sm:p-5">
            {carregando ? (
              <p className="p-3 text-sm text-[#9CA3AF]">Carregando...</p>
            ) : produtos.length === 0 ? (
              <p className="p-3 text-sm text-[#9CA3AF]">Nenhum produto no catálogo.</p>
            ) : (
              <ul className="divide-y divide-white/10">
                {produtos.map(p => {
                  const valor = rascunhos[p.id] ?? p.nome_exibicao ?? ''
                  const sujo = valor.trim() !== (p.nome_exibicao ?? '')
                  const nomes = Array.isArray(p.nomes) ? p.nomes : []
                  return (
                    <li key={p.id} className="py-4 px-1 flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-6">
                      <div className="lg:w-1/3">
                        <div className="flex gap-2">
                          <input
                            value={valor}
                            onChange={e => setRascunhos(prev => ({ ...prev, [p.id]: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') salvar(p) }}
                            aria-label="Nome de exibição"
                            className="flex-1 min-w-0 rounded-lg border border-white/10 bg-[#181A20] px-3 py-1.5 text-sm text-white focus:outline-none focus:border-white/30"
                          />
                          <button
                            onClick={() => salvar(p)}
                            disabled={!sujo || salvando === p.id}
                            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/10 text-white disabled:opacity-40 hover:bg-white/20 transition-colors"
                          >
                            {salvando === p.id ? 'Salvando...' : 'Salvar'}
                          </button>
                        </div>
                        {salvoId === p.id && <p className="mt-1 text-xs text-emerald-400">Salvo</p>}
                      </div>
                      <div className="lg:w-1/4 text-xs text-[#9CA3AF]">
                        <p className="uppercase tracking-wide">{p.plataforma}</p>
                        <p className="mt-0.5 font-mono break-all">{p.produto_id}</p>
                      </div>
                      <div className="flex-1 flex flex-wrap gap-1.5">
                        {nomes.length === 0 ? (
                          <span className="text-xs text-[#9CA3AF]">Sem nomes registrados</span>
                        ) : nomes.map(n => (
                          <span key={n} className="rounded-md border border-white/10 bg-[#181A20] px-2 py-0.5 text-xs text-[#D1D5DB]">{n}</span>
                        ))}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </main>
        <MobileNav />
      </div>
    </ProtectedRoute>
  )
}
