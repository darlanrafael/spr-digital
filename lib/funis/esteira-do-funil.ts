import { FUNIS, produtoDoFunil } from './funis-config'

const cent = (n: number) => Math.round(n * 100) / 100

/** O minimo que uma venda precisa pra entrar na esteira de um funil. */
export type VendaParaEsteira = {
  plataforma: string
  produto: string
  produto_id?: string | null
  status: string
  valor_pago_cliente: number
}

/** Um degrau da esteira (value ladder) do funil. */
export type EstagioEsteira = {
  /** Rotulo do estagio (a linha do funil de produtos). */
  rotulo: string
  /** Vendas aprovadas do periodo que caem neste estagio (0 se nenhuma). */
  vendas: number
  /** Faturamento bruto do estagio no periodo (0 se nenhuma venda). */
  faturamento: number
}

/**
 * Agrega as vendas do periodo na ESTEIRA (value ladder) do funil. Os estagios sao
 * FIXOS (FunilConfig.esteira) e vem SEMPRE todos, na ordem da boca pro fim, mesmo
 * zerados - o funil fica montado com ou sem venda (dono 23/10/2026). Order bumps
 * compartilham o mesmo estagio, entao somam numa linha so.
 *
 * Puro: recebe as vendas (ja do periodo), nao acessa banco. Conta so 'aprovada';
 * casa cada venda ao estagio via produtoDoFunil + ProdutoDoFunil.estagio. Ver item
 * 119 do spr-digital.md.
 */
export function agregarEsteira(vendas: VendaParaEsteira[], funilId: string): EstagioEsteira[] {
  const f = FUNIS.find(x => x.id === funilId)
  if (!f) return []
  const acc = new Map<string, { vendas: number; faturamento: number }>()
  for (const rotulo of f.esteira) acc.set(rotulo, { vendas: 0, faturamento: 0 })
  for (const v of vendas) {
    if (v.status !== 'aprovada') continue
    const p = produtoDoFunil(v, funilId)
    if (!p?.estagio) continue
    const cur = acc.get(p.estagio)
    if (!cur) continue
    cur.vendas++
    cur.faturamento += v.valor_pago_cliente
  }
  return f.esteira.map(rotulo => {
    const cur = acc.get(rotulo)!
    return { rotulo, vendas: cur.vendas, faturamento: cent(cur.faturamento) }
  })
}
