// O que já existe para este paciente, na hora de lançar manualmente.
//
// Existe por causa de um caso real (04/08/2026): a Joicy tinha uma venda de
// plataforma de R$ 1.550 comprada no dia anterior, com 2 sessões já agendadas.
// O comercial lançou um manual do mesmo valor e do mesmo produto, e o sistema
// não disse nada. Ela ficou com 2 vendas e 4 sessões tendo comprado uma vez.
//
// Isto NÃO bloqueia: comprar dois pacotes é legítimo, e travar deixaria o
// comercial parado esperando alguém liberar. O que ele precisa é ver o que já
// existe antes de confirmar - a informação estava no sistema, só não estava na
// frente de quem decidia.

export type VendaExistente = {
  id: string
  produto: string
  valor_pago_cliente: number | null
  data_hora: string
  status: string | null
  /** Quantas sessões essa venda já tem. */
  sessoes: number
}

export type AvisoDeDuplicata = {
  /** Vendas do MESMO produto, o caso que mais engana. */
  mesmoProduto: VendaExistente[]
  /** Outras vendas aprovadas do paciente, para contexto. */
  outras: VendaExistente[]
  /** Frase pronta para a tela. `null` quando não há nada a avisar. */
  texto: string | null
}

const fmt = (n: number | null) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dia = (iso: string) => {
  const d = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000)
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Só venda que ainda vale: estornada não é duplicata, é histórico. */
function contaComoExistente(v: VendaExistente): boolean {
  return !v.status || v.status === 'aprovada'
}

export function avisoDeDuplicata(params: {
  produto: string
  vendasDoPaciente: VendaExistente[]
}): AvisoDeDuplicata {
  const vivas = params.vendasDoPaciente.filter(contaComoExistente)
  const alvo = params.produto.trim().toLowerCase()
  const mesmoProduto = vivas.filter(v => v.produto.trim().toLowerCase() === alvo)
  const outras = vivas.filter(v => v.produto.trim().toLowerCase() !== alvo)

  if (mesmoProduto.length === 0 && outras.length === 0) {
    return { mesmoProduto, outras, texto: null }
  }

  if (mesmoProduto.length > 0) {
    const partes = mesmoProduto.map(v =>
      `${fmt(v.valor_pago_cliente)} de ${dia(v.data_hora)}${v.sessoes > 0 ? ` com ${v.sessoes} ${v.sessoes === 1 ? 'sessão' : 'sessões'}` : ' (sem sessão agendada)'}`,
    )
    return {
      mesmoProduto, outras,
      texto: `Este paciente já tem ${mesmoProduto.length === 1 ? 'uma venda' : `${mesmoProduto.length} vendas`} deste mesmo produto: ${partes.join('; ')}. Confira se não é a mesma antes de lançar.`,
    }
  }

  return {
    mesmoProduto, outras,
    texto: `Este paciente já tem ${outras.length} ${outras.length === 1 ? 'venda' : 'vendas'} no sistema, de outro produto. Não é impedimento, mas vale conferir.`,
  }
}
