# Gestor de projetos — automação do ClickUp - design

Data: 21/08/2026
Status: aguardando aprovação do usuário

## Por que existe

O ClickUp registra as demandas da SQUAD mas não cobra ninguém. Auditoria de
21/08/2026, com 105 tarefas abertas:

- 34 sem responsável (32%)
- 44 sem prazo (41%)
- 27 vencidas, a mais antiga há 17 dias
- 49 sem nenhum toque entre 8 e 30 dias

Nada disso gera aviso. O único mecanismo hoje é o Darlan lembrar de abrir o
ClickUp e olhar. O objetivo é que a cobrança aconteça sozinha, no WhatsApp, e
que o Darlan receba três panoramas por dia sem precisar abrir nada.

Este documento descreve a **primeira das três entregas** planejadas:

1. **Cobrador + panorama** ← este documento
2. Roteamento entre braços (o que hoje é feito na mão pelas Automations)
3. Criação de pasta no Google Drive

O fluxo de copy (item 3) aparece aqui porque o usuário o definiu junto com a
régua, mas a parte do Drive fica marcada como pendente — ver "Pendências".

## Escopo

Está dentro:

- Avisos no privado (PV) de cada responsável, na hora e por prazo
- Três panoramas por dia num grupo de WhatsApp com o Darlan apenas
- Régua de cobrança antes e depois do vencimento
- Detecção de prazo readequado
- Fluxo de copy: etiqueta → Pedro → ciclo reinicia
- Camada isolada de envio (D-API)

Está fora, e por quê:

- **Tela/dashboard** — o painel é o próprio ClickUp; duplicar seria a "farofa"
  que o usuário pediu para evitar
- **Ler respostas do WhatsApp** — o robô só fala; quem responde, responde no
  ClickUp
- **Criar tarefa pelo WhatsApp** — o Darlan cria no ClickUp, que é onde estão
  as descrições e anexos
- **Comentar na task** — decidido não escrever no ClickUp além do estritamente
  necessário (ver "Escritas no ClickUp")

## Decisões tomadas, com o porquê

| # | Decisão | Por quê |
|---|---|---|
| 1 | Roteamento por **responsável da task**, não por braço | Task com dois responsáveis avisa os dois automaticamente (caso Reinaldo + Juninho). Não exige manter um cadastro de 16 braços atualizado. |
| 2 | Task **sem responsável** avisa o Darlan | 32% das tarefas estão assim hoje; sem essa regra elas ficariam invisíveis. |
| 3 | Copy identificado por **etiqueta**, não por padrão no título | Padrão de texto falha em silêncio (um travessão no lugar do hífen e ninguém percebe). O espaço SQUAD já usa etiquetas (`produto`, `debriefing`). |
| 4 | **Agrupar** avisos de régua por pessoa | Sem isso, o Darlan receberia 34 mensagens em 24/08 (medido contra os prazos reais). Com agrupamento, no máximo uma por horário da régua. |
| 5 | Panorama é **foto do estado**, não log de mudanças | Cada um dos três se lê sozinho, sem depender de ter lido o anterior. |
| 6 | Bloco "entregues" é **delta**, não foto | Foto faria a lista crescer para sempre. |
| 7 | Máximo **4 itens por bloco** do panorama | 105 tarefas em lista completa dá uma mensagem que o WhatsApp trunca e ninguém lê. |
| 8 | "Atrasada" = **passou do dia**, não da hora | Cobrar às 15h quem tem até 20h para entregar queima o aviso à toa. Diferença medida: 27 tarefas pelo critério da hora, 20 pelo critério do dia. |
| 9 | Régua roda **todos os dias**, inclusive fim de semana | Decisão explícita do usuário. |
| 10 | **Jeito B** de separação: mesmo projeto, pastas e tabelas próprias | Os dois módulos não trocam nenhum dado. O módulo de terapeutas já prova que dá para conviver: seus 16 arquivos importam apenas do próprio módulo e da conexão com o banco. |
| 11 | **Relógio externo** (cron-job.org), não Vercel Cron | Funciona em qualquer plano Vercel, e avisa por e-mail quando o sistema não responde. Foi exatamente esse alarme que faltou quando o n8n caiu: o alerta morava dentro do próprio n8n. |
| 11b | **Horários fixos** em vez de varredura de 15 em 15 minutos | A régua tem 11 horários conhecidos. Marcá-los faz a mensagem sair no minuto certo e cai de 96 para 24 chamadas por dia. A passada de hora em hora preserva a rede de segurança. |
| 12 | Varredura é **redundância do webhook**, não complemento | Ver "Arquitetura". Se o webhook morrer, nada se perde — só deixa de ser instantâneo. |

