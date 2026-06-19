'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Sun, Moon, LogOut, ChevronDown } from 'lucide-react'
import { useApp } from '@/contexts/AppContext'
import { logout, getInitials } from '@/lib/auth'
import { useEffect, useState } from 'react'

type NavLink = { href: string; label: string; badge?: number }

const NAV_LINKS: NavLink[] = [
  { href: '/', label: 'Dashboard' },
  { href: '/vendas', label: 'Vendas' },
  { href: '/dre', label: 'DRE' },
  { href: '/fechamentos', label: 'Fechamentos' },
  { href: '/caixa', label: 'Caixa' },
  { href: '/analises', label: 'Análises' },
]

const TERAPEUTAS_NAV: NavLink[] = [
  { href: '/terapeutas', label: 'Dashboard' },
  { href: '/terapeutas/vendas', label: 'Vendas' },
  { href: '/terapeutas/agenda', label: 'Agenda' },
  { href: '/terapeutas/lista', label: 'Terapeutas' },
]

export default function Header() {
  const { user, setUser, selectedProject, setSelectedProject, projects, isDark, toggleTheme } = useApp()
  const pathname = usePathname()
  const router = useRouter()
  const isTerapeutas = pathname.startsWith('/terapeutas')

  const [aprovacoesPendentes, setAprovacoesPendentes] = useState(0)

  useEffect(() => {
    if (!isTerapeutas || user?.role !== 'admin') { setAprovacoesPendentes(0); return }
    fetch('/api/terapeutas/aprovacoes?count=true')
      .then(r => r.ok ? r.json() : { pendentes_count: 0 })
      .then(d => setAprovacoesPendentes(d.pendentes_count ?? 0))
      .catch(() => {})
  }, [isTerapeutas, user?.role, pathname])

  const canSeeAllProjects = user?.role === 'admin' || user?.role === 'financeiro'
  const availableProjects = canSeeAllProjects
    ? projects
    : projects.filter(p => p.id === user?.projetoId)

  function handleLogout() {
    logout()
    setUser(null)
    router.replace('/login')
  }

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-gray-900/80 backdrop-blur-md">
      <div className="max-w-screen-xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          {/* Brand */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
              <span className="text-white text-xs font-bold">SP</span>
            </div>
            <span className="font-semibold text-sm text-white hidden md:block">
              SPR Digital <span className="text-gray-400 font-normal">· Controle de Projetos</span>
            </span>
          </div>

          {/* Nav */}
          <nav className="hidden md:flex items-center gap-1">
            {(isTerapeutas ? [
              ...TERAPEUTAS_NAV,
              ...(user?.role === 'admin' ? [
                { href: '/terapeutas/admin', label: 'Admin' },
                { href: '/terapeutas/aprovacoes', label: 'Aprovações', badge: aprovacoesPendentes },
              ] : []),
            ] : NAV_LINKS).map(link => {
              const active = isTerapeutas
                ? (link.href === '/terapeutas' ? pathname === '/terapeutas' : pathname.startsWith(link.href))
                : pathname === link.href
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`relative flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    active
                      ? 'text-indigo-400'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {link.label}
                  {(link as NavLink).badge != null && (link as NavLink).badge! > 0 && (
                    <span className="ml-0.5 text-[10px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded-full leading-none">
                      {(link as NavLink).badge}
                    </span>
                  )}
                  {active && (
                    <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-indigo-400 rounded-full" />
                  )}
                </Link>
              )
            })}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-2">
            {/* Project selector */}
            <div className="relative">
              <select
                value={isTerapeutas ? 'terapeutas' : selectedProject}
                onChange={e => {
                  const v = e.target.value
                  if (v === 'terapeutas') {
                    router.push('/terapeutas')
                  } else {
                    setSelectedProject(v)
                    router.push('/')
                  }
                }}
                className="appearance-none bg-gray-800 border border-white/10 rounded-lg pl-3 pr-7 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500 cursor-pointer max-w-[160px] truncate"
              >
                {availableProjects.map(p => (
                  <option key={p.id} value={p.id}>{p.nome}</option>
                ))}
                <option value="terapeutas">Atendimentos - Terapeutas</option>
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500 pointer-events-none" />
            </div>

            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {/* Avatar */}
            {user && (
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center">
                  <span className="text-white text-xs font-semibold">{getInitials(user.name)}</span>
                </div>
                <span className="text-xs text-gray-400 hidden lg:block">{user.name}</span>
                <button
                  onClick={handleLogout}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                  title="Sair"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
