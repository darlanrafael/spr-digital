'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/auth'

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const [authorized, setAuthorized] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const session = getSession()
    if (session) {
      setAuthorized(true)
    } else {
      router.replace('/login')
    }
  }, [router])

  if (!authorized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return <>{children}</>
}