## Arquitetura

### O motor: uma função de sincronização

Todo o comportamento nasce de **uma única função**, `sincronizar()`:

1. Lê o estado atual das tarefas no ClickUp
2. Compara com o último estado conhecido, guardado em `clickup_tarefas_estado`
3. Do que mudou, gera os avisos devidos
4. Do relógio, gera os avisos de régua cujo momento já chegou
5. Grava o estado novo

Ela é chamada por dois caminhos:

- **Webhook do ClickUp** — para uma tarefa específica, em segundos
- **Relógio externo** — nos 11 horários fixos da régua, mais uma passada por
  hora como rede de segurança; sempre para todas as tarefas

**Os dois caminhos executam o mesmo código.** O webhook não é uma via
alternativa com lógica própria; é apenas um jeito de a varredura acontecer mais
cedo para uma tarefa.

Essa é a redundância que o usuário pediu. Consequências práticas:

- Webhook suspenso pelo ClickUp por falhas → a passada de segurança pega em até
  1 hora
- Deploy fora do ar por 2 horas → na volta, a varredura reconstrói tudo
- Webhook duplicado (o ClickUp reenvia) → a comparação de estado não vê mudança
  e não gera nada

Sem o webhook o sistema continua correto, apenas mais lento. Sem a varredura o
sistema fica frágil. Por isso a varredura é a base e o webhook é o acelerador.

### Estrutura de arquivos

```
app/api/clickup/
  ├── sincronizar/route.ts     POST — chamado pelo relógio externo
  └── webhook/route.ts         POST — recebe eventos do ClickUp

lib/clickup/
  ├── clickup-api.ts           o único arquivo que fala com o ClickUp
  ├── dapi.ts                  o único arquivo que fala com a D-API
  ├── estado.ts                lê/grava clickup_tarefas_estado, calcula o diff
  ├── regua.ts                 (puro) quais avisos são devidos, dado estado + hora
  ├── mensagens.ts             (puro) monta o texto de cada aviso
  ├── panorama.ts              (puro) monta os três resumos
  ├── pessoas.ts               mapa ClickUp → WhatsApp
  ├── telefone.ts              cópia de lib/telefone.ts (ver nota abaixo)
  └── sincronizar.ts           o motor, orquestra os anteriores
```

Regra de isolamento, verificável por leitura:

- Nada fora de `app/api/clickup/` e `lib/clickup/` importa desses diretórios
- `lib/clickup/*` importa apenas de si mesmo e de `@/lib/supabase`
- Nenhum arquivo existente é modificado por esta entrega

`lib/clickup/telefone.ts` é **cópia** de `lib/telefone.ts`, não import. São 30
linhas. Copiar evita que um ajuste no fluxo dos pacientes altere o
comportamento do robô sem ninguém perceber — e vice-versa. Os testes são
copiados junto.

### Tabelas

Todas com prefixo `clickup_`. Nenhuma tabela existente é alterada.

**`clickup_pessoas`** — o mapa de destinatários.

| coluna | tipo | nota |
|---|---|---|
| clickup_user_id | bigint PK | amarra no ID, não no nome (nome de exibição muda) |
| nome | text | para o texto das mensagens |
| email | text | conferência humana |
| whatsapp | text | dígitos puros, com código do país |
| ativo | boolean | desliga alguém sem apagar o histórico |

**`clickup_tarefas_estado`** — o último estado conhecido de cada tarefa.

| coluna | tipo | nota |
|---|---|---|
| task_id | text PK | |
| nome | text | |
| status | text | |
| lista | text | |
| url | text | link para a mensagem |
| due_date | timestamptz | null quando não tem prazo |
| due_date_tem_hora | boolean | ver "Convenção de prazo" |
| responsaveis | bigint[] | IDs do ClickUp |
| etiquetas | text[] | para detectar `copy` |
| visto_em | timestamptz | última vez que a tarefa apareceu na varredura |
| fechada_em | timestamptz | quando saiu dos status abertos |

