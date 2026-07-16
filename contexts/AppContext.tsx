'use client'

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { User, Sale, CostsData, Closing, CashflowEntry, Project, Product, FixedCost, VariableCost } from '@/types'
import { getSession } from '@/lib/auth'
import { getSupabaseClient } from '@/lib/supabase'
import {
  getProjects, getProducts, getSales, getAllCosts,
  getClosings, getCashflow,
} from '@/lib/services'

// Fallbacks JSON (offline / sem dados no Supabase)
import salesFallback from '@/data/sales.json'
import costsFallback from '@/data/costs.json'
import closingsFallback from '@/data/closings.json'
import cashflowFallback from '@/data/cashflow.json'
import projectsFallback from '@/data/projects.json'
import productsFallback from '@/data/products.json'

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
  isLoading: boolean
  lastLoadedAt: Date | null
  reloadData: (projectId?: string) => Promise<void>
}

const AppContext = createContext<AppContextType | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [selectedProject, setSelectedProject] = useState<string>('proj_1')
  const [isDark, setIsDark] = useState(true)
  const [isLoading, setIsLoading] = useState(true)

  const [sales, setSales] = useState<Sale[]>([])
  const [costs, setCosts] = useState<CostsData>({ fixos: [], variaveis: [], metaAds: [] })
  const [closings, setClosings] = useState<Closing[]>([])
  const [cashflow, setCashflow] = useState<CashflowEntry[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null)

  const reloadData = useCallback(async (projectId?: string) => {
    const projId = projectId ?? selectedProject
    setIsLoading(true)
    try {
      const [proj, prod, s, c, cl, cf] = await Promise.all([
        getProjects(),
        getProducts(projId),
        getSales(projId, undefined, undefined, ['aprovada', 'reembolsada', 'chargeback', 'cancelada', 'em_protesto']),
        getAllCosts(projId),
        getClosings(projId),
        getCashflow(projId),
      ])
      // Os dados mock só devem substituir o resultado quando o Supabase não
      // está configurado (getSupabaseClient() null) — nunca quando a consulta
      // funcionou e retornou uma lista genuinamente vazia. Antes, uma lista
      // vazia real (ex: nenhum fechamento feito ainda) era tratada igual a
      // "Supabase indisponível" e o app injetava dado de exemplo fictício
      // (ex: reembolso fake do "Bruno Ferreira") num fechamento real.
      const semSupabase = !getSupabaseClient()
      setProjects(semSupabase && proj.length === 0 ? projectsFallback as Project[] : proj)
      setProducts(semSupabase && prod.length === 0 ? productsFallback as Product[] : prod)
      setSales(semSupabase && s.length === 0 ? salesFallback as Sale[] : s)
      setCosts({
        fixos: semSupabase && c.fixos.length === 0 ? costsFallback.fixos as FixedCost[] : c.fixos,
        variaveis: semSupabase && c.variaveis.length === 0 ? costsFallback.variaveis as VariableCost[] : c.variaveis,
        metaAds: semSupabase && c.metaAds.length === 0 ? costsFallback.metaAds : c.metaAds,
      })
      setClosings(semSupabase && cl.length === 0 ? closingsFallback as unknown as Closing[] : cl)
      setCashflow(semSupabase && cf.length === 0 ? cashflowFallback as CashflowEntry[] : cf)
      setLastLoadedAt(new Date())
    } catch (err) {
      console.error('[AppContext] Erro ao carregar Supabase, usando fallback JSON:', err)
      setProjects(projectsFallback as Project[])
      setProducts(productsFallback as Product[])
      setSales(salesFallback as Sale[])
      setCosts(costsFallback as CostsData)
      setClosings(closingsFallback as unknown as Closing[])
      setCashflow(cashflowFallback as CashflowEntry[])
    } finally {
      setIsLoading(false)
    }
  }, [selectedProject])

  useEffect(() => {
    const session = getSession()
    if (session) {
      setUser(session)
      const projId = session.role === 'gestor' && session.projetoId
        ? session.projetoId
        : 'proj_1'
      if (session.role === 'gestor' && session.projetoId) {
        setSelectedProject(session.projetoId)
      }
      void reloadData(projId)
    } else {
      setIsLoading(false)
    }

    const saved = localStorage.getItem('spr_theme')
    if (saved === 'light') setIsDark(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const root = document.documentElement
    if (isDark) root.classList.add('dark')
    else root.classList.remove('dark')
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
        isLoading, lastLoadedAt, reloadData,
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
