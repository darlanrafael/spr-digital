import type { CacheCurto } from './cache-curto'
import type { RelatoMeta } from '../meta'

// Cada pedaco da Meta na rota de Funis passa por aqui (dono 10/11/2026, Task 5):
// um relato novo por busca, resposta { linhas, falhou } e so o completo fica no
// cache de 2 min (o incompleto e devolvido para a tela avisar, sem ser guardado).

export async function buscarMetaNoCache<T>(
  cache: CacheCurto,
  key: string,
  bust: boolean,
  buscar: (relato: RelatoMeta) => Promise<T[]>,
): Promise<{ linhas: T[]; falhou: boolean }> {
  return cache.get(key, async () => {
    const relato: RelatoMeta = { falhas: 0 }
    const linhas = await buscar(relato)
    return { linhas, falhou: relato.falhas > 0 }
  }, bust, v => !v.falhou)
}

/**
 * Roda a busca em cada conta da Meta e junta as linhas na ordem das contas.
 * Nenhuma conta configurada (META_AD_ACCOUNT_IDS vazio) conta 1 falha: sem
 * isso o funil mostrava investimento R$ 0,00 como completo (revisao final 13/11).
 */
export async function emCadaConta<T>(
  contas: string[],
  relato: RelatoMeta,
  buscar: (conta: string) => Promise<T[]>,
): Promise<T[]> {
  if (contas.length === 0) { relato.falhas++; return [] }
  return (await Promise.all(contas.map(buscar))).flat()
}
