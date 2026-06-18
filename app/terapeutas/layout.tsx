'use client'

import ProtectedRoute from '@/components/ProtectedRoute'

export default function TerapeutasLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute>{children}</ProtectedRoute>
}