**`clickup_notificacoes`** — o que já foi enviado. É a trava anti-repetição.

| coluna | tipo | nota |
|---|---|---|
| id | uuid PK | |
| task_id | text | |
| tipo | text | ex: `regua_36h`, `atraso_d2_16h`, `status_recusada` |
| referencia | text | **chave da re-armação** — ver abaixo |
| destinatario | text | número de WhatsApp ou `grupo` |
| estado | text | `enviando` / `enviado` / `falha` |
| tentativas | int | |
| erro | text | |
| criado_em | timestamptz | |
| enviado_em | timestamptz | |

`UNIQUE (task_id, tipo, referencia, destinatario)`

**O campo `referencia` é o que faz o prazo readequado funcionar.** Para avisos
ligados a prazo, `referencia` é a data de vencimento em ISO. Quando o Darlan
muda o prazo de 05/09 para 12/09, a chave muda junto — os avisos da data nova
não colidem com os já enviados da data velha, e a régua inteira re-arma sozinha.
Nenhum código especial de "resetar" é necessário.

Para avisos de status, `referencia` é o status de destino — assim uma tarefa que
volta a um status pelo qual já passou dispara de novo, o que é o comportamento
correto (uma segunda recusa precisa ser avisada).

Para o aviso de aceite em 10 horas, `referencia` é o instante em que a tarefa
entrou em `demanda solicitada`. Se ela sair e voltar, a contagem recomeça.

**`clickup_execucoes`** — uma linha por varredura, para diagnóstico.

| coluna | tipo |
|---|---|
| id, iniciada_em, terminada_em, origem (`cron`/`webhook`), tarefas_lidas, avisos_gerados, erros |

## Convenção de prazo

O ClickUp devolve `due_date` em milissegundos e um booleano `due_date_time` que
diz se a **hora** do prazo foi definida.

Medido em 21/08/2026: das 61 tarefas com prazo, **nenhuma tem hora**. Todas são
data seca.

Portanto: **prazo sem hora = 20:00 de Brasília daquele dia.** Vem da frase do
usuário na definição da régua — "lembrete que a tarefa precisa ser finalizada
até 20:00".

Com essa convenção, os avisos relativos caem em horas redondas:

- 36h antes de D 20:00 = **D-1 08:00**
- 24h antes de D 20:00 = **D-1 20:00**

Quando a tarefa **tiver** hora definida, o cálculo usa a hora real. Nesse caso
um aviso pode cair de madrugada, e aí vale a janela abaixo.

**Janela de envio: 08:00 às 21:00, horário de Brasília.** Qualquer disparo
calculado fora dela é adiado para as 08:00 seguintes — nunca antecipado, para
não avisar cedo demais. Os horários fixos da régua já estão todos dentro da
janela; a regra existe para o caso de prazo com hora.

Brasília é UTC-3 fixo (sem horário de verão desde 2019), mesma convenção já
usada em `lib/terapeutas-auth.ts`.

## A régua

### Parte 1 — eventos de status

Disparam no momento em que o status muda. **Não são agrupados**: cada mudança é
um evento único, com seu próprio texto.

| Status de destino | PV do responsável | Grupo |
|---|---|---|
| `demanda solicitada` | sim | não |
| `demanda recebida` | não | sim |
| `em processo` | não | sim |
| `solicitação de revisão` | não | sim |
| `demanda recusada` | sim — "precisa de atenção/correção" | não |
| `demanda aprovada` | sim | sim |
| `concluído` | sim — "obrigado" | sim |
| `demanda fechada` | não | não |

`demanda fechada` encerra tudo: nenhum aviso, nenhuma cobrança.

**Regra de aceite em 10 horas:** se uma tarefa está em `demanda solicitada` há
mais de 10 horas, o Darlan é avisado no PV. Uma vez por tarefa, por `referencia`
= data de entrada no status.

### Parte 2 — antes do vencimento

Todos no PV do responsável. Agrupados por pessoa.

| Momento | Horário efetivo (prazo sem hora) |
|---|---|
| 36h antes | D-1 08:00 |
| 24h antes | D-1 20:00 |
| dia D | 09:00 — "precisa estar finalizada até 20h" |
| dia D | 15:00 |
| dia D | 19:30 — último aviso |

