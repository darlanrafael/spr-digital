'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import ProtectedRoute from '@/components/ProtectedRoute'

export default function TerapeutasLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [hasTerapeutaSession, setHasTerapeutaSession] = useState(false)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    setHasTerapeutaSession(!!localStorage.getItem('terapeutas_session'))
    setChecked(true)
  }, [pathname])

  if (pathname === '/terapeutas/login') return <>{children}</>
  if (!checked) return null
  if (hasTerapeutaSession) return <>{children}</>
  return <ProtectedRoute>{children}</ProtectedRoute>
}
