'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, Lock, Mail } from 'lucide-react'
import { login, getSession } from '@/lib/auth'
import { useApp } from '@/contexts/AppContext'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { setUser, setSelectedProject, reloadData } = useApp()
  const router = useRouter()

  useEffect(() => {
    if (getSession()) router.replace('/')
  }, [router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    await new Promise(r => setTimeout(r, 400))
    const user = login(email.trim(), password)
    if (!user) {
      setLoading(false)
      setError('E-mail ou senha incorretos')
      return
    }
    setUser(user)
    // Login navega via router.replace (client-side) — o AppProvider já está
    // montado desde antes do login e seu efeito de carregamento inicial só
    // roda uma vez, sem sessão. Sem chamar reloadData aqui, a tela pós-login
    // ficava sem nenhum dado real até um F5 manual.
    const projId = user.role === 'gestor' && user.projetoId ? user.projetoId : 'proj_1'
    if (user.role === 'gestor' && user.projetoId) setSelectedProject(user.projetoId)
    await reloadData(projId)
    setLoading(false)
    router.replace('/')
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center mb-4 shadow-lg shadow-indigo-600/30">
            <span className="text-white font-bold text-lg">SP</span>
          </div>
          <h1 className="text-xl font-bold text-white">SPR Digital</h1>
          <p className="text-sm text-gray-400 mt-1">Controle de Projetos</p>
        </div>

        {/* Card */}
        <div className="bg-gray-900 border border-white/10 rounded-2xl p-6 shadow-2xl">
          <h2 className="text-sm font-semibold text-white mb-5">Entrar na sua conta</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">E-mail</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  required
                  className="w-full bg-gray-800 border border-white/10 rounded-lg pl-9 pr-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Senha</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full bg-gray-800 border border-white/10 rounded-lg pl-9 pr-10 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-semibold text-sm py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : 'Entrar'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-600 mt-6">
          SPR Digital © 2026
        </p>
      </div>
    </div>
  )
}