### Parte 3 — depois do vencimento

Todos no PV do responsável. Agrupados por pessoa.

| Dia | Hora | Tipo |
|---|---|---|
| D | 21:00 | aviso de atraso |
| D+1 | 09:00 | cobrança |
| D+1 | 18:00 | cobrança |
| D+2 | 12:00 | cobrança |
| D+2 | 16:00 | cobrança |
| D+2 | 21:00 | cobrança |
| D+3 | 12:00 | cobrança |
| D+3 | 20:00 | cobrança |
| D+4 | 12:00 | cobrança — **a última** |

**A partir de D+5:** nenhuma mensagem no PV. Uma única mensagem no grupo,
marcando a saída da cobrança automática:

```
🔴 SAIU DA COBRANÇA AUTOMÁTICA

"Edição Aulas - Como Ser Perdoado"
Responsável: Rec Móbile
Atraso: 5 dias

O robô cobrou 9 vezes e não fechou.
É com você agora.
```

Depois disso a tarefa vive apenas no panorama, marcada com 🔴.

### Parte 4 — nada retroativo

**O robô nunca envia um aviso cujo horário já passou no momento em que ele
passou a existir.** Ele pega o próximo momento da régua que ainda está no
futuro.

Três casos, todos verificados por teste:

- Tarefa criada quinta 14h, prazo sexta → pula o de 36h (quinta 08:00, já
  passou), envia o de 24h (quinta 20:00)
- Tarefa criada sexta 10h, prazo sexta → pula 36h, 24h e o das 09:00; o primeiro
  é o das 15:00
- Tarefa criada sexta 22h, prazo sexta → nasce atrasada; nenhum lembrete de
  prazo, entra direto na régua de atraso no próximo momento (sábado 09:00)

A mensagem de criação (`demanda solicitada`) é a **única que nunca é pulada** —
sai sempre, independentemente do prazo.

Caso extremo coberto: tarefa criada hoje com prazo da semana passada não dispara
as 9 cobranças de uma vez. Entra no próximo momento da régua e segue dali.

### Parte 5 — prazo readequado

Evento `taskDueDateUpdated`, ou diferença de `due_date` detectada na varredura.

No PV do responsável:

```
📅 PRAZO READEQUADO

"5ª Remessa - Anúncios Em Vídeo"
De 05/09 → para 12/09

Cobrança reiniciada a partir da nova data.
```

No grupo:

```
📅 Prazo adiado — 2ª vez
"5ª Remessa - Anúncios" · Reinaldo
05/09 → 12/09  (originalmente 29/08)
```

A contagem de vezes vem de `clickup_notificacoes`, contando as linhas de tipo
`prazo_readequado` daquela tarefa. A data original é a `referencia` da primeira.

Efeito colateral desejado: uma tarefa que já saiu da cobrança automática
(passou de D+4) **volta a ser cobrada** ao ganhar prazo novo, porque a
`referencia` mudou e toda a régua re-arma. É o comportamento que o usuário pediu
ao renegociar prazo.

## Roteamento — quem recebe

Destinatários de um aviso de PV, nesta ordem:

1. Os responsáveis da tarefa no ClickUp que existirem em `clickup_pessoas` com
   `ativo = true`. Se forem dois, os dois recebem.
2. Se a tarefa não tem responsável: o Darlan, com o texto marcando
   "essa demanda está sem responsável".
3. Se o responsável existe no ClickUp mas não em `clickup_pessoas`: o Darlan,
   com o texto marcando "sem WhatsApp cadastrado". Silêncio nesse caso seria
   invisível.

O "grupo" é um único grupo de WhatsApp contendo apenas o Darlan.

Mapa inicial (7 pessoas):

| Pessoa | ClickUp ID | WhatsApp |
|---|---|---|
| Reinaldo Lourenço Filho | 75338687 | 5519996821238 |
| Juninho Veiga | 3150382 | 557998451586 |
| pedro roncada | 228258896 | 5518981740373 |
| darlan rafael ferreira coelho | 55169759 | 5511973759529 |
| Felipe Vieira | 101303779 | 5511988350249 |
| Caillan | a cadastrar | 5527988789747 |
| Ana Américo | a cadastrar | 5514998751426 |

Rec Móbile (94202547, rec.mobile2@gmail.com) tem 6 tarefas abertas e ainda não
tem destino definido — ver "Pendências".

