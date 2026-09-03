// Como a tela de Aprovações rotula cada linha de `ocorrencias_pacote`.
//
// Está aqui, e não no JSX, por dois motivos concretos:
//
//   1. O sinal de `diferenca` decide entre "Faltaram" e "Entraram a mais". Um
//      sinal invertido dentro de um ternário no meio do JSX não é revisado por
//      ninguém e diz ao CEO o contrário do que aconteceu com o dinheiro.
//   2. O `check` da migração de `ocorrencias_pacote` só aceita três tipos, e o
//      desfazer de uma ligação reusa `compra_separada`. Sem distinguir, o CEO
//      lia "Compras separadas" e concluía que foi resposta do comercial no
//      agendamento, quando na verdade alguém desfez uma junção já registrada -
//      e, como a lista vem em ordem decrescente, o desfazer aparece ACIMA da
//      junção que ele anula, reforçando a leitura errada.

/**
 * Prefixo que marca a ocorrência como DESFAZER, não como resposta do comercial.
 *
 * Vive numa constante porque quem grava (a rota) e quem lê (a tela) precisam
 * concordar, e a coluna de tipo não pode ganhar valor novo sem migração.
 */
export const MARCA_DESFAZER = 'Compra desligada do pacote'

export type OcorrenciaDePacote = {
  tipo: string
  justificativa?: string | null
}

export type RotuloDaOcorrencia = {
  texto: string
  /** Qual das quatro aparências a tela deve usar. */
  cor: 'juntadas' | 'divergente' | 'separadas' | 'desfeita'
}

export function rotuloDaOcorrencia(o: OcorrenciaDePacote): RotuloDaOcorrencia {
  if (o.tipo === 'mesmo_pacote') return { texto: 'Compras juntadas', cor: 'juntadas' }
  if (o.tipo === 'valor_divergente') return { texto: 'Valor divergente', cor: 'divergente' }
  if (o.tipo === 'compra_separada') {
    return (o.justificativa ?? '').startsWith(MARCA_DESFAZER)
      ? { texto: 'Ligação desfeita', cor: 'desfeita' }
      : { texto: 'Compras separadas', cor: 'separadas' }
  }
  // Tipo desconhecido não pode se disfarçar de "Compras separadas": se a
  // migração ganhar um valor novo e a tela não souber, é melhor o CEO ver que
  // há algo que ela não entende do que ler um rótulo errado com confiança.
  return { texto: o.tipo, cor: 'separadas' }
}

/** O texto da diferença de valor, com o sinal na direção certa. */
export function textoDaDiferenca(diferenca: number | null | undefined): string | null {
  if (diferenca == null || diferenca === 0) return null
  const fmt = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  // `diferenca > 0` é o que FALTA para fechar o preço do pacote: o paciente
  // pagou menos do que a oferta vale.
  return diferenca > 0 ? `Faltaram ${fmt(diferenca)}` : `Entraram ${fmt(-diferenca)} a mais`
}
