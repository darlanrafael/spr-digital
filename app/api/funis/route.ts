import { NextRequest, NextResponse } from 'next/server'
import { lerIdentidade, podeVerFunis } from '@/lib/identidade-da-chamada'
import { FUNIS } from '@/lib/funis/funis-config'

export const dynamic = 'force-dynamic'

function guard(req: NextRequest) {
  const quem = lerIdentidade(req)
  if (!quem) return { status: 401 as const, error: 'Você precisa entrar no sistema.' }
  if (!podeVerFunis(quem)) return { status: 403 as const, error: 'Só administradores e sócios do DRE podem ver os funis.' }
  return null
}

// A lista dos funis agora é CONFIG NO CÓDIGO (decisão do dono 12-21/10/2026):
// lib/funis/funis-config.ts. Nada de tabela/cadastro. Ver item 114 do
// spr-digital.md. Esta rota só expõe a lista para as abas do dashboard.
export async function GET(req: NextRequest) {
  const g = guard(req); if (g) return NextResponse.json({ error: g.error }, { status: g.status })
  return NextResponse.json(
    FUNIS.map(f => ({ id: f.id, nome: f.nome, produtoLabel: f.produtoLabel })),
  )
}

// Cadastro desativado de propósito: adicionar/mudar funil é editar o config no
// código + deploy (igual readequações, ofertas do diagnóstico, mentoria).
export async function POST() {
  return NextResponse.json(
    { error: 'O cadastro de funis é feito no código (lib/funis/funis-config.ts), não pela tela.' },
    { status: 405 },
  )
}