Nota sobre o número do Juninho: 12 dígitos, sem o nono dígito. É o formato que o
WhatsApp usa internamente para DDDs de 31 para cima. Confirmado duas vezes pelo
usuário. Será validado por `POST /contacts/verify` antes do primeiro envio real.

## Agrupamento

Vale **apenas** para os avisos de régua (partes 2 e 3), que são disparados pelo
relógio. Eventos de status não são agrupados.

A regra: para cada (pessoa, momento da régua), sai **uma** mensagem, listando
todas as tarefas dela naquele estágio.

```
🔔 Bom dia, Reinaldo!

Você tem 3 demandas vencendo hoje (05/09).
Precisam estar finalizadas até as 20h:

  1. VSL NOVA COM ADS - CLICKBAIT
  2. 5ª Remessa - Anúncios Em Vídeo
  3. ROTEIRO VSL - DENISE

Qualquer impedimento, me avise.
```

Efeito medido contra os prazos reais de 21/08: o total de 14 dias cai de 433
para 248 mensagens, e o pior dia individual do Darlan cai de 34 para 9.

Teto garantido: ninguém recebe mais de **9 mensagens de régua por dia**, que é o
número de momentos distintos na régua.

Consequência da trava anti-repetição: como a chave inclui `task_id`, uma
mensagem agrupada gera **uma linha por tarefa** em `clickup_notificacoes`,
todas com o mesmo `destinatario` e `tipo`. Se uma tarefa nova entrar no mesmo
estágio depois do envio, ela dispara sua própria mensagem no momento seguinte —
não reabre a anterior.

## O panorama

Três por dia, no grupo: **10:00, 15:00 e 20:30**.

Blocos, nesta ordem:

| # | Bloco | Conteúdo | Limite |
|---|---|---|---|
| 1 | ⏳ PENDENTE ACEITAÇÃO | status `demanda solicitada` | 4 |
| 2 | ✋ ACEITAS, NÃO INICIADAS | status `demanda recebida` | 4 |
| 3 | 🔄 EM PROCESSO | status `em processo` | 4 |
| 4 | 👁 AGUARDANDO SUA REVISÃO | status `solicitação de revisão` | 4 |
| 5 | ↩️ RECUSADAS, EM CORREÇÃO | status `demanda recusada` | 4 |
| 6 | ✅ ENTREGUES DESDE `<hora>` | chegou em `demanda aprovada` ou `concluído` desde o panorama anterior | 4 |
| 7 | ⚠️ ATRASADAS POR RESPONSÁVEL | agregado por pessoa | todos |
| 8 | 📝 PRECISA DE VOCÊ | contagem de sem responsável e sem prazo | — |

Ordem dentro de cada bloco: **mais urgente primeiro** — mais tempo parado, ou
mais perto de estourar. O cabeçalho sempre mostra o total real, mesmo quando a
lista é cortada, para não perder a dimensão.

O bloco 7 substitui a lista solta de atrasadas. Cinco linhas cobrem todos os
atrasos; quatro linhas cobririam 4 de 20. Tarefa com dois responsáveis conta
para os dois, então a soma das linhas passa do total — por isso o total real vai
no cabeçalho.

O bloco 6 é o único que é delta. Período: desde o panorama anterior. O das 10:00
cobre das 20:30 do dia anterior até as 10:00. Na primeira execução, quando não
existe panorama anterior registrado, o período são as últimas 12 horas.

O 🔴 marca quem passou de 4 dias e saiu da cobrança automática, com a legenda ao
pé do bloco.

Exemplo montado com dados reais de 21/08/2026, 774 caracteres:

```
📋 SPR — PANORAMA 15h · 21/08

⏳ PENDENTE ACEITAÇÃO — 105
   • Edição Aulas - Como Ser Perdoado — Rec · há 18d
   • NOVO PRODUTO - UPSELL — SEM RESPONSÁVEL · há 15d
   • DESCRICÃO DOS VÍDEO DE DISPARO CO… — Juninho + Reinaldo + Darlan · há 15d
   • VSL PERÉTUO 5 FASES DENISE — Juninho · há 15d
   ... e mais 101

✋ ACEITAS, NÃO INICIADAS — 0
🔄 EM PROCESSO — 0
👁 AGUARDANDO SUA REVISÃO — 0
↩️ RECUSADAS, EM CORREÇÃO — 0
✅ ENTREGUES DESDE AS 10h — 0

⚠️ ATRASADAS POR RESPONSÁVEL — 20
   • Rec Móbile — 1 · até 17 dias 🔴
   • Darlan — 12 · até 10 dias 🔴
   • Juninho — 6 · até 8 dias 🔴
   • Reinaldo — 5 · até 6 dias
   • Pedro — 1 · até 1 dia

   🔴 = passou de 4 dias, fora da cobrança automática

📝 PRECISA DE VOCÊ
   • 34 sem responsável
   • 44 sem prazo
```

