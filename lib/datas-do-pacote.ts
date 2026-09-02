import { MINUTOS_MINIMOS_ENTRE_SESSOES } from './diagnostico-guiado'

// Validação das datas que o comercial digitou, antes de qualquer escrita.
//
// Vive fora da rota pelo mesmo motivo de lib/reagendamento-total.ts e
// lib/aprovacao-reembolso.ts: decisão dentro de um handler é decisão que
// nenhum teste alcança, e foi exatamente assim que passou o defeito em que
// limpar um campo de data derrubava a tela inteira. `npm test` roda só
// `lib/*.test.ts`.
//
// Para produto que NÃO é Diagnóstico só valem as duas primeiras regras: ali as
// datas sempre foram livres, e apertar mais recusaria agendamento que hoje
// funciona.

export type ProblemaDatas =
  | { tipo: 'ano_invalido'; sessoes: number[] }
  | { tipo: 'fora_de_ordem'; sessoes: number[] }
  | { tipo: 'longe_demais'; sessoes: number[] }
  | { tipo: 'sobrepostas'; sessoes: number[] }

/** Um ano corrido, com folga de ano bissexto. Pacote de terapia não passa disso. */
const UM_ANO_MS = 366 * 24 * 60 * 60 * 1000

export function validarDatasDoPacote({
  datasISO,
  ehDiagnostico,
}: {
  datasISO: string[]
  ehDiagnostico: boolean
}): ProblemaDatas | null {
  const ms = datasISO.map(iso => new Date(iso).getTime())

  // Ano fora da faixa. Cobre os dois erros que chegam aqui: campo em branco,
  // que `brasiliaLocalToISO` transforma em 01/01/2000 sem lançar (o parser
  // legado do V8 aceita a string incompleta), e ano de 2 dígitos, que o campo
  // datetime-local aceita como valor válido - digitar "26" em vez de "2026"
  // com 8 campos na tela é erro esperado.
  const anoInvalido = ms
    .map((t, i) => ({ ano: Number.isNaN(t) ? NaN : new Date(t).getUTCFullYear(), numero: i + 1 }))
    .filter(x => !Number.isFinite(x.ano) || x.ano < 2020 || x.ano > 2100)
  if (anoInvalido.length > 0) return { tipo: 'ano_invalido', sessoes: anoInvalido.map(x => x.numero) }

  // Sobreposição, e não igualdade exata: a Denise atende 60 minutos e não tem
  // grade de horários, então 14:00 e 14:30 no mesmo dia já empilha duas
  // consultas na agenda dela e manda dois convites sobrepostos ao paciente. A
  // trava de conflito da agenda não pega, porque ignora as sessões da própria
  // venda.
  const minimoMs = MINUTOS_MINIMOS_ENTRE_SESSOES * 60 * 1000
  const sobrepostas = ms
    .map((t, i) => ({ t, numero: i + 1 }))
    .filter((x, i, arr) => arr.some((y, j) => j < i && Math.abs(x.t - y.t) < minimoMs))
  if (sobrepostas.length > 0) return { tipo: 'sobrepostas', sessoes: sobrepostas.map(x => x.numero) }

  if (!ehDiagnostico) return null

  // Ordem cronológica, só no Diagnóstico. A regra central do produto é "o Pedro
  // faz as primeiras sessões e a Denise as demais", e `montarPacote` divide os
  // terapeutas por ÍNDICE, não por data: com as datas fora de ordem o pacote
  // grava a sessão 1 (Pedro) DEPOIS da sessão 2 (Denise), invertendo o produto.
  // Nenhuma tela mostra a inversão - a agenda ordena por data, o prontuário por
  // número, e as duas parecem coerentes isoladamente, com a etiqueta dizendo
  // "sessão 1 de 2" para a consulta posterior.
  //
  // O usuário liberou o INTERVALO entre as sessões, não a ordem delas: fora de
  // ordem é erro de digitação, não escolha. Por isso recusa, e não aviso.
  const foraDeOrdem: number[] = []
  for (let i = 1; i < ms.length; i++) {
    if (ms[i] < ms[i - 1]) foraDeOrdem.push(i + 1)
  }
  if (foraDeOrdem.length > 0) return { tipo: 'fora_de_ordem', sessoes: foraDeOrdem }

  // Data absurdamente longe. Um dígito trocado no ano ("2062" em vez de "2026")
  // passa pela faixa 2020-2100 e abre a janela da trava de conflito para
  // décadas, fazendo-a puxar a agenda inteira do terapeuta - o Pedro já tem 740
  // compromissos cadastrados, contra o teto de 1000 do PostgREST.
  const inicio = ms[0]
  const longeDemais = ms
    .map((t, i) => ({ t, numero: i + 1 }))
    .filter(x => x.t - inicio > UM_ANO_MS)
  if (longeDemais.length > 0) return { tipo: 'longe_demais', sessoes: longeDemais.map(x => x.numero) }

  return null
}

/** Mensagem para a tela. Diz o que houve e o que fazer, sem jargão. */
export function mensagemDoProblema(p: ProblemaDatas): { texto: string; status: 400 | 409 } {
  const lista = p.sessoes.join(', ')
  const plural = p.sessoes.length > 1
  switch (p.tipo) {
    case 'ano_invalido':
      return { texto: `Data inválida na sessão ${lista}. Confira o ano e preencha todos os campos.`, status: 400 }
    case 'sobrepostas':
      return {
        texto: `${plural ? 'As sessões' : 'A sessão'} ${lista} ${plural ? 'ficam' : 'fica'} em cima de outra sessão deste pacote (menos de ${MINUTOS_MINIMOS_ENTRE_SESSOES} minutos de diferença).`,
        status: 409,
      }
    case 'fora_de_ordem':
      return {
        texto: `A sessão ${lista} está marcada para antes da sessão anterior. No Diagnóstico Guiado o Pedro faz as primeiras sessões e a Denise as demais, então as datas precisam seguir a ordem das sessões.`,
        status: 400,
      }
    case 'longe_demais':
      return { texto: `A sessão ${lista} está a mais de um ano da primeira. Confira o ano digitado.`, status: 400 }
  }
}
