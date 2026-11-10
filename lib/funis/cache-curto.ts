// Cache curto em memoria usado pela route de funis. A Meta e lenta (5 contas),
// entao o resultado de cada busca fica guardado por um TTL curto: navegar entre
// funis/periodos repetidos fica instantaneo.
//
// O botao "Atualizar" da tela precisa trazer o dado DAQUELE momento. Ao ser
// acionado, a route passa bust=true e a busca IGNORA o cache (reexecuta e grava
// o valor fresco). Ver item 118 do spr-digital.md.

export type CacheCurto = {
  /**
   * Serve do cache dentro do TTL. bust=true pula o cache: reexecuta e atualiza.
   * guardar(v) false = devolve v mas nao guarda (e nao apaga o valor bom ja
   * guardado): resultado incompleto da Meta nao fica 2 min no cache (10/11/2026).
   */
  get: <T>(key: string, fn: () => Promise<T>, bust?: boolean, guardar?: (v: T) => boolean) => Promise<T>
}

/** `agora` injetavel so pra teste (TTL deterministico, sem sleep). */
export function criarCacheCurto(ttl: number, agora: () => number = Date.now): CacheCurto {
  const cache = new Map<string, { t: number; v: unknown }>()
  return {
    async get<T>(key: string, fn: () => Promise<T>, bust = false, guardar?: (v: T) => boolean): Promise<T> {
      if (!bust) {
        const hit = cache.get(key)
        if (hit && agora() - hit.t < ttl) return hit.v as T
      }
      const v = await fn()
      if (guardar && !guardar(v)) return v
      cache.set(key, { t: agora(), v })
      return v
    },
  }
}
