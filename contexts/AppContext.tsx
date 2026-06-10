'use client'

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { User, Sale, CostsData, Closing, CashflowEntry, Project, Product } from '@/types'
import { getSession } from '@/lib/auth'
import salesRaw from '@/data/sales.json'
import costsRaw from '@/data/costs.json'
import closingsRaw from '@/data/closings.json'
import cashflowRaw from '@/data/cashflow.json'
import projectsRaw from '@/data/projects.json'
import productsRaw from '@/data/products.json'

interface AppContextType {
  user: User | null
  setUser: (u: User | null) => void
  selectedProject: string
  setSelectedProject: (id: string) => void
  projects: Project[]
  products: Product[]
  sales: Sale[]
  setSales: React.Dispatch<React.SetStateAction<Sale[]>>
  costs: CostsData
  setCosts: React.Dispatch<React.SetStateAction<CostsData>>
  closings: Closing[]
  setClosings: React.Dispatch<React.SetStateAction<Closing[]>>
  cashflow: CashflowEntry[]
  setCashflow: React.Dispatch<React.SetStateAction<CashflowEntry[]>>
  isDark: boolean
  toggleTheme: () => void
}

const AppContext = createContext<AppContextType | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [selectedProject, setSelectedProject] = useState<string>('proj_1')
  const [isDark, setIsDark] = useState(true)
  const [sales, setSales] = useState<Sale[]>(salesRaw as Sale[])
  const [costs, setCosts] = useState<CostsData>(costsRaw as CostsData)
  const [closings, setClosings] = useState<Closing[]>(closingsRaw as Closing[])
  const [cashflow, setCashflow] = useState<CashflowEntry[]>(cashflowRaw as CashflowEntry[])
  const projects: Project[] = projectsRaw as Project[]
  const products: Product[] = productsRaw as Product[]

  useEffect(() => {
    const session = getSession()
    if (session) {
      setUser(session)
      if (session.role === 'gestor' && session.projetoId) {
        setSelectedProject(session.projetoId)
      }
    }
    const saved = localStorage.getItem('spr_theme')
    if (saved === 'light') setIsDark(false)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (isDark) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    localStorage.setItem('spr_theme', isDark ? 'dark' : 'light')
  }, [isDark])

  const toggleTheme = useCallback(() => setIsDark(p => !p), [])

  return (
    <AppContext.Provider
      value={{
        user, setUser,
        selectedProject, setSelectedProject,
        projects, products,
        sales, setSales,
        costs, setCosts,
        closings, setClosings,
        cashflow, setCashflow,
        isDark, toggleTheme,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
