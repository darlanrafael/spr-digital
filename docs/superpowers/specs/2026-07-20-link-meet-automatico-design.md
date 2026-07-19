# Link do Meet Automático — Design

## Objetivo

Toda sessão real com data marcada ganha um link de Google Meet gerado
automaticamente — sem precisar de ninguém preenchendo `sessoes.link_meet`
na mão (campo que hoje sempre nasce vazio). Cobre os três lugares onde uma
sessão passa a ter data: agendamento normal a partir de uma venda pendente,
lançamento manual de paciente, e remarcação.

## Por que

Hoje `link_meet` nunca é preenchido — o campo existe na UI (mostra "Abrir"
quando presente) mas nada nunca gera esse valor. Toda sessão sai sem link,
dependendo de alguém criar e colar manualmente em algum lugar fora do
sistema.

## Como o link é gerado

Evento criado via Google Calendar API, num calendário secundário dedicado
("Atendimentos SPR Digital") na conta Google Workspace da agência —
**não** na agenda pessoal do CEO. Sem convite por e-mail pro terapeuta/
paciente (só o link salvo no sistema — quem avisa é o próprio sistema,
não o Google). Quem "organiza" o evento no Google não aparece dentro da
videochamada em si, só nos metadados do convite — terapeuta e paciente
entram normalmente com as próprias contas.

## Pré-requisito (fora do meu alcance — precisa de acesso admin do Workspace)

Preciso de 3 valores, gerados uma única vez no Google Cloud Console +
Admin Console do Workspace da agência:
1. `GOOGLE_MEET_SERVICE_ACCOUNT_EMAIL` — e-mail da conta de serviço
2. `GOOGLE_MEET_PRIVATE_KEY` — chave privada (do JSON da conta de serviço)
3. `GOOGLE_MEET_DELEGATED_USER` — e-mail da conta Workspace que "possui"
   a agenda onde os eventos são criados

Passos pra gerar (documentados aqui pra quando for fazer):
1. Google Cloud Console → criar projeto → ativar "Google Calendar API"
2. Criar uma conta de serviço nesse projeto, gerar chave JSON
3. Admin Console do Workspace → Segurança → Controles de API → Delegação
   em todo o domínio → autorizar essa conta de serviço com o escopo
   `https://www.googleapis.com/auth/calendar`

Até essas 3 variáveis existirem no ambiente (Vercel), o sistema funciona
normalmente — sessão é criada/remarcada sem link (como hoje), sem travar
nada. Assim que as 3 variáveis existirem, passa a gerar link automático
sem precisar mexer em código de novo.

## Onde entra no fluxo

- **Agendamento** (`POST /api/terapeutas/sessoes/agendar`) — depois de
  inserir as sessões, tenta criar um evento por sessão (ou um evento por
  lote, ver "Detalhe técnico" abaixo) e atualiza `link_meet` de cada uma.
- **Lançamento manual** (`POST /api/terapeutas/vendas/lancamento-manual`)
  — mesma lógica, uma sessão real criada = um evento criado.
- **Remarcação** (`POST /api/terapeutas/sessoes/remarcar`) — cancela
  (deleta) o evento antigo no Google e cria um evento novo com a nova
  data, em vez de só atualizar o horário do existente. Precisa saber o
  `google_event_id` da sessão pra cancelar o certo.

## Dados novos

```sql
alter table sessoes
  add column if not exists google_event_id text;
```

Guarda o id do evento no Google, necessário pra cancelar/recriar na
remarcação. `link_meet` (já existe) continua guardando a URL exibida na
UI.

## Comportamento em caso de falha

Se a chamada à API do Google falhar (rede, cota, credencial ausente/
inválida), a operação principal (agendar/lançar/remarcar sessão) **não
trava** — completa normalmente, só sem `link_meet`/`google_event_id`
preenchidos. O erro é logado no servidor (`console.error`), não
propagado como falha da requisição.

## Detalhe técnico — biblioteca e autenticação

`lib/google-meet.ts` novo, usando o pacote `googleapis` (nova dependência
do projeto). Autenticação via `google.auth.JWT` com
`subject: GOOGLE_MEET_DELEGATED_USER` (impersonation via delegação de
domínio). Duas funções exportadas:

```ts
criarEventoComMeet(params: { titulo: string; inicioISO: string; fimISO: string }): Promise<{ eventId: string; meetLink: string } | null>
cancelarEvento(eventId: string): Promise<void>
```

Ambas retornam graciosamente (`null` / no-op) se as 3 variáveis de
ambiente não estiverem configuradas — não lançam erro, permitindo o
"modo degradado" descrito acima.

## Fora de escopo

- UI de admin pra reconfigurar as credenciais — só variável de ambiente.
- Convite por e-mail automático (Google Calendar) pro terapeuta/paciente.
- Recriar retroativamente o link de sessões já existentes sem link — só
  vale pra sessão nova/remarcada a partir de quando isso for ativado.
