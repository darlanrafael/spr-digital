'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, ShoppingCart, BarChart2, FileText, Wallet, TrendingUp, Calendar, Users, Heart } from 'lucide-react'
import { useApp } from '@/contexts/AppContext'

const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/vendas', label: 'Vendas', icon: ShoppingCart },
  { href: '/dre', label: 'DRE', icon: BarChart2 },
  { href: '/fechamentos', label: 'Fechamentos', icon: FileText },
  { href: '/caixa', label: 'Caixa', icon: Wallet },
  { href: '/analises', label: 'Análises', icon: TrendingUp },
]

const TERAPEUTAS_NAV = [
  { href: '/terapeutas', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/terapeutas/vendas', label: 'Vendas', icon: ShoppingCart },
  { href: '/terapeutas/agenda', label: 'Agenda', icon: Calendar },
  { href: '/terapeutas/lista', label: 'Terapeutas', icon: Users },
]

export default function MobileNav() {
  const pathname = usePathname()
  const { user } = useApp()
  const isTerapeutas = pathname.startsWith('/terapeutas')

  const navItems = isTerapeutas
    ? [
        ...TERAPEUTAS_NAV,
        ...(user?.role === 'admin' ? [{ href: '/terapeutas/admin', label: 'Admin', icon: Heart }] : []),
      ]
    : NAV

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-gray-900/95 backdrop-blur-md">
      <div className="flex">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = isTerapeutas
            ? (href === '/terapeutas' ? pathname === '/terapeutas' : pathname.startsWith(href))
            : pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] transition-colors ${
                active ? 'text-indigo-400' : 'text-gray-500'
              }`}
            >
              <Icon className="w-5 h-5" />
              {label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
