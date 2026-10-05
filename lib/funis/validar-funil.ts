export type FunilEntrada = { nome: string; termos_campanha: string[]; produtos: { plataforma: string; produto_id: string }[] }

export function validarFunil(e: FunilEntrada): { ok: true; funil: FunilEntrada } | { ok: false; erro: string } {
  const nome = (e.nome ?? '').trim()
  if (!nome) return { ok: false, erro: 'O funil precisa de um nome.' }
  const termos = (e.termos_campanha ?? []).map(t => t.trim()).filter(Boolean)
  const produtos = (e.produtos ?? []).filter(p => p.plataforma && p.produto_id)
  return { ok: true, funil: { nome, termos_campanha: termos, produtos } }
}
