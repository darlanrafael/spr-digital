'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useApp } from '@/contexts/AppContext'
import { getSession } from '@/lib/auth'

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, setUser } = useApp()
  const router = useRouter()
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    const session = getSession()
    if (session) {
      setUser(session)
      setChecked(true)
    } else {
      router.replace('/login')
    }
  }, [router, setUser])

  if (!checked || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return <>{children}</>
}
