'use client'

import { useEffect, useState } from 'react'
import { Space_Grotesk, Inter } from 'next/font/google'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import ProtectedRoute from '@/components/ProtectedRoute'

export const dynamic = 'force-dynamic'

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '600', '700'] })
const ui = Inter({ subsets: ['latin'], weight: ['400', '500', '600'] })

type ProdutoCatalogo = {
  id: string
  plataforma: string
  produto_id: string
  nome_exibicao: string | null
}

type VinculoProduto = { plataforma: string; produto_id: string }

type Funil = {
  id: string
  nome: string
  termos_campanha: string[] | null
  produtos: VinculoProduto[]
}

type Rascunho = {
  id: string | null
  nome: string
  termos: string[]
  produtos: VinculoProduto[]
}

const chave = (p: VinculoProduto) => `${p.plataforma}::${p.produto_id}`
const VAZIO: Rascunho = { id: null, nome: '', termos: [], produtos: [] }

export default function FunisPage() {
  const [funis, setFunis] = useState<Funil[]>([])
  const [catalogo, setCatalogo] = useState<ProdutoCatalogo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [form, setForm] = useState<Rascunho | null>(null)
  const [novoTermo, setNovoTermo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [excluindo, setExcluindo] = useState<string | null>(null)

  async function carregar() {
    setCarregando(true)
    setErro(null)
    try {
      const [rf, rp] = await Promise.all([fetch('/api/funis'), fetch('/api/funis/produtos')])
      const jf = await rf.json()
      if (!rf.ok) throw new Error(jf?.error || 'Falha ao carregar funis')
      const jp = await rp.json()
      if (!rp.ok) throw new Error(jp?.error || 'Falha ao carregar produtos')
      setFunis(jf as Funil[])
      setCatalogo(jp as ProdutoCatalogo[])
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => { carregar() }, [])

  function abrirNovo() {
    setForm({ ...VAZIO })
    setNovoTermo('')
    setErro(null)
  }

  function abrirEdicao(f: Funil) {
    setForm({
      id: f.id,
      nome: f.nome,
      termos: Array.isArray(f.termos_campanha) ? [...f.termos_campanha] : [],
      produtos: [...f.produtos],
    })
    setNovoTermo('')
    setErro(null)
  }

  function adicionarTermo() {
    const t = novoTermo.trim()
    if (!t || !form) return
    if (!form.termos.includes(t)) setForm({ ...form, termos: [...form.termos, t] })
    setNovoTermo('')
  }

  function alternarProduto(p: ProdutoCatalogo) {
    if (!form) return
    const v = { plataforma: p.plataforma, produto_id: p.produto_id }
    const ja = form.produtos.some(x => chave(x) === chave(v))
    setForm({
      ...form,
      produtos: ja ? form.produtos.filter(x => chave(x) !== chave(v)) : [...form.produtos, v],
    })
  }

  async function salvar() {
    if (!form) return
    if (!form.nome.trim()) { setErro('O funil precisa de um nome.'); return }
    // termo digitado e ainda não adicionado entra junto
    const pendente = novoTermo.trim()
    const termos = pendente && !form.termos.includes(pendente) ? [...form.termos, pendente] : form.termos
    setSalvando(true)
    setErro(null)
    try {
      const res = await fetch(form.id ? `/api/funis/${form.id}` : '/api/funis', {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: form.nome.trim(),
          termos_campanha: termos,
          produtos: form.produtos.map(p => ({ plataforma: p.plataforma, produto_id: p.produto_id })),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Falha ao salvar')
      setForm(null)
      setNovoTermo('')
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(f: Funil) {
    if (!window.confirm(`Excluir o funil "${f.nome}"? Esta ação não pode ser desfeita.`)) return
    setExcluindo(f.id)
    setErro(null)
    try {
      const res = await fetch(`/api/funis/${f.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json().catch(() => null)
        throw new Error(json?.error || 'Falha ao excluir')
      }
      setFunis(prev => prev.filter(x => x.id !== f.id))
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao excluir')
    } finally {
      setExcluindo(null)
    }
  }

  const selecionados = new Set((form?.produtos ?? []).map(chave))

  return (
    <ProtectedRoute>
      <div className={`min-h-screen bg-[#0E0F13] text-[#F4F5F7] ${ui.className}`}>
        <Header />
        <main className="max-w-screen-xl mx-auto px-4 pt-6 pb-24 md:pb-10">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className={`${display.className} text-2xl font-bold tracking-tight`}>Funis</h1>
              <p className="mt-1 text-sm text-[#9CA3AF]">Cadastre os funis, escolha os produtos e defina os termos de campanha.</p>
            </div>
            {!form && (
              <button
                onClick={abrirNovo}
                className="shrink-0 px-3 py-2 text-sm font-medium rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
              >
                Novo funil
              </button>
            )}
          </div>

          {erro && (
            <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{erro}</div>
          )}

          {form && (
            <section className="mt-6 rounded-2xl border border-white/10 bg-[#15171D] p-4 sm:p-5">
              <h2 className={`${display.className} text-lg font-semibold`}>{form.id ? 'Editar funil' : 'Novo funil'}</h2>

              <label className="mt-4 block text-xs uppercase tracking-wide text-[#9CA3AF]" htmlFor="funil-nome">Nome</label>
              <input
                id="funil-nome"
                value={form.nome}
                onChange={e => setForm({ ...form, nome: e.target.value })}
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#181A20] px-3 py-1.5 text-sm text-white focus:outline-none focus:border-white/30"
              />

              <p className="mt-5 text-xs uppercase tracking-wide text-[#9CA3AF]">Produtos</p>
              {catalogo.length === 0 ? (
                <p className="mt-1 text-sm text-[#9CA3AF]">Nenhum produto no catálogo.</p>
              ) : (
                <ul className="mt-1 max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-[#181A20] divide-y divide-white/5">
                  {catalogo.map(p => {
                    const marcado = selecionados.has(chave(p))
                    return (
                      <li key={p.id}>
                        <label className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-white/5">
                          <input type="checkbox" checked={marcado} onChange={() => alternarProduto(p)} />
                          <span className="flex-1 min-w-0 truncate">{p.nome_exibicao || p.produto_id}</span>
                          <span className="text-xs uppercase text-[#9CA3AF]">{p.plataforma}</span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}

              <p className="mt-5 text-xs uppercase tracking-wide text-[#9CA3AF]">Termos de campanha</p>
              <p className="mt-0.5 text-xs text-[#9CA3AF]">Sem termos, o funil é orgânico.</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {form.termos.length === 0 ? (
                  <span className="text-xs text-[#9CA3AF]">Nenhum termo (orgânico)</span>
                ) : form.termos.map(t => (
                  <span key={t} className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-[#181A20] px-2 py-0.5 text-xs text-[#D1D5DB]">
                    {t}
                    <button
                      onClick={() => setForm({ ...form, termos: form.termos.filter(x => x !== t) })}
                      aria-label={`Remover termo ${t}`}
                      className="text-[#9CA3AF] hover:text-red-300"
                    >
                      x
                    </button>
                  </span>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  value={novoTermo}
                  onChange={e => setNovoTermo(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); adicionarTermo() } }}
                  placeholder="Novo termo"
                  aria-label="Novo termo de campanha"
                  className="flex-1 min-w-0 rounded-lg border border-white/10 bg-[#181A20] px-3 py-1.5 text-sm text-white focus:outline-none focus:border-white/30"
                />
                <button
                  onClick={adicionarTermo}
                  disabled={!novoTermo.trim()}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/10 text-white disabled:opacity-40 hover:bg-white/20 transition-colors"
                >
                  Adicionar
                </button>
              </div>

              <div className="mt-6 flex gap-2">
                <button
                  onClick={salvar}
                  disabled={salvando}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white disabled:opacity-40 hover:bg-indigo-500 transition-colors"
                >
                  {salvando ? 'Salvando...' : 'Salvar'}
                </button>
                <button
                  onClick={() => { setForm(null); setNovoTermo(''); setErro(null) }}
                  disabled={salvando}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </section>
          )}

          <section className="mt-6 rounded-2xl border border-white/10 bg-[#15171D] p-3 sm:p-5">
            {carregando ? (
              <p className="p-3 text-sm text-[#9CA3AF]">Carregando...</p>
            ) : funis.length === 0 ? (
              <p className="p-3 text-sm text-[#9CA3AF]">Nenhum funil cadastrado.</p>
            ) : (
              <ul className="divide-y divide-white/10">
                {funis.map(f => {
                  const organico = !f.termos_campanha || f.termos_campanha.length === 0
                  return (
                    <li key={f.id} className="py-3 px-1 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{f.nome}</p>
                        <p className="mt-0.5 text-xs text-[#9CA3AF]">
                          {f.produtos.length} {f.produtos.length === 1 ? 'produto' : 'produtos'}
                        </p>
                      </div>
                      {organico && (
                        <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300">Orgânico</span>
                      )}
                      <button
                        onClick={() => abrirEdicao(f)}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => excluir(f)}
                        disabled={excluindo === f.id}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-500/10 text-red-300 disabled:opacity-40 hover:bg-red-500/20 transition-colors"
                      >
                        {excluindo === f.id ? 'Excluindo...' : 'Excluir'}
                      </button>
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
