'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/performance-funis/dashboard', label: 'Dashboard' },
  { href: '/performance-funis/funis', label: 'Funis' },
  { href: '/performance-funis/produtos', label: 'Produtos' },
]

export default function PerfFunisTabs() {
  const pathname = usePathname()
  return (
    <div className="flex gap-1 border-b border-white/10 mb-4">
      {TABS.map(t => {
        const active = pathname === t.href || pathname.startsWith(t.href)
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              active ? 'border-indigo-500 text-white' : 'border-transparent text-[#9CA3AF] hover:text-white'
            }`}
          >
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}
