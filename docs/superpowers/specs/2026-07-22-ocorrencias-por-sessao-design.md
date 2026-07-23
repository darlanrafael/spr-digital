# Ocorrências por Sessão + Orientação da Sessão no WhatsApp — Design

## Contexto e problema

Hoje `ocorrencias_prontuario` é ligada só ao `sale_id` (a venda/pacote inteiro).
Quando um paciente tem várias sessões, todas as ocorrências (notas,
remarcações, reembolsos) aparecem numa lista única no prontuário, sem
diferenciar de qual sessão cada uma trata. Só o tipo `remarcacao` guarda um
`sessao_id`, e mesmo assim escondido dentro de `dados_extras` (não é uma
coluna consultável).

Além disso, o time comercial precisa de uma forma de avisar o terapeuta (e,
quando fizer sentido, o próprio paciente) sobre alguma orientação específica
de uma sessão — ex: "hoje quem vai atender é o marido dela, ele questionou
X" — e hoje não existe canal pra isso além de mensagem manual fora do
sistema.

## Objetivo

1. Permitir vincular ocorrências a uma sessão específica (não só à venda), e
   reorganizar a tela do prontuário pra mostrar as ocorrências agrupadas por
   sessão.
2. Criar um novo tipo de ocorrência, **Orientação da Sessão**, que — quando
   registrado a tempo — entra automaticamente no lembrete de WhatsApp de 30
   minutos antes da sessão (grupo do terapeuta e privado do paciente).

## Modelo de dados

Migration nova em `supabase/migrations/`:

```sql
alter table ocorrencias_prontuario
  add column sessao_id uuid references sessoes(id);

create index idx_ocorrencias_prontuario_sessao_id
  on ocorrencias_prontuario(sessao_id);
```

- `sessao_id` é **nullable** — nota/reembolso continuam podendo existir sem
  sessão vinculada (aparecem numa seção "Geral" na tela).
- Tipo novo: `tipo = 'orientacao_sessao'`. Pra esse tipo, `sessao_id` é
  **obrigatório** (validado no endpoint, não só no front).
- Remarcação passa a também gravar `sessao_id` na coluna nova (além de
  continuar gravando dentro de `dados_extras`, sem quebrar o que já lê de
  lá) — só pra ficar consistente com os outros tipos na hora de agrupar.

## Regras da Orientação da Sessão

- **Uma por sessão.** Tentar criar uma segunda pra mesma `sessao_id` com
  `tipo = 'orientacao_sessao'` retorna erro; o front, ao detectar que já
  existe uma, mostra "Editar orientação" em vez de "Registrar orientação"
  (mesmo formulário, preenchido com o texto atual).
- **Prazo mínimo de 40 minutos.** Criar ou editar é bloqueado (com aviso
  claro na tela, sem chamar a API) se a sessão escolhida começa em menos de
  40 minutos. Isso garante folga pro cron de 30min (que roda a cada 5
  minutos) sempre enxergar a versão final antes de disparar.
- **Quem pode registrar:** comercial, terapeuta e admin — mesma permissão
  que já existe hoje pra Nota/Remarcação.
- **Título fixo:** sempre `ORIENTAÇÃO DA SESSÃO:` seguido do texto livre
  digitado — o usuário só preenche a descrição, não o título.
- Diferente dos outros tipos (que são histórico imutável, só inserção), esse
  tipo aceita edição — porque o objetivo é ter sempre a versão mais atual
  no momento do disparo, não um histórico de correções.

## Tela de Ocorrências (prontuário)

A lista deixa de ser um `flatMap` único por paciente. Passa a agrupar por
sessão:

- Uma seção por sessão do paciente (mais recente primeiro), com cabeçalho
  tipo "Sessão 2 — 22/07, 18:00", listando as ocorrências vinculadas a ela.
- Uma seção "Geral" ao final, com as ocorrências sem `sessao_id` (notas
  antigas, e notas novas que o usuário decidiu não vincular a uma sessão
  específica).
- 4º botão ao lado de Nota/Remarcar/Reembolso: "📣 Orientação da Sessão".
- Nota/Observação ganha um seletor de sessão **opcional** (mesmo combo que
  já existe hoje só pra Remarcação).

## Disparo no WhatsApp

Só entra no **lembrete de 30 minutos** (não no de véspera) — decisão
explícita: como a regra já garante que a orientação existe com pelo menos
~40min de antecedência, só o lembrete mais próximo do horário precisa
carregar essa informação.

- `lib/whatsapp-pendentes.ts` (`buscarPendentes`), na consulta que já roda a
  cada execução do cron de 30min, passa a buscar também (por
  `sessao_id`) se existe uma ocorrência `orientacao_sessao` pra cada sessão
  dentro da janela, e inclui o texto no payload enviado pro webhook do n8n
  (campo novo, ex: `orientacao_sessao: string | null`).
- Como essa consulta roda direto no banco a cada disparo do cron (a cada 5
  minutos, sem cache), qualquer edição feita antes do envio já é
  refletida automaticamente — não precisa de mecanismo extra de
  reconferência.
- No n8n, o workflow "SPR Digital - Lembrete 30 Minutos" (nó "Montar
  Envios") passa a acrescentar, ao final da mensagem de grupo e da mensagem
  privada (quando o campo vier preenchido):
  ```
  📣 *ORIENTAÇÃO DA SESSÃO:*
  <texto>
  ```
  **Correção pós-implementação (2026-07-23):** ao ver o teste real, o usuário
  reverteu essa decisão — vai **só na mensagem de grupo do terapeuta**. A
  mensagem privada do paciente volta a ser exatamente a de antes (sem o bloco
  de orientação), sem alteração nenhuma no fluxo dela.

## Endpoints

Estende `app/api/terapeutas/vendas/route.ts` (que já trata os tipos
`nota`/`remarcacao`/`solicitacao_reembolso` no POST):

- POST com `tipo: 'orientacao_sessao'`: valida `sessao_id` presente, sessão
  existe e começa em ≥ 40min, e que não existe outra ocorrência do mesmo
  tipo pra essa sessão. Grava com título fixo.
- PUT novo (mesmo arquivo): edita `titulo`/`descricao` de uma ocorrência
  existente — **restrito a `tipo = 'orientacao_sessao'`** (os demais tipos
  continuam imutáveis, como hoje). Reaplica a mesma validação de prazo
  (≥ 40min) antes de permitir salvar a edição.

## Fora de escopo

- Não altera o lembrete de véspera.
- Não cria disparo imediato (diferente da "venda de encaixe") — a
  orientação só viaja dentro do lembrete de 30min já existente.
- Não adiciona edição para os outros tipos de ocorrência (nota, remarcação,
  reembolso) — continuam append-only.
