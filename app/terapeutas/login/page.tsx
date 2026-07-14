'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Sem isso a Vercel pode servir um bundle antigo do CDN por um tempo depois
// do deploy — crítico numa tela de login/redirecionamento.
export const dynamic = 'force-dynamic'

export default function TerapeutasLogin() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setLoading(true)
    try {
      const res = await fetch('/api/terapeutas/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), senha }),
      })
      const json = await res.json()
      if (!res.ok) { setErro(json.error ?? 'Credenciais inválidas'); return }
      localStorage.setItem('terapeutas_session', JSON.stringify(json.usuario))
      await new Promise(r => setTimeout(r, 100))
      if (json.usuario.tipo === 'terapeuta' && json.usuario.terapeuta_id) {
        router.push(`/terapeutas/${json.usuario.terapeuta_id}`)
      } else {
        // Comercial/admin escolhe qual terapeuta ver — cai na lista, não
        // direto na ferramenta antiga de vendas.
        router.push('/terapeutas/lista')
      }
    } catch {
      setErro('Erro de conexão. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center">
            <span className="text-white text-sm font-bold">SP</span>
          </div>
          <div>
            <p className="text-white font-semibold text-sm leading-tight">SPR Digital</p>
            <p className="text-gray-400 text-xs leading-tight">Área do Terapeuta</p>
          </div>
        </div>

        <div className="bg-gray-900 border border-white/10 rounded-xl p-6">
          <h1 className="text-base font-semibold text-white mb-1">Entrar</h1>
          <p className="text-xs text-gray-400 mb-5">Acesse seu painel de sessões</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs text-gray-400 block mb-1">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                required
                className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/60"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Senha</label>
              <input
                type="password"
                value={senha}
                onChange={e => setSenha(e.target.value)}
                autoComplete="current-password"
                required
                className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/60"
              />
            </div>
            {erro && (
              <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">{erro}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 rounded-lg transition-colors"
            >
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
