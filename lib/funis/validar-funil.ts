export type FunilEntrada = { nome: string; termos_campanha: string[]; produtos: { plataforma: string; produto_id: string }[] }

export function validarFunil(e: unknown): { ok: true; funil: FunilEntrada } | { ok: false; erro: string } {
  if (typeof e !== 'object' || e === null) return { ok: false, erro: 'Dados do funil inválidos.' }
  const b = e as Record<string, unknown>
  const nome = (typeof b.nome === 'string' ? b.nome : '').trim()
  if (!nome) return { ok: false, erro: 'O funil precisa de um nome.' }
  const termos = (Array.isArray(b.termos_campanha) ? b.termos_campanha : [])
    .filter((t): t is string => typeof t === 'string')
    .map(t => t.trim())
    .filter(Boolean)
  const vistos = new Set<string>()
  const produtos: { plataforma: string; produto_id: string }[] = []
  for (const p of Array.isArray(b.produtos) ? b.produtos : []) {
    if (typeof p !== 'object' || p === null) continue
    const { plataforma, produto_id } = p as Record<string, unknown>
    if (typeof plataforma !== 'string' || typeof produto_id !== 'string' || !plataforma || !produto_id) continue
    const chave = JSON.stringify([plataforma, produto_id])
    if (vistos.has(chave)) continue
    vistos.add(chave)
    produtos.push({ plataforma, produto_id })
  }
  return { ok: true, funil: { nome, termos_campanha: termos, produtos } }
}
