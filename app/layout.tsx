import type { Metadata } from 'next'
import './globals.css'
import { AppProvider } from '@/contexts/AppContext'

export const metadata: Metadata = {
  title: 'SPR Digital · Controle de Projetos',
  description: 'Dashboard financeiro de agência de infoprodutos',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark">
      <body className="bg-gray-950 text-white min-h-screen">
        <AppProvider>
          {children}
        </AppProvider>
      </body>
    </html>
  )
}
