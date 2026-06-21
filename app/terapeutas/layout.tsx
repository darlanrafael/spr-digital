'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
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
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    // Login page is always public — do NOT set checked here so that when
    // the user navigates away after logging in, checked stays false and
    // the spinner shows until the new effect run validates the session.
    if (pathname === '/terapeutas/login') return

    // Admin session always has full access — no terapeuta restrictions
    if (getSession()) { setChecked(true); return }

    const raw = localStorage.getItem('terapeutas_session')
    if (!raw) {
      // No session at all → terapeuta login, not main /login
      router.replace('/terapeutas/login')
      return
    }

    try {
      const session = JSON.parse(raw) as TerapeutaSession

      if (session.tipo === 'terapeuta' && session.terapeuta_id) {
        const allowed = `/terapeutas/${session.terapeuta_id}`
        if (!pathname.startsWith(allowed)) {
          router.replace(allowed)
          return
        }
      }
    } catch {
      router.replace('/terapeutas/login')
      return
    }

    setChecked(true)
  }, [pathname, router])

  // Login page always renders — checked state is irrelevant here
  if (pathname === '/terapeutas/login') return <>{children}</>

  // Show spinner while validating session or during redirect
  if (!checked) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return <>{children}</>
}
