'use client'

import { useEffect, useRef, useState } from 'react'
import { Plus, User, Users, Activity, Eye, EyeOff, CheckCircle, Key, X } from 'lucide-react'
import Header from '@/components/Header'
import MobileNav from '@/components/MobileNav'
import { useApp } from '@/contexts/AppContext'

type Terapeuta = {
  id: string
  nome: string
  email: string
  percentual_comissao: number
  ativo: boolean
}

type Usuario = {
  id: string
  nome: string
  email: string
  tipo: string
  ativo: boolean
  terapeuta_id: string | null
  created_at: string
}

type LogEntry = {
  id: string
  usuario_email: string
  acao: string
  detalhes: Record<string, unknown>
  created_at: string
}

type Tab = 'terapeutas' | 'usuarios' | 'log'

function fmtDt(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function AdminPage() {
  const { user } = useApp()
  const [tab, setTab] = useState<Tab>('terapeutas')

  // Terapeutas
  const [terapeutas, setTerapeutas] = useState<Terapeuta[]>([])
  const [tLoading, setTLoading] = useState(true)
  const [novoTerapeuta, setNovoTerapeuta] = useState({ nome: '', email: '', percentual_comissao: '' })
  const [tSaving, setTSaving] = useState(false)
  const [tErro, setTErro] = useState('')
  const [tSucesso, setTSucesso] = useState('')

  // Usuários
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [uLoading, setULoading] = useState(false)
  const [novoUsuario, setNovoUsuario] = useState({ nome: '', email: '', senha: '', tipo: 'comercial', terapeuta_id: '' })
  const [showSenha, setShowSenha] = useState(false)
  const [uSaving, setUSaving] = useState(false)
  const [uErro, setUErro] = useState('')
  const [uSucesso, setUSucesso] = useState('')

  // Log
  const [log, setLog] = useState<LogEntry[]>([])
  const [logLoading, setLogLoading] = useState(false)

  // Alterar senha
  type SenhaTarget = { tipo: 'terapeuta' | 'usuario'; id: string; nome: string }
  const [senhaTarget, setSenhaTarget] = useState<SenhaTarget | null>(null)
  const [novaSenha, setNovaSenha] = useState('')
  const [confirmarSenha, setConfirmarSenha] = useState('')
  const [showNovaSenha, setShowNovaSenha] = useState(false)
  const [senhaLoading, setSenhaLoading] = useState(false)
  const [senhaErro, setSenhaErro] = useState('')
  const [toast, setToast] = useState('')
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function loadTerapeutas() {
    setTLoading(true)
    const res = await fetch('/api/terapeutas/admin/terapeutas')
    const json = await res.json()
    setTerapeutas(Array.isArray(json) ? json : (json.terapeutas ?? []))
    setTLoading(false)
  }

  async function loadUsuarios() {
    setULoading(true)
    const res = await fetch('/api/terapeutas/admin/usuarios')
    const json = await res.json()
    setUsuarios(Array.isArray(json) ? json : (json.usuarios ?? []))
    setULoading(false)
  }

  async function loadLog() {
    setLogLoading(true)
    const res = await fetch('/api/terapeutas/admin/log')
    const json = await res.json()
    setLog(json.log ?? [])
    setLogLoading(false)
  }

  function showToast(msg: string) {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 3500)
  }

  async function handleAlterarSenha() {
    if (!senhaTarget) return
    setSenhaErro('')
    if (novaSenha.length < 6) { setSenhaErro('Mínimo 6 caracteres'); return }
    if (novaSenha !== confirmarSenha) { setSenhaErro('As senhas não conferem'); return }
    setSenhaLoading(true)
    const endpoint = senhaTarget.tipo === 'terapeuta'
      ? '/api/terapeutas/admin/terapeutas'
      : '/api/terapeutas/admin/usuarios'
    const res = await fetch(endpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: senhaTarget.id, senha: novaSenha }),
    })
    const json = await res.json()
    setSenhaLoading(false)
    if (!res.ok) { setSenhaErro(json.error ?? 'Erro ao alterar senha'); return }
    setSenhaTarget(null); setNovaSenha(''); setConfirmarSenha('')
    showToast(`✓ Senha de ${senhaTarget.nome} alterada com sucesso!`)
  }

  useEffect(() => { loadTerapeutas() }, [])

  useEffect(() => {
    if (tab === 'usuarios' && usuarios.length === 0) loadUsuarios()
    if (tab === 'log' && log.length === 0) loadLog()
  }, [tab])

  async function handleCriarTerapeuta(e: React.FormEvent) {
    e.preventDefault()
    setTSaving(true); setTErro(''); setTSucesso('')
    const res = await fetch('/api/terapeutas/admin/terapeutas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nome: novoTerapeuta.nome,
        email: novoTerapeuta.email,
        percentual_comissao: Number(novoTerapeuta.percentual_comissao),
      }),
    })
    const json = await res.json()
    setTSaving(false)
    if (!res.ok) { setTErro(json.error ?? 'Erro'); return }
    setTSucesso('Terapeuta criado com sucesso!')
    setNovoTerapeuta({ nome: '', email: '', percentual_comissao: '' })
    loadTerapeutas()
  }

  async function handleToggleTerapeuta(t: Terapeuta) {
    await fetch('/api/terapeutas/admin/terapeutas', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: t.id, ativo: !t.ativo }),
    })
    loadTerapeutas()
  }

  async function handleCriarUsuario(e: React.FormEvent) {
    e.preventDefault()
    setUSaving(true); setUErro(''); setUSucesso('')
    const body: Record<string, unknown> = {
      nome: novoUsuario.nome,
      email: novoUsuario.email,
      senha: novoUsuario.senha,
      tipo: novoUsuario.tipo,
    }
    if (novoUsuario.tipo === 'terapeuta' && novoUsuario.terapeuta_id) {
      body.terapeuta_id = novoUsuario.terapeuta_id
    }
    const res = await fetch('/api/terapeutas/admin/usuarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    setUSaving(false)
    if (!res.ok) { setUErro(json.error ?? 'Erro'); return }
    setUSucesso('Usuário criado com sucesso!')
    setNovoUsuario({ nome: '', email: '', senha: '', tipo: 'comercial', terapeuta_id: '' })
    loadUsuarios()
  }

  async function handleToggleUsuario(u: Usuario) {
    await fetch('/api/terapeutas/admin/usuarios', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: u.id, ativo: !u.ativo }),
    })
    loadUsuarios()
  }

  if (user && user.role !== 'admin') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-500 text-sm">Acesso restrito a administradores.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-24 md:pb-8">
      <Header />
      <main className="max-w-4xl mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-white">Admin — Terapeutas</h1>
          <p className="text-sm text-gray-400 mt-1">Gerenciar terapeutas, usuários e visualizar log de atividades</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-900 border border-white/10 rounded-xl p-1 w-fit">
          {([
            { key: 'terapeutas', label: 'Terapeutas', icon: User },
            { key: 'usuarios', label: 'Usuários', icon: Users },
            { key: 'log', label: 'Log', icon: Activity },
          ] as { key: Tab; label: string; icon: React.ElementType }[]).map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                tab === key ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'
              }`}>
              <Icon className="w-3.5 h-3.5" />{label}
            </button>
          ))}
        </div>

        {/* === TAB: TERAPEUTAS === */}
        {tab === 'terapeutas' && (
          <div className="space-y-6">
            {/* Formulário */}
            <div className="bg-gray-900 border border-white/10 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <Plus className="w-4 h-4 text-indigo-400" /> Cadastrar terapeuta
              </h2>
              <form onSubmit={handleCriarTerapeuta} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Nome completo</label>
                  <input type="text" required value={novoTerapeuta.nome} onChange={e => setNovoTerapeuta(p => ({ ...p, nome: e.target.value }))}
                    placeholder="Nome do terapeuta"
                    className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">E-mail</label>
                  <input type="email" required value={novoTerapeuta.email} onChange={e => setNovoTerapeuta(p => ({ ...p, email: e.target.value }))}
                    placeholder="email@exemplo.com"
                    className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Comissão (%)</label>
                  <input type="number" required min="0" max="100" step="0.01" value={novoTerapeuta.percentual_comissao}
                    onChange={e => setNovoTerapeuta(p => ({ ...p, percentual_comissao: e.target.value }))}
                    placeholder="Ex: 30"
                    className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
                </div>
                {tErro && <p className="col-span-3 text-xs text-red-400">{tErro}</p>}
                {tSucesso && (
                  <p className="col-span-3 text-xs text-green-400 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" />{tSucesso}
                  </p>
                )}
                <div className="col-span-1 sm:col-span-3">
                  <button type="submit" disabled={tSaving}
                    className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 rounded-lg transition-colors">
                    {tSaving ? 'Salvando...' : 'Cadastrar'}
                  </button>
                </div>
              </form>
            </div>

            {/* Lista */}
            <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10">
                <h2 className="text-sm font-semibold text-white">Terapeutas cadastrados ({terapeutas.length})</h2>
              </div>
              {tLoading ? (
                <div className="flex items-center justify-center h-20">
                  <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5">
                      {['Nome', 'E-mail', 'Comissão', 'Status', ''].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {terapeutas.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-600 text-xs">Nenhum terapeuta cadastrado</td></tr>
                    ) : terapeutas.map(t => (
                      <tr key={t.id} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                        <td className="px-4 py-3 text-white">{t.nome}</td>
                        <td className="px-4 py-3 text-gray-400">{t.email}</td>
                        <td className="px-4 py-3 text-indigo-400">{t.percentual_comissao}%</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${t.ativo ? 'text-green-500 bg-green-500/10' : 'text-gray-500 bg-gray-500/10'}`}>
                            {t.ativo ? 'Ativo' : 'Inativo'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <button onClick={() => handleToggleTerapeuta(t)}
                              className={`text-xs ${t.ativo ? 'text-red-400 hover:text-red-300' : 'text-green-500 hover:text-green-400'} transition-colors`}>
                              {t.ativo ? 'Desativar' : 'Ativar'}
                            </button>
                            <button onClick={() => { setSenhaTarget({ tipo: 'terapeuta', id: t.id, nome: t.nome }); setNovaSenha(''); setConfirmarSenha(''); setSenhaErro('') }}
                              className="flex items-center gap-1 text-xs text-gray-400 hover:text-indigo-400 transition-colors">
                              <Key className="w-3 h-3" /> Senha
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* === TAB: USUÁRIOS === */}
        {tab === 'usuarios' && (
          <div className="space-y-6">
            {/* Formulário */}
            <div className="bg-gray-900 border border-white/10 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <Plus className="w-4 h-4 text-indigo-400" /> Criar usuário
              </h2>
              <form onSubmit={handleCriarUsuario} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Nome</label>
                  <input type="text" required value={novoUsuario.nome} onChange={e => setNovoUsuario(p => ({ ...p, nome: e.target.value }))}
                    placeholder="Nome completo"
                    className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">E-mail</label>
                  <input type="email" required value={novoUsuario.email} onChange={e => setNovoUsuario(p => ({ ...p, email: e.target.value }))}
                    placeholder="email@exemplo.com"
                    className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Senha</label>
                  <div className="relative">
                    <input type={showSenha ? 'text' : 'password'} required value={novoUsuario.senha} onChange={e => setNovoUsuario(p => ({ ...p, senha: e.target.value }))}
                      placeholder="Senha de acesso"
                      className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 pr-9 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
                    <button type="button" onClick={() => setShowSenha(p => !p)} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                      {showSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Tipo</label>
                  <select value={novoUsuario.tipo} onChange={e => setNovoUsuario(p => ({ ...p, tipo: e.target.value }))}
                    className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-indigo-500/50">
                    <option value="admin">Admin</option>
                    <option value="comercial">Comercial</option>
                    <option value="terapeuta">Terapeuta</option>
                  </select>
                </div>
                {novoUsuario.tipo === 'terapeuta' && (
                  <div className="sm:col-span-2">
                    <label className="text-xs text-gray-400 block mb-1">Vincular ao terapeuta</label>
                    <select value={novoUsuario.terapeuta_id} onChange={e => setNovoUsuario(p => ({ ...p, terapeuta_id: e.target.value }))}
                      className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-indigo-500/50">
                      <option value="">Selecionar terapeuta...</option>
                      {terapeutas.filter(t => t.ativo).map(t => (
                        <option key={t.id} value={t.id}>{t.nome}</option>
                      ))}
                    </select>
                  </div>
                )}
                {uErro && <p className="sm:col-span-2 text-xs text-red-400">{uErro}</p>}
                {uSucesso && (
                  <p className="sm:col-span-2 text-xs text-green-400 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" />{uSucesso}
                  </p>
                )}
                <div className="sm:col-span-2">
                  <button type="submit" disabled={uSaving}
                    className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 rounded-lg transition-colors">
                    {uSaving ? 'Criando...' : 'Criar usuário'}
                  </button>
                </div>
              </form>
            </div>

            {/* Lista usuários */}
            <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">Usuários do sistema ({usuarios.length})</h2>
                <button onClick={loadUsuarios} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Atualizar</button>
              </div>
              {uLoading ? (
                <div className="flex items-center justify-center h-20">
                  <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5">
                      {['Nome', 'E-mail', 'Tipo', 'Status', 'Criado em', ''].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {usuarios.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-600 text-xs">Nenhum usuário cadastrado</td></tr>
                    ) : usuarios.map(u => (
                      <tr key={u.id} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                        <td className="px-4 py-3 text-white">{u.nome}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{u.email}</td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-indigo-400 capitalize">{u.tipo}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${u.ativo ? 'text-green-500 bg-green-500/10' : 'text-gray-500 bg-gray-500/10'}`}>
                            {u.ativo ? 'Ativo' : 'Inativo'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{fmtDt(u.created_at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <button onClick={() => handleToggleUsuario(u)}
                              className={`text-xs ${u.ativo ? 'text-red-400 hover:text-red-300' : 'text-green-500 hover:text-green-400'} transition-colors`}>
                              {u.ativo ? 'Desativar' : 'Ativar'}
                            </button>
                            <button onClick={() => { setSenhaTarget({ tipo: 'usuario', id: u.id, nome: u.nome }); setNovaSenha(''); setConfirmarSenha(''); setSenhaErro('') }}
                              className="flex items-center gap-1 text-xs text-gray-400 hover:text-indigo-400 transition-colors">
                              <Key className="w-3 h-3" /> Senha
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* === TAB: LOG === */}
        {tab === 'log' && (
          <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Log de atividades (últimas 50)</h2>
              <button onClick={loadLog} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Atualizar</button>
            </div>
            {logLoading ? (
              <div className="flex items-center justify-center h-20">
                <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5">
                      {['Data/hora', 'Usuário', 'Ação', 'Detalhes'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {log.length === 0 ? (
                      <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-600 text-xs">Sem registros</td></tr>
                    ) : log.map(l => (
                      <tr key={l.id} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                        <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{fmtDt(l.created_at)}</td>
                        <td className="px-4 py-3 text-gray-300 text-xs">{l.usuario_email}</td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-indigo-400 bg-indigo-400/10 px-2 py-0.5 rounded">{l.acao}</span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs max-w-xs truncate">
                          {JSON.stringify(l.detalhes)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>
      <MobileNav />

      {/* Modal alterar senha */}
      {senhaTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-sm mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Key className="w-4 h-4 text-indigo-400" /> Alterar senha — {senhaTarget.nome}
              </h3>
              <button onClick={() => setSenhaTarget(null)} className="text-gray-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Nova senha <span className="text-red-400">*</span></label>
                <div className="relative">
                  <input
                    type={showNovaSenha ? 'text' : 'password'}
                    value={novaSenha}
                    onChange={e => setNovaSenha(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 pr-9 text-sm text-white focus:outline-none focus:border-indigo-500/50"
                  />
                  <button type="button" onClick={() => setShowNovaSenha(p => !p)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                    {showNovaSenha ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Confirmar senha <span className="text-red-400">*</span></label>
                <input
                  type="password"
                  value={confirmarSenha}
                  onChange={e => setConfirmarSenha(e.target.value)}
                  placeholder="Repita a nova senha"
                  className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50"
                />
              </div>
              {senhaErro && <p className="text-xs text-red-400">{senhaErro}</p>}
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setSenhaTarget(null)}
                className="flex-1 px-4 py-2 text-sm text-gray-400 bg-gray-800 border border-white/10 rounded-lg">
                Cancelar
              </button>
              <button onClick={handleAlterarSenha} disabled={senhaLoading}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 rounded-lg transition-colors">
                {senhaLoading ? 'Salvando...' : 'Salvar senha'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-[100] bg-gray-800 border border-white/10 text-white text-xs px-4 py-2.5 rounded-full shadow-lg whitespace-nowrap">
          {toast}
        </div>
      )}
    </div>
  )
}
