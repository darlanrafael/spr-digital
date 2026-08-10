'use client'

import { useState, useEffect, useRef } from 'react'
import { Eye, EyeOff, X, Lock } from 'lucide-react'

interface SenhaModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (senha: string) => void
  titulo: string
  descricao: string
  loading?: boolean
  erro?: string
  /**
   * Usuário autorizado a agir sem digitar senha (tem token de sessão válido
   * e `dispensa_senha_nas_acoes` ligado). O modal não aparece: confirma
   * sozinho com senha vazia, e quem autentica no servidor é o token que a
   * tela manda no body.
   *
   * Se a ação voltar com erro (token expirado, por exemplo), o modal aparece
   * normalmente com a mensagem — a pessoa digita a senha e segue. Sem esse
   * fallback o erro ficaria invisível, já que o modal está escondido.
   */
  dispensarSenha?: boolean
}

export default function SenhaModal({
  isOpen,
  onClose,
  onConfirm,
  titulo,
  descricao,
  loading = false,
  erro,
  dispensarSenha = false,
}: SenhaModalProps) {
  const [senha, setSenha] = useState('')
  const [mostrar, setMostrar] = useState(false)
  const jaConfirmou = useRef(false)

  const dispensar = dispensarSenha && !erro

  useEffect(() => {
    if (!isOpen) {
      setSenha('')
      setMostrar(false)
      jaConfirmou.current = false
    }
  }, [isOpen])

  useEffect(() => {
    // A trava de ref é obrigatória: sem ela o StrictMode do dev dispara o
    // efeito duas vezes e a ação acontece em dobro (dois compromissos, duas
    // conclusões). Zerada no efeito acima quando o modal fecha.
    if (isOpen && dispensar && !loading && !jaConfirmou.current) {
      jaConfirmou.current = true
      onConfirm('')
    }
    // onConfirm muda de identidade a cada render do pai — de propósito fora
    // das dependências, senão o efeito re-dispara sem parar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, dispensar, loading])

  if (!isOpen) return null
  if (dispensar) return null

  function handleConfirm() {
    if (!senha.trim() || loading) return
    onConfirm(senha)
  }

  function handleClose() {
    if (loading) return
    setSenha('')
    setMostrar(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl">
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-600/20 flex items-center justify-center shrink-0">
              <Lock className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">{titulo}</h3>
              <p className="text-xs text-gray-400 mt-0.5">{descricao}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={loading}
            className="text-gray-500 hover:text-white transition-colors ml-4 disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="relative mb-3">
          <input
            type={mostrar ? 'text' : 'password'}
            value={senha}
            onChange={e => setSenha(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleConfirm()}
            placeholder="Digite sua senha"
            autoFocus
            disabled={loading}
            className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2.5 pr-10 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500/50 transition-colors disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => setMostrar(v => !v)}
            disabled={loading}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-40"
          >
            {mostrar ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        {/* whitespace-pre-line: o conflito de agenda lista uma data por linha
            quando várias sessões do pacote batem em horário ocupado. */}
        {erro && (
          <p className="text-red-400 text-xs mb-3 whitespace-pre-line">{erro}</p>
        )}

        <div className="flex gap-3 mt-4">
          <button
            onClick={handleClose}
            disabled={loading}
            className="flex-1 px-4 py-2 text-sm text-gray-400 bg-gray-800 hover:bg-gray-700 border border-white/10 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading || !senha.trim()}
            className="flex-1 px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-500 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Verificando...' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}
