// Comissao que entra no "a pagar" e no sweep do fechamento. Comissao travada
// (sessoes.comissao_bloqueada, de uma falta nao aprovada) nunca e paga.
export function ehComissaoPagavel(s: {
  status: string | null
  comissaoPaga?: boolean | null
  comissaoBloqueada?: boolean | null
}): boolean {
  return s.status === 'entregue' && !s.comissaoPaga && !s.comissaoBloqueada
}
