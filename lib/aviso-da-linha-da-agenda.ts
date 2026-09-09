// O aviso de uma linha da agenda que tem mais de um item.
//
// A agenda de horário fixo ancora cada item no horário da grade MAIS PRÓXIMO
// do início real dele. Isso faz uma linha juntar coisas que não estão no mesmo
// horário: em 09/09/2026, a sessão do Valdir às 19:20 e o bloqueio JANTAR das
// 19:30 caíram na mesma linha, e a tela avisou "2 consultas marcadas no mesmo
// horário". Não eram duas consultas, e nenhuma estava no mesmo horário da
// outra - era uma consulta encostando num compromisso.
//
// A distinção importa porque as duas situações pedem ações opostas:
//
//   - DUAS CONSULTAS de pacientes diferentes é dupla marcação. Alguém vai
//     ficar sem atendimento e é preciso remarcar hoje. Foi o defeito que gerou
//     25 duplas no banco antes da trava de 11/08.
//   - CONSULTA EM CIMA DE COMPROMISSO é o terapeuta atendendo dentro de um
//     horário que ele mesmo bloqueou. Ninguém fica sem atendimento; ou o
//     bloqueio está desatualizado, ou ele aceita avançar ali.
//
// Chamar as duas de "2 consultas marcadas no mesmo horário" faz o comercial
// procurar uma dupla marcação que não existe - e, pior, faz uma dupla de
// verdade parecer o caso inofensivo.

export type ItemDaLinha = {
  /** Minutos desde a meia-noite, o início REAL do item. */
  inicio: number
  ehSessao: boolean
  /** Título do compromisso. Ignorado quando `ehSessao`. */
  titulo?: string | null
}

export type AvisoDaLinha = {
  texto: string
  /** `conflito` pinta de vermelho; `atencao`, de âmbar. */
  gravidade: 'conflito' | 'atencao'
} | null

function hhmm(minutos: number): string {
  return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`
}

/** Uma linha só avisa quando há de fato mais de um item nela. */
export function avisoDaLinha(itens: ItemDaLinha[]): AvisoDaLinha {
  if (itens.length <= 1) return null

  const sessoes = itens.filter(i => i.ehSessao)
  const compromissos = itens.filter(i => !i.ehSessao)

  // Duas consultas: o caso grave. Vale mesmo que os horários difiram, porque
  // duas consultas encostadas na mesma linha da grade também significam que
  // uma vai atrasar a outra.
  if (sessoes.length > 1) {
    return {
      texto: `${sessoes.length} consultas marcadas no mesmo horário`,
      gravidade: 'conflito',
    }
  }

  // Uma consulta e um ou mais compromissos. Nomeia o compromisso e diz a hora
  // dele: sem isso, o aviso não explica o que está sendo ocupado.
  const nomes = compromissos
    .map(c => (c.titulo ?? '').trim())
    .filter(Boolean)
  const rotulo = nomes.length === 1
    ? `"${nomes[0]}"`
    : nomes.length > 1 ? `${nomes.length} compromissos` : 'um compromisso'
  const hora = compromissos.length === 1 ? ` das ${hhmm(compromissos[0].inicio)}` : ''
  return {
    texto: `Consulta avançando sobre o compromisso ${rotulo}${hora}`,
    gravidade: 'atencao',
  }
}
