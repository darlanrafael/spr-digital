// Qual terapeuta o modal de agendar deve abrir selecionado.
//
// Até 09/09/2026 ele abria com `terapeutas[0]`, e a lista vem `.order('nome')`
// - ou seja, sempre a DENISE, por ordem alfabética. Quem agendava uma venda do
// Pedro e não trocava o campo mandava a sessão para a agenda dela, com os 30%
// de comissão dela calculados em cima.
//
// Aconteceu duas vezes, em dias diferentes, com o mesmo comercial: Ana Assis
// (28/07) e Joicy (03/08), 4 sessões, R$ 781,43 de comissão. Varredura das 606
// sessões do banco: são os únicos casos, e os dois seguem o mesmo padrão.
//
// O padrão do campo passa a vir do PRODUTO da venda. Continua editável -
// remanejar terapeuta é legítimo e acontece - mas o caminho de menor
// resistência deixa de levar para o lugar errado.
import { ehDiagnosticoGuiado, ehMentoriaEmGrupo } from './vendas-por-situacao'

export type TerapeutaDaLista = { id: string; nome: string }

/** O primeiro nome, que é como o produto identifica o terapeuta. */
function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0].toLowerCase()
}

/**
 * Quais terapeutas da lista o produto nomeia.
 *
 * Devolve mais de um no produto conjunto ("Mentoria Particular - Pedro |
 * Denise"), que é justamente o caso em que ninguém pode ser assumido.
 */
export function terapeutasDoProduto(produto: string, terapeutas: TerapeutaDaLista[]): TerapeutaDaLista[] {
  const p = produto.toLowerCase()
  return terapeutas.filter(t => p.includes(primeiroNome(t.nome)))
}

/**
 * O terapeuta que o modal deve abrir selecionado. `null` = não preencher.
 *
 * `null` é resposta legítima e desejada: no produto conjunto e no produto que
 * não nomeia ninguém, deixar em branco obriga a escolha consciente. Chutar ali
 * é como o defeito começou.
 */
export function terapeutaSugerido(produto: string, terapeutas: TerapeutaDaLista[]): TerapeutaDaLista | null {
  if (!produto?.trim()) return null

  // MENTORIA EM GRUPO não é agendamento individual e NUNCA chega aqui: ela sai
  // de Pendentes em `ehPendenteDeAgendamento`, então o modal não abre para ela.
  // A resposta é `null` por correção, não porque alguém vá usá-la - e para que
  // ninguém leia esta função e conclua que grupo é agendável.
  if (ehMentoriaEmGrupo(produto)) return null

  // O DIAGNÓSTICO GUIADO envolve os DOIS terapeutas: o Pedro faz as primeiras
  // sessões e a Denise as demais, conforme o formato. O select nem aparece no
  // modal para esse produto (`{!agendarDiagnostico && ...}`) - quem divide o
  // pacote é a rota de agendar. O Pedro aqui é só o `terapeuta_id` que a rota
  // exige no corpo, e ele é sempre quem começa; não é escolha de terapeuta.
  if (ehDiagnosticoGuiado(produto)) {
    return terapeutas.find(t => primeiroNome(t.nome) === 'pedro') ?? null
  }

  const achados = terapeutasDoProduto(produto, terapeutas)
  return achados.length === 1 ? achados[0] : null
}

/**
 * Aviso quando o terapeuta escolhido não é nomeado pelo produto.
 *
 * NÃO bloqueia. Remanejo existe e é legítimo; o que não pode é acontecer em
 * silêncio, que foi o caso das 4 sessões.
 */
export function avisoTerapeutaDivergente(params: {
  produto: string
  terapeutaEscolhido: TerapeutaDaLista | null
  terapeutas: TerapeutaDaLista[]
}): string | null {
  const { produto, terapeutaEscolhido, terapeutas } = params
  if (!terapeutaEscolhido || !produto?.trim()) return null
  if (ehDiagnosticoGuiado(produto)) return null

  const nomeados = terapeutasDoProduto(produto, terapeutas)
  // Produto que não nomeia ninguém não tem contra o que divergir.
  if (nomeados.length === 0) return null
  if (nomeados.some(t => t.id === terapeutaEscolhido.id)) return null

  const quem = nomeados.map(t => t.nome).join(' ou ')
  return `Esta venda é do produto "${produto}", que é ${quem}. Você está agendando para ${terapeutaEscolhido.nome} - a comissão vai ser calculada pelo percentual dele(a). Se for remanejo, tudo bem; se não, troque o terapeuta.`
}
