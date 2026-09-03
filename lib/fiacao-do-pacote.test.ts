// Este arquivo não testa DECISÃO nenhuma. Testa que a decisão continua LIGADA.
//
// Em 03/09/2026 uma medição por mutação reintroduziu 12 defeitos desta feature,
// um a um, em `app/`. OS 12 PASSARAM com a suíte verde, e `tsc` limpo em todos.
// Depois a decisão foi extraída para módulos puros e a medição foi refeita:
// mutar o call-site já refatorado - trocar `liquidoDoPacote(...)` de volta pelo
// líquido de uma venda só - CONTINUOU verde. Extrair para `lib/` mata mutação
// DENTRO da decisão; não mata "alguém apagou a chamada".
//
// `npm test` roda `tsx --test lib/*.test.ts`: rota e componente nunca são
// executados. Enquanto não houver runner de rota e de componente, este é o
// único teste que pega o apagamento. Ele NÃO prova que o número está certo -
// quem prova é lib/dinheiro-do-pacote.test.ts.
//
// Quando uma linha falhar por refatoração legítima, ATUALIZE o trecho; não
// apague a checagem. A lista é curta de propósito: só linhas cujo sumiço custa
// dinheiro ou esconde uma venda de todas as telas.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const raiz = fileURLToPath(new URL('..', import.meta.url))
const ler = (p: string) => readFileSync(raiz + p, 'utf8')

const FIACAO: { arquivo: string; trecho: string; porque: string }[] = [
  { arquivo: 'app/api/terapeutas/sessoes/agendar/route.ts', trecho: 'liquidoDoPacote(',
    porque: 'a comissão sai do líquido do PACOTE; só o do pai paga metade ao terapeuta (Fabio Nery: R$ 176,24 no lugar de R$ 354,10)' },
  { arquivo: 'app/api/terapeutas/sessoes/agendar/route.ts', trecho: ".eq('pacote_pai_id', sale_id)",
    porque: 'sem esta consulta a lista de filhas chega vazia e a soma do pacote some' },
  { arquivo: 'app/api/terapeutas/sessoes/agendar/route.ts', trecho: 'if (sale.pacote_pai_id) {',
    porque: 'sem a guarda, duas abas agendam pai e filha e o paciente sai com 12 sessões num pacote de 8' },
  { arquivo: 'app/terapeutas/vendas/page.tsx', trecho: 'brutoDoPacote(',
    porque: 'o reembolso do prontuário sai do valor pago do PACOTE (Amanda: R$ 3.980, não R$ 1.380)' },
  { arquivo: 'app/terapeutas/[id]/page.tsx', trecho: 'saleIdsComAsFilhas(',
    porque: 'sem isto a filha nunca entra no faturamento nem no reembolso do paciente, e as duas telas discordam em R$ 2.600' },
  { arquivo: 'app/api/terapeutas/dashboard/route.ts', trecho: 'saleIdsComAsFilhas(',
    porque: 'sem isto a linha do terapeuta perde a segunda compra enquanto o card global da mesma tela a mantém' },
  { arquivo: 'app/api/terapeutas/vendas/route.ts', trecho: 'vendas_filhas:',
    porque: 'é a única lista que contém venda ligada a outro pacote; sem ela a soma na tela vira código morto' },
  { arquivo: 'app/api/terapeutas/vendas/route.ts', trecho: "in('pacote_pai_id', idsQueSaoPai",
    porque: 'as filhas têm de ser buscadas FORA do filtro de data: o par quase sempre atravessa a meia-noite' },
  { arquivo: 'app/api/terapeutas/dashboard/route.ts', trecho: 'termosDeProduto(',
    porque: 'sem o termo do Diagnóstico na varredura, as sessões dele somem do Overview inteiro (11 sessões de 7 pacientes)' },
  { arquivo: 'app/api/terapeutas/vendas/route.ts', trecho: 'termosDeProduto(',
    porque: 'mesma varredura na tela do comercial; as duas divergiram uma vez e ninguém viu' },
  { arquivo: 'app/api/terapeutas/dashboard/route.ts', trecho: 'ehPendenteDeAgendamento(',
    porque: 'venda ligada a outro pacote não é pendente; contá-la projeta sessão e comissão que ninguém vai pagar' },
  { arquivo: 'app/terapeutas/[id]/page.tsx', trecho: 'ehPendenteDeAgendamento(',
    porque: 'mesma regra das outras duas telas; discordar entre elas é invisível' },
  { arquivo: 'app/api/terapeutas/vendas/pacote/route.ts', trecho: 'export async function GET(',
    porque: 'sem o GET a tabela ocorrencias_pacote volta a ser write-only' },
  { arquivo: 'app/api/terapeutas/vendas/pacote/route.ts', trecho: 'export async function DELETE(',
    porque: 'é a única saída de um clique errado em "É o mesmo pacote" sem mexer no banco' },
  { arquivo: 'app/api/terapeutas/vendas/pacote/route.ts', trecho: "acao === 'desligar'",
    porque: 'sem isto, trocar a resposta para "compra separada" deixa a ligação de pé e agenda 4 sessões num pacote de 8' },
  { arquivo: 'app/api/terapeutas/vendas/pacote/route.ts', trecho: 'qtdSessoes > 0',
    porque: 'separar um pacote já agendado deixa o paciente com sessões a mais e a comissão em dobro' },
  { arquivo: 'app/terapeutas/vendas/page.tsx', trecho: "method: 'DELETE',",
    porque: 'a rota DELETE já existiu por semanas sem NADA a chamar' },
  { arquivo: 'app/terapeutas/aprovacoes/page.tsx', trecho: 'setOcorrenciasPacote(j2.ocorrencias ?? [])',
    porque: 'a chave do JSON é o contrato com o GET; errá-la deixa a seção vazia para sempre' },
  { arquivo: 'app/terapeutas/aprovacoes/page.tsx', trecho: 'rotuloDaOcorrencia',
    porque: 'sem ele o CEO lê "Compras separadas" onde alguém desfez uma junção já registrada' },
]

for (const { arquivo, trecho, porque } of FIACAO) {
  test(`${arquivo} continua ligado: ${trecho}`, () => {
    assert.ok(ler(arquivo).includes(trecho), `${arquivo} perdeu \`${trecho}\` - ${porque}`)
  })
}
