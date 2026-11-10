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
