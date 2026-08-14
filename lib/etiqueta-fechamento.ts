// Paleta da etiqueta do fechamento.
//
// Cores fixas e nomeadas em vez de hex livre: o valor gravado no banco é a
// chave ("azul"), não a classe do Tailwind. Assim o visual pode mudar sem
// precisar reescrever dado, e o Tailwind consegue enxergar as classes no
// build (classe montada por concatenação seria removida no purge).

export const CORES_ETIQUETA = {
  azul:  { nome: 'Azul',   classe: 'bg-blue-500/20 text-blue-300 border-blue-500/40' },
  verde: { nome: 'Verde',  classe: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
  roxo:  { nome: 'Roxo',   classe: 'bg-violet-500/20 text-violet-300 border-violet-500/40' },
  ambar: { nome: 'Âmbar',  classe: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  rosa:  { nome: 'Rosa',   classe: 'bg-pink-500/20 text-pink-300 border-pink-500/40' },
  ciano: { nome: 'Ciano',  classe: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' },
  amarelo:  { nome: 'Amarelo',  classe: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40' },
  laranja:  { nome: 'Laranja',  classe: 'bg-orange-500/20 text-orange-300 border-orange-500/40' },
  vermelho: { nome: 'Vermelho', classe: 'bg-red-500/20 text-red-300 border-red-500/40' },
} as const

export type CorEtiqueta = keyof typeof CORES_ETIQUETA

export const COR_PADRAO: CorEtiqueta = 'azul'

/** Classe visual da cor gravada. Cor desconhecida ou ausente cai no padrão. */
export function classeEtiqueta(cor?: string | null): string {
  const c = (cor ?? '') as CorEtiqueta
  return (CORES_ETIQUETA[c] ?? CORES_ETIQUETA[COR_PADRAO]).classe
}

export function ehCorValida(cor?: string | null): cor is CorEtiqueta {
  return !!cor && cor in CORES_ETIQUETA
}
