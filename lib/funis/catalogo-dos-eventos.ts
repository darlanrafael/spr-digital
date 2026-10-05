import { produtoDoEventoHubla, produtoDoEventoKiwify, type ProdutoDoEvento } from '@/lib/produto-do-evento'

export type LinhaCatalogo = { plataforma: string; produto_id: string; nome_exibicao: string; nomes: string[] }

function extrair(plataforma: string, payload: Record<string, unknown>): ProdutoDoEvento | null {
  if (plataforma === 'hubla') return produtoDoEventoHubla(payload)
  if (plataforma === 'kiwify') return produtoDoEventoKiwify(payload)
  return null
}

export function montarCatalogo(
  eventos: { plataforma: string; payload: Record<string, unknown> }[],
): LinhaCatalogo[] {
  // chave -> { nomes em ordem de 1ª aparição, contagem por nome }
  const mapa = new Map<string, { plataforma: string; produto_id: string; nomes: string[]; freq: Map<string, number> }>()
  for (const ev of eventos) {
    const p = extrair(ev.plataforma, ev.payload)
    if (!p) continue
    const chave = `${p.plataforma}|${p.produto_id}`
    let linha = mapa.get(chave)
    if (!linha) { linha = { plataforma: p.plataforma, produto_id: p.produto_id, nomes: [], freq: new Map() }; mapa.set(chave, linha) }
    if (!linha.nomes.includes(p.nome)) linha.nomes.push(p.nome)
    linha.freq.set(p.nome, (linha.freq.get(p.nome) ?? 0) + 1)
  }
  return [...mapa.values()].map(l => ({
    plataforma: l.plataforma,
    produto_id: l.produto_id,
    nomes: l.nomes,
    nome_exibicao: [...l.freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? l.nomes[0] ?? '',
  }))
}
