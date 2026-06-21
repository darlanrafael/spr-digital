'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import ProtectedRoute from '@/components/ProtectedRoute'
import { getSession } from '@/lib/auth'

type TerapeutaSession = {
  id: string
  nome: string
  email: string
  tipo: string
  terapeuta_id: string | null
}

export default function TerapeutasLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [hasTerapeutaSession, setHasTerapeutaSession] = useState(false)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    if (pathname === '/terapeutas/login') { setChecked(true); return }

    // Admin session always takes priority — ignore terapeutas_session completely
    if (getSession()) { setChecked(true); return }

    const raw = localStorage.getItem('terapeutas_session')
    if (!raw) { setChecked(true); return }

    try {
      const session = JSON.parse(raw) as TerapeutaSession
      setHasTerapeutaSession(true)

      if (session.tipo === 'terapeuta' && session.terapeuta_id) {
        const allowed = `/terapeutas/${session.terapeuta_id}`
        if (!pathname.startsWith(allowed)) {
          router.replace(allowed)
          return
        }
      }
    } catch { /* ignore malformed session */ }

    setChecked(true)
  }, [pathname, router])

  if (pathname === '/terapeutas/login') return <>{children}</>
  if (!checked) return null
  if (hasTerapeutaSession) return <>{children}</>
  return <ProtectedRoute>{children}</ProtectedRoute>
}
