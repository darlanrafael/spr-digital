# Gestor de Projetos — ClickUp

> **Arquivo de referência do módulo de automação do ClickUp.** Separado do
> `spr-digital.md` de propósito: são dois sistemas que não trocam nenhum dado.
> O `spr-digital.md` documenta o DRE financeiro e o módulo de terapeutas.

---

## 0. Estado — atualizado 21/08/2026

**Desenhado e aprovado. Nada foi construído.**

Spec completa: `docs/superpowers/specs/2026-08-21-gestor-projetos-clickup-design.md`

O que o módulo vai fazer: cobrar as demandas do ClickUp por WhatsApp, no privado
de cada responsável, e mandar três panoramas por dia num grupo só do Darlan.

Entregas planejadas, nesta ordem:

1. **Cobrador + panorama** ← a spec de 21/08 cobre esta
2. Roteamento entre braços
3. Criação de pasta no Google Drive

---

## 1. Por que existe

Auditoria de 21/08/2026, com 105 tarefas abertas no ClickUp:

| | |
|---|---|
| sem responsável | 34 (32%) |
| sem prazo | 44 (41%) |
| vencidas | 27, a mais antiga há 17 dias |
| sem nenhum toque entre 8 e 30 dias | 49 |
| paradas no status `para fazer` | 99 |

Nada disso gera aviso. O único mecanismo hoje é o Darlan lembrar de abrir o
ClickUp e olhar.

---

## 2. Coordenadas do ClickUp

Custam tempo pra redescobrir. Levantadas por API em 21/08/2026.

| | |
|---|---|
| Workspace | **SQUAD - PEDRO RONCADA** = `90171441939` |
| Space 1 | `90176754482` — SQUAD - PEDRO RONCADA |
| Space 2 | `90176916232` — AÇÕES ASCENSÃO \| FUNIS |

- 16 braços distintos espalhados por 38 listas
- Ambos os spaces já têm o fluxo completo de status; nenhuma lista usa
  `override_statuses`
- Etiquetas existentes no Space 1: `produto`, `debriefing`. O Space 2 não tem
  nenhuma. A etiqueta `copy` (usada pelo fluxo de aprovação) **ainda precisa ser
  criada nos dois** — etiqueta no ClickUp é por space.

### Fluxo de status

```
demanda solicitada → demanda recebida → em processo
                                            ↓
                          solicitação de revisão
                            ↓                ↓
                  demanda recusada    demanda aprovada → concluído → demanda fechada
```

### Membros do workspace

| Pessoa | ClickUp ID | E-mail | WhatsApp |
|---|---|---|---|
| Reinaldo Lourenço Filho | 75338687 | hirosereinaldo@gmail.com | 5519996821238 |
| Juninho Veiga | 3150382 | juniinhoveiga@gmail.com | 557998451586 |
| pedro roncada | 228258896 | pedroroncadapr@outlook.com | 5518981740373 |
| darlan rafael ferreira coelho | 55169759 | darlan.rafael@yahoo.com.br | 5511973759529 |
| Felipe Vieira | 101303779 | felipevieirabox@gmail.com | 5511988350249 |
| Rec Móbile | 94202547 | rec.mobile2@gmail.com | *destino indefinido* |
| Caillan | *a cadastrar* | — | 5527988789747 |
| Ana Américo | *a cadastrar* | — | 5514998751426 |

O número do Juninho tem 12 dígitos, sem o nono. É o formato que o WhatsApp usa
internamente para DDDs de 31 pra cima. Confirmado duas vezes pelo usuário.

---

## 3. Decisões estruturais

Valem além da primeira entrega.

**Módulo isolado.** `app/api/clickup/` e `lib/clickup/`, tabelas com prefixo
`clickup_`, nenhum arquivo existente tocado. Pedido explícito do usuário: *"meu
medo é misturar e virar uma farofa tudo"*. O módulo de terapeutas é o
precedente — seus 16 arquivos importam apenas de si mesmos e de
`@/lib/supabase`, nunca do lado financeiro.

**Webhook e varredura chamam a mesma função.** O webhook é acelerador, não
caminho alternativo com lógica própria. Se ele morrer, nada se perde — só deixa
de ser instantâneo.

**Relógio externo** (cron-job.org) nos 11 horários da régua + 1 por hora, em vez
de Vercel Cron. O motivo é a lição do n8n: em 17/08 ele ficou 4 dias fora do ar
e ninguém soube, porque o alerta que avisaria morava dentro do próprio n8n. O
vigia tem que ficar do lado de fora.

**Cópia em vez de import.** `lib/clickup/telefone.ts` é cópia de
`lib/telefone.ts`, não import. São 30 linhas. Assim um ajuste no fluxo dos
pacientes não altera o robô sem ninguém perceber, e vice-versa.