Nomes de tarefa são cortados em 34 caracteres. Vários títulos do workspace são
longos e sem corte a mensagem quebra a leitura.

## O fluxo de copy

Gatilho: status muda para `demanda aprovada` **e** a tarefa tem a etiqueta
`copy`.

Sem a etiqueta, `demanda aprovada` faz apenas o normal — PV do responsável e
aviso no grupo. Nenhum outro braço vai para o Pedro automaticamente.

Com a etiqueta, na ordem:

1. Cria a pasta no Google Drive — **estrutura pendente**, ver "Pendências"
2. Reatribui a tarefa ao Pedro Roncada no ClickUp *(escrita)*
3. Volta o status para `demanda solicitada` *(escrita)*
4. Envia **uma** mensagem no PV do Pedro, contendo o link do Drive e o link da
   tarefa
5. Avisa no grupo

Sobre o passo 4: mudar o status para `demanda solicitada` faria a régua disparar
o aviso normal de nova demanda. Seriam duas mensagens quase iguais. Para evitar,
o fluxo de copy **grava a notificação de `demanda solicitada` antes de fazer a
escrita**, com o texto ampliado (incluindo o link do Drive). Quando a
sincronização seguinte detectar a mudança de status, a trava anti-repetição já
encontra a linha gravada e não envia de novo. Uma mensagem, com tudo dentro.

**Este fluxo depende de quatro pendências** — itens 9 a 12 de "Pendências": a
estrutura de pastas do Drive, o prazo do ciclo do Pedro, se a tarefa muda de
lista/espaço, e a autorização para escrever no ClickUp.

Se essas quatro não estiverem resolvidas quando a implementação começar, **o
fluxo de copy sai desta entrega** e `demanda aprovada` se comporta como
qualquer outro status: PV do responsável e aviso no grupo, sem Drive, sem
reatribuição. O resto da entrega não depende dele em nada.

## Escritas no ClickUp

O token do ClickUp permite ler **e escrever**. Durante todo o desenho ele foi
usado somente para leitura.

Esta entrega escreve no ClickUp em **exatamente dois pontos**, ambos dentro do
fluxo de copy:

1. Reatribuir a tarefa ao Pedro
2. Mudar o status para `demanda solicitada`

Nenhuma outra operação escreve. Não há criação, exclusão, comentário, mudança
de prazo ou de etiqueta partindo do robô.

Antes de a implementação incluir esses dois pontos, é necessária a autorização
explícita do usuário. Se ela não vier, o fluxo de copy entrega apenas o aviso no
PV do Pedro com os links, e a reatribuição fica manual.

## A camada D-API

Um arquivo, `lib/clickup/dapi.ts`, expõe duas funções:

```
enviarTexto(paraNumero: string, texto: string): Promise<void>
enviarGrupo(texto: string): Promise<void>
```

O resto do módulo não sabe qual provedor está por trás.

Contrato verificado na documentação em 21/08/2026:

- `POST https://api.d-api.cloud/api/v1/messages/send/text`
- Header `Authorization: <API_KEY>` — sem `Bearer`
- Corpo: `{ sessionId, to, text }`
- `to` em dígitos puros, sem `+` e sem `@s.whatsapp.net` — **mesmo formato da
  Z-API**, então `normalizarTelefoneBR` serve sem alteração
- Grupo usa o mesmo endpoint, trocando `to` pelo JID do grupo
- `GET /api/v1/groups` lista os grupos da sessão — é assim que o JID do grupo é
  descoberto, sem o usuário precisar procurar
- `POST /api/v1/contacts/verify` confere se um número existe no WhatsApp
- `GET /api/v1/sessions` devolve o status da sessão

