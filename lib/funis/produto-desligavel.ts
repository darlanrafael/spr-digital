import { FUNIS, funilDaVenda, produtoDoFunil } from './funis-config'
import type { EstagioEsteira } from './esteira-do-funil'

// Botao "Contar O Resgate - CSP" na tela Performance de Funis (dono 10/11/2026).
// Regra do desligado: como se as vendas do produto desligavel nao existissem.
// Casamento pela regra de sempre (nome ou produto_id + plataforma), via
// funilDaVenda/produtoDoFunil. Ver
// docs/superpowers/specs/2026-11-10-botao-resgate-funis-design.md.

/** O estagio (rotulo da esteira) do produto desligavel do funil, ou null se nao tem. */
export function produtoDesligavelDoFunil(funilId: string): string | null {
  const f = FUNIS.find(x => x.id === funilId)
  return f?.produtos.find(p => p.desligavel)?.estagio ?? null
}

/**
 * Tira toda venda de produto desligavel. Nao olha status nem moeda (reembolso
 * sai junto); nao muda a ordem nem os objetos; devolve uma lista nova.
 */
export function semProdutosDesligaveis<T extends { plataforma: string; produto: string; produto_id?: string | null }>(
  vendas: T[],
): T[] {
  return vendas.filter(v => {
    const f = funilDaVenda(v)
    if (!f) return true
    return !produtoDoFunil(v, f.id)?.desligavel
  })
}

/** Marca `foraDaConta` no degrau do produto desligavel, so quando ele esta desligado. */
export function marcarForaDaConta(
  esteira: EstagioEsteira[],
  funilId: string,
  excluir: boolean,
): (EstagioEsteira & { foraDaConta: boolean })[] {
  const rotulo = excluir ? produtoDesligavelDoFunil(funilId) : null
  return esteira.map(e => ({ ...e, foraDaConta: rotulo !== null && e.rotulo === rotulo }))
}