**Modo fila.** Decidido em 22/08, no lugar de remapear as 104 tarefas de uma
vez. O status `para fazer` continua existindo e vira fila de espera: tarefa
parada lá não gera aviso nem cobrança. O Darlan solta uma a uma para
`demanda solicitada`, no ritmo dele, readequando o prazo na hora de soltar — sem
prazo novo, a régua não dispara nada, porque nunca manda aviso de horário que já
passou.

**Marco zero.** Tudo que já existia no ClickUp antes de o módulo entrar no ar é
registrado em silêncio, sem gerar aviso. Sem essa regra, o primeiro minuto do
sistema mandaria mais de cem mensagens de uma vez.

**O token do ClickUp lê E escreve.** Foi usado só para leitura em todo o
desenho. A implementação escreve em exatamente dois pontos, ambos no fluxo de
copy (reatribuir ao Pedro, voltar o status), e só com autorização explícita.

---

## 4. Variáveis de ambiente

Ficam no mesmo `.env.local` do projeto. `.env*` está no `.gitignore` (linha 34).

```env
# ── ClickUp ────────────────────────────────────────────────────────────────
CLICKUP_TOKEN=pk_...                 # token pessoal, LÊ E ESCREVE
CLICKUP_WEBHOOK_SECRET=...           # devolvido ao criar o webhook; valida X-Signature
CLICKUP_CRON_SECRET=...              # protege /api/clickup/sincronizar

# ── D-API (WhatsApp não-oficial) ───────────────────────────────────────────
DAPI_KEY=...
DAPI_SESSION_ID=MARIANA - OFICIAL    # sessão conectada ao número 5511987420791
DAPI_GRUPO_JID=...                   # descoberto por GET /api/v1/groups
```

**Onde encontrar:**

- `CLICKUP_TOKEN`: ClickUp → foto do perfil → Settings → Apps → API Token
- `DAPI_KEY`: painel `app.d-api.cloud`

---

## 5. Contrato da D-API

Base: `https://api.d-api.cloud/api/v1`
Header: `Authorization: <API_KEY>` — **sem** `Bearer`

| O quê | Endpoint |
|---|---|
| Enviar texto | `POST /messages/send/text` — `{sessionId, to, text}` |
| Enviar pra grupo | mesmo endpoint, `to` = JID do grupo |
| Listar grupos | `GET /groups` |
| Verificar número | `POST /contacts/verify` |
| Status da sessão | `GET /sessions` |

`to` em dígitos puros, sem `+` e sem `@s.whatsapp.net` — **mesmo formato da
Z-API**, então `normalizarTelefoneBR` serve sem alteração.

Sessão em uso: **MARIANA - OFICIAL**, número `5511987420791`.

Risco registrado e aceito: o número é compartilhado com outra operação. Se for
bloqueado por excesso de disparo, as duas coisas param juntas.

---

## 6. Pendências antes de implementar

No ClickUp:

1. ~~Apagar os status `para fazer` e `a fazer`~~ — **cancelado em 22/08.** Eles
   ficam como fila de espera (ver "Modo fila"). No lugar: readequar o prazo das
   tarefas atrasadas e ir soltando para `demanda solicitada` conforme a
   prioridade
2. Colocar `demanda solicitada` no grupo "Not started" e `concluído` no grupo "Done"
3. Criar a etiqueta `copy` nos **dois** spaces
4. Cadastrar Caillan e Ana Américo como membros
5. Definir o destino da conta Rec Móbile (6 tarefas abertas)
6. Renomear as 3 listas chamadas literalmente "List"

No WhatsApp e na D-API:

7. Criar o grupo com apenas o Darlan e o número da sessão dentro
8. Manter a sessão **MARIANA - OFICIAL** conectada

Decisões ainda em aberto:

9. Estrutura de pastas do Google Drive
10. Prazo do ciclo do Pedro no fluxo de copy — sem prazo, não há régua
11. Se a tarefa de copy muda de lista/space, além de mudar de responsável
12. Autorização explícita para as duas escritas no ClickUp
13. Criar as 12 tarefas no cron-job.org

---

## 7. Histórico

**22/08/2026** — Documentação separada em `clickup.md` (antes estava dentro do
`spr-digital.md`) e regra escrita no `CLAUDE.md`: mudança de ClickUp atualiza
este arquivo, nunca o outro. Modo fila e marco zero acrescentados à spec, no
lugar do remapeamento em massa. Descoberto que `GET /groups` da D-API devolve
500 na sessão atual, provavelmente por causa de `ignoreGroups: true` nas
configurações da sessão.

**21/08/2026** — Desenho completo levantado com o usuário ao longo de várias
conversas. Auditoria do ClickUp por API, definição da régua de cobrança,
decisão de roteamento por responsável (em vez de por braço), escolha do D-API
sobre a Z-API, decisão de manter o módulo dentro do projeto atual com
isolamento rigoroso, e troca da varredura de 15 em 15 minutos por horários
fixos. Spec escrita, auto-revisada e commitada. Nada implementado.