Sessão escolhida: **MARIANA - OFICIAL**, número 5511987420791.

Antes de qualquer envio em lote, `enviarTexto` verifica o status da sessão. Se
não estiver `connected`, nada é enviado e as notificações ficam em `falha` para
a próxima varredura — sem consumir tentativas.

Risco registrado e aceito pelo usuário: o número é compartilhado com outra
operação. Se for bloqueado por excesso de disparo, as duas coisas param juntas.

## Trava anti-repetição

Antes de enviar qualquer mensagem:

1. `INSERT` em `clickup_notificacoes` com estado `enviando`
2. Se a constraint `UNIQUE` rejeitar, já foi enviada — não envia
3. Envia pela D-API
4. `UPDATE` para `enviado` com `enviado_em`, ou para `falha` com o erro e
   `tentativas + 1`

A reserva vem antes do envio de propósito. Se o processo morrer entre 1 e 3, a
linha fica em `enviando` — e uma linha em `enviando` há mais de 10 minutos é
tratada como `falha` na varredura seguinte, elegível para nova tentativa.

Máximo de 3 tentativas por notificação. Depois disso, a linha fica em `falha`
definitiva e entra num aviso no grupo, uma vez por dia:

```
⚠️ 3 mensagens não foram entregues hoje.
Verifique a conexão do WhatsApp.
```

Silêncio aqui seria o pior resultado: o robô parecendo funcionar sem nada
chegando.

## Relógio e monitoramento

Um serviço externo gratuito (cron-job.org) chama:

```
POST /api/clickup/sincronizar
Header: X-Cron-Secret: <CLICKUP_CRON_SECRET>
```

Em dois ritmos, por motivos diferentes:

**Nos 11 horários exatos da régua** — para a mensagem sair no minuto certo, não
"em algum momento nos próximos 15 minutos":

```
08:00  36h antes do vencimento
09:00  dia D · 1º dia de atraso
10:00  panorama
12:00  cobranças de atraso (D+2, D+3, D+4)
15:00  dia D · panorama
16:00  cobrança (D+2)
18:00  cobrança (D+1)
19:30  último aviso do dia D
20:00  24h antes · cobrança (D+3)
20:30  panorama
21:00  aviso de atraso (D) · cobrança (D+2)
```

**Mais uma passada a cada hora**, como rede de segurança. Ela normalmente não
envia nada: existe para o caso de o webhook do ClickUp falhar. Sem ela, o
buraco entre 12:00 e 15:00 deixaria um `demanda recusada` até 3 horas parado.

São 24 chamadas por dia. Foi a alternativa escolhida em cima de uma varredura de
15 em 15 minutos (96 chamadas), que daria a mesma cobertura com horários
imprecisos.

Em qualquer um dos dois ritmos, a sincronização dispara **todo momento cujo
horário já passou e que ainda não foi enviado**, não apenas o do minuto exato.
Isso cobre chamada atrasada, chamada perdida, deploy no meio e servidor fora do
ar por algumas horas.

Três camadas de monitoramento, deliberadamente fora umas das outras:

1. **cron-job.org** avisa por e-mail quando o endpoint não responde. Vive fora
   da nossa infraestrutura — foi o que faltou no n8n, onde o alerta de que o n8n
   tinha caído morava dentro do próprio n8n.
2. **`clickup_execucoes`** registra cada sincronização. O panorama inclui uma
   linha de alerta se a última foi há mais de 90 minutos — com a passada de hora
   em hora, o intervalo normal nunca passa de 60.
3. **Falhas de envio** viram aviso no grupo, uma vez por dia.

## Segurança

- `DAPI_KEY`, `CLICKUP_TOKEN`, `CLICKUP_WEBHOOK_SECRET` e `CLICKUP_CRON_SECRET`
  ficam em `.env.local` e nas variáveis da Vercel. Confirmado que `.env*` está
  no `.gitignore` (linha 34).
- O endpoint de webhook valida o header `X-Signature`: HMAC-SHA256 do corpo cru
  da requisição com o secret devolvido na criação do webhook. Requisição sem
  assinatura válida é rejeitada com 401, sem processar nada.
- O endpoint de sincronização exige `X-Cron-Secret`, mesmo padrão do
  `WHATSAPP_CRON_SECRET` já em uso.
- Nenhum dado do módulo de terapeutas ou do financeiro é lido ou escrito.

## Tratamento de erro

| Falha | Comportamento |
|---|---|
| ClickUp fora do ar | A varredura aborta sem gravar estado. Nada é perdido; a próxima refaz. |
| ClickUp 429 (limite de 100 req/min) | A varredura usa a consulta filtrada por workspace: 2 requisições para 105 tarefas. Margem larga. |
| Sessão D-API desconectada | Nenhum envio é tentado; notificações ficam pendentes sem gastar tentativa. |
| D-API devolve erro | `falha` + retry, até 3 vezes. |
| Webhook com assinatura inválida | 401, sem processar. |
| Webhook suspenso pelo ClickUp | A varredura cobre. Perde-se a instantaneidade, não o aviso. |
| Pessoa sem WhatsApp cadastrado | Aviso vai para o Darlan, marcado. Nunca silêncio. |
| Tarefa sem responsável | Aviso vai para o Darlan, marcado. |
| Tarefa sem prazo | Nenhuma régua de prazo. Aparece na contagem do bloco 8. |

## Testes

Seguem o padrão do projeto: `npm test` → `tsx --test lib/**/*.test.ts`.

Funções puras, testáveis sem rede nem banco:

- `regua.ts` → `momentosDaRegua(prazo, temHora)` devolve os 14 momentos com data
  e hora corretos; casos com e sem hora, e a janela 08:00–21:00
- `regua.ts` → `avisosDevidos(estado, agora, jaEnviados)` — cobre os três casos
  de "nada retroativo", a tarefa que nasce atrasada, e a saída em D+5
- `estado.ts` → `diff(anterior, atual)` — mudança de status, de prazo, de
  responsável, de etiqueta; e o caso de nenhuma mudança (webhook duplicado)
- `panorama.ts` → `montarPanorama(tarefas, desde)` — corte em 4, total real no
  cabeçalho, ordenação por urgência, agregação por pessoa com dupla contando
  para os dois
- `mensagens.ts` → `agruparPorPessoa(avisos)` — 3 tarefas viram 1 mensagem
- `telefone.ts` → os 10 testes copiados de `lib/telefone.test.ts`

Os arquivos que falam com rede (`clickup-api.ts`, `dapi.ts`) não têm teste
automatizado, seguindo o padrão do projeto. São verificados por chamada real
durante a implementação.

## Pendências antes de implementar

Do usuário, no ClickUp:

1. Apagar os status `para fazer` e `a fazer`, remapeando as 105 tarefas abertas
   para `demanda solicitada`
2. Colocar `demanda solicitada` no grupo "Not started" e `concluído` no grupo
   "Done"
3. Criar a etiqueta `copy` nos **dois** espaços (etiqueta é por espaço; o espaço
   AÇÕES ASCENSÃO não tem nenhuma hoje)
4. Cadastrar Caillan e Ana Américo como membros
5. Definir o destino da conta Rec Móbile (6 tarefas abertas): fica, sai, ou vira
   a conta da Ana
6. Renomear as 3 listas chamadas literalmente "List"

Do usuário, no WhatsApp e na D-API:

7. Criar o grupo com apenas ele e o número da sessão dentro
8. Manter a sessão **MARIANA - OFICIAL** conectada

Decisões ainda em aberto:

9. Estrutura de pastas do Google Drive
10. Prazo do ciclo do Pedro no fluxo de copy — sem prazo, não há régua
11. Se a tarefa de copy muda de lista/espaço, além de mudar de responsável
12. Autorização explícita para as duas escritas no ClickUp
13. Criar as 12 tarefas no cron-job.org (11 horários da régua + a de hora em
    hora), apontando para o endpoint de sincronização com o segredo no header

## Fora de escopo, registrado para não se perder

- Roteamento entre braços (entrega 2)
- Criação de pasta no Drive automatizada (entrega 3) — depende do item 9
- Substituir as Automations nativas do ClickUp
- Detecção de tarefa parada sem prazo definido: hoje 44 tarefas não têm prazo e
  ficam fora de qualquer régua. Aparecem no bloco 8 do panorama como contagem,
  mas ninguém é cobrado por elas.
- Cobrança por tempo sem movimento (49 tarefas sem toque entre 8 e 30 dias). A
  régua cobre prazo, não inatividade.
