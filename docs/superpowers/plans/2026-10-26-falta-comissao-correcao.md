# Falta (não compareceu) → aprovação de comissão — CORREÇÃO (v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Marcar "não compareceu" consome a sessão (paciente perde, pacote anda) e, para terapeuta contratado (não-sócio), manda a comissão para aprovação do dono — sem furos de dinheiro.

**Architecture:** Em vez de ZERAR a comissão da sessão e restaurar depois (modelo v1, com furo contra o fechamento), a sessão mantém o `comissao_valor` INTACTO e ganha uma trava `comissao_bloqueada`. Bloqueada = fora do "a pagar" (dashboard) e fora do sweep do fechamento. Aprovar desbloqueia; "não pagar" mantém bloqueada para sempre. A tabela `solicitacoes_falta_comissao` guarda o pedido e a decisão (fila/auditoria), mas quem GATEIA a comissão é a trava na sessão, não um valor duplicado.

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Supabase (Postgres). Testes: `tsx --test`. Migrations: `supabase/migrations/*.sql`.

**Spec:** Regras confirmadas pelo dono nos itens 123.3 e 125 do `spr-digital.md`, mais os achados dos 3 revisores adversariais (25/10/2026). Este plano substitui a implementação v1 (ainda não deployada; será reescrita).

## Global Constraints

- O `comissao_valor` da sessão NUNCA é zerado por este fluxo (lição do furo v1). A trava é `comissao_bloqueada boolean`.
- Comissão só conta ("a pagar") quando a falta é aprovada. Nunca antes, nunca após "não pagar".
- Decisão de pagar/não pagar e aprovação de comissão são de ADMIN (`podeAdministrar`), com senha. Mesma guarda da rota de reembolso.
- Regra do sócio: o Pedro (sócio) nunca gera comissão de falta nem vai para aprovação — recebe no fechamento. "Contratado" = qualquer terapeuta que não seja o sócio → vai para aprovação.
- Todo `tipo_acao` (atividades_log) e `tipo` (ocorrencias_prontuario) novo PRECISA estar na allow-list da migration, senão falha silenciosa 23514 (já quebrou 4x neste projeto).
- Decisão do dono (25/10/2026): a falta CONTA como sessão entregue (pacote avança, entra na contagem de entregues/ticket médio e no desconto de reembolso parcial). É intencional — "o paciente perdeu a sessão". Não filtrar.
- Regra vale "daqui pra frente": no-shows antigos (status ainda `agendada` + status_consulta `nao_compareceu`) ficam como estão.

## Review Focus

- Sessão em estado não-marcável (cancelada/reembolsada, já entregue, ou futura) recebendo "não compareceu" → deve ser recusada (Task 3 testa cancelada/entregue/futuro).
- Fechamento rodado ANTES da decisão da falta → a sessão bloqueada não pode ser varrida nem marcada paga (Task 5 testa sweep ignora bloqueada).
- `anular` de uma sessão que é falta → deve cancelar a falta e destravar, sem perder dinheiro (Task 6 testa).
- Decisão concorrente (Pagar + Não pagar, ou duplo clique) → só a primeira vale (Task 4 testa update condicional `.eq('status','pendente')` + linhas afetadas).
- `concluir` individual numa sessão já consumida como falta (via API) → recusado (Task 7 testa sessaoConcluivel no concluir).

---

### Task 1: Migration (schema da v2)

**Files:**
- Create: `supabase/migrations/20261026000000_falta_comissao_v2.sql`
- Delete: `supabase/migrations/20261025000000_solicitacoes_falta_comissao.sql` (v1 nunca aplicada; substituída)

**Interfaces:**
- Produces: coluna `sessoes.comissao_bloqueada boolean not null default false`; tabela `solicitacoes_falta_comissao` com `status in ('pendente','aprovado','negado','cancelado')`; `ocorrencias_prontuario_tipo_check` + `atividades_log_tipo_acao_check` com os tipos novos.

- [ ] **Step 1: Escrever a migration.** Conteúdo:
  - `alter table sessoes add column if not exists comissao_bloqueada boolean not null default false;`
  - `create table if not exists solicitacoes_falta_comissao (...)` igual à v1 (molde: `20260909000000_solicitacoes_lancamento_manual.sql`), MAS sem a coluna/ideia de "valor que volta" como fonte da verdade — `comissao_valor` aqui é só para exibir na fila; o check de status inclui `'cancelado'`: `check (status in ('pendente','aprovado','negado','cancelado'))`; `unique(sessao_id)`.
  - `drop constraint ocorrencias_prontuario_tipo_check` + re-add com a lista atual (`nota, remarcacao, confirmacao_entrega, solicitacao_reembolso, reembolso_aprovado, reembolso_rejeitado, orientacao_sessao, nao_compareceu`) MAIS `falta_comissao_aprovada, falta_comissao_negada`.
  - `drop constraint atividades_log_tipo_acao_check` + re-add com a lista do `20260901000000` MAIS `nao_compareceu, solicitacao_falta_comissao, falta_comissao_aprovada, falta_comissao_negada`.
- [ ] **Step 2: Commit.** `git add` a migration nova + remoção da v1; `git commit -m "feat(db): migration v2 da falta (trava comissao_bloqueada + constraints)"`.

> Migration é SQL; sem teste automatizado. É aplicada em produção manualmente no deploy (não agora).

---

### Task 2: Helpers puros da falta (v2)

**Files:**
- Modify: `lib/falta-comissao.ts`
- Test: `lib/falta-comissao.test.ts`

**Interfaces:**
- Produces: `planejarFalta({ ehSocio, temComissao, numeroSessao, usuarioNome, agoraMs })` → `{ updateData: { status:'entregue', status_consulta:'nao_compareceu', data_entrega, concluido_em, entregue_confirmado_por, comissao_bloqueada: boolean }, ocorrenciaTitulo, ocorrenciaDesc, criarFalta: boolean }`. NÃO mexe em `comissao_valor`. `comissao_bloqueada = !ehSocio && temComissao ? true : (ehSocio ? true : false)` — ver step 1. `criarFalta = !ehSocio && temComissao`. `decisaoDaFalta` permanece, mas agora devolve `{ novoStatusFalta, desbloquear: boolean }` (não mais valor de comissão).

- [ ] **Step 1: Reescrever os testes** (`lib/falta-comissao.test.ts`) para a v2: (a) contratado com comissão → `comissao_bloqueada:true`, `criarFalta:true`, e `updateData` NÃO contém `comissao_valor`; (b) sócio → `comissao_bloqueada:true`, `criarFalta:false`; (c) contratado sem comissão → `criarFalta:false`, `comissao_bloqueada:false`; (d) prontuário título/desc com hora de Brasília; (e) `decisaoDaFalta('pagar')` → `{novoStatusFalta:'aprovado', desbloquear:true}`; (f) `decisaoDaFalta('nao_pagar')` → `{novoStatusFalta:'negado', desbloquear:false}`.
- [ ] **Step 2: Rodar e ver falhar.** `npx tsx --test lib/falta-comissao.test.ts` → FAIL.
- [ ] **Step 3: Implementar a v2** em `lib/falta-comissao.ts` (trocar `ehPedro`→`ehSocio`, `comissaoValorSessao`→`temComissao: boolean`, tirar `comissao_valor:0` e `faltaComissaoValor`, `decisaoDaFalta` devolve `desbloquear`).
- [ ] **Step 4: Rodar e ver passar.** PASS.
- [ ] **Step 5: Commit.**

---

### Task 3: Ação "não compareceu" (v2) + guardas + detecção do sócio

**Files:**
- Modify: `app/api/terapeutas/sessoes/route.ts` (branch `acao==='nao_compareceu'` e o bloco de criação da falta)
- Create: `lib/socio.ts` + `lib/socio.test.ts` (helper `ehPedroSocio(nome: string): boolean` — normaliza acentos/caixa e casa "pedro" como palavra; documenta que o ideal futuro é uma flag `eh_socio` em `terapeutas`)

**Interfaces:**
- Consumes: `planejarFalta` (Task 2), `ehPedroSocio` (este), `sessaoConcluivel` (lib/conclusao-da-sessao.ts) reutilizada como "estado marcável".
- Produces: PATCH que, em `nao_compareceu`: recusa se status não ∈ (agendada,pendente) OU se `data_agendada` ainda não passou; resolve `ehSocio` pelo nome do terapeuta da sessão; se terapeuta indefinido → `criarFalta=false` (consome sem falta); cria a falta ANTES de consumir a sessão, com erro conferido; seta `comissao_bloqueada` conforme o plano.

- [ ] **Step 1: Testes** de `ehPedroSocio` (`lib/socio.test.ts`): "Pedro Roncada"→true; "Pedro"→true; "Denise Nascimento"/"Leomir Santos"→false; "Pedro Henrique" (outro) → DECIDIR no plano: casa só "pedro" isolado, então "Pedro Henrique"→true (documentar a fragilidade e o TODO da flag). Normaliza "PEDRO"/"pédro".
- [ ] **Step 2: Rodar e ver falhar.** FAIL.
- [ ] **Step 3: Implementar `ehPedroSocio`.** PASS.
- [ ] **Step 4: Reescrever o branch `nao_compareceu`** em `app/api/terapeutas/sessoes/route.ts`: guarda `if (!['agendada','pendente'].includes(s.status)) return 409`; guarda de data passada (`fimEfetivoSessao`/`data_agendada < agora`); `ehSocio = ehPedroSocio(s.terapeutas?.nome ?? '')`; `temComissao = Number(s.comissao_valor ?? 0) > 0`; usar `planejarFalta`; inserir a falta antes do update da sessão (insert normal, tratar conflito 23505 → já existe, abortar antes de consumir); conferir todos os erros.
- [ ] **Step 5: Verificar no app rodando** (skill `run`, sem mutar produção): smoke não-destrutivo da rota + tsc + suíte toda verde.
- [ ] **Step 6: Commit.**

---

### Task 4: Rota de aprovação (decisão atômica + auth)

**Files:**
- Modify: `app/api/terapeutas/aprovacoes/falta-comissao/route.ts`

**Interfaces:**
- Consumes: `decisaoDaFalta` (Task 2).
- Produces: PATCH atômico. `update solicitacoes_falta_comissao set status=... where id=? and status='pendente'` com `.select()` → se 0 linhas, 409 "já decidida" (mata a corrida). "Pagar" → além disso `update sessoes set comissao_bloqueada=false where id=? and status='entregue' and status_consulta='nao_compareceu'`; se 0 linhas, reverter a falta para 'pendente' e 500 "sessão mudou de estado, confira". "Não pagar" → só marca negado (sessão continua bloqueada). Ordem da auth: identidade+papel ANTES da senha (evita oráculo de senha); exigir `usuario_email === quem.email`.

- [ ] **Step 1..N (TDD onde der):** a lógica pura (`decisaoDaFalta`) já é testada na Task 2; o route é I/O. Escrever um teste de fumaça da ORDEM de escrita se viável; senão, cobrir por revisão + smoke. Implementar o update condicional e as guardas. Conferir todos os erros. Nota de prontuário com os tipos já liberados na Task 1.
- [ ] **Step final: Commit.**

---

### Task 5: Gate da comissão (dashboard + fechamento ignoram bloqueada)

**Files:**
- Modify: `app/api/terapeutas/dashboard/route.ts` (comissao_gerada e a per-terapeuta)
- Modify: `app/api/terapeutas/fechamentos/route.ts` (`buscarPendentes`)
- Test: criar `lib/comissao-pagavel.ts` + `.test.ts` com `ehComissaoPagavel({ status, comissaoPaga, comissaoBloqueada })` → pura, usada nos dois lugares.

**Interfaces:**
- Produces: `ehComissaoPagavel(s)` = `status==='entregue' && !comissaoPaga && !comissaoBloqueada`. O dashboard soma `comissao_valor` só de quem é pagável; `buscarPendentes` filtra por isso (adicionar `comissao_bloqueada` ao `select` COLUNAS e ao filtro).

- [ ] **Step 1: Teste** de `ehComissaoPagavel`: entregue+não paga+não bloqueada→true; bloqueada→false; paga→false; não entregue→false.
- [ ] **Step 2: Rodar e ver falhar.** FAIL.
- [ ] **Step 3: Implementar** o helper e plugá-lo em `comissao_gerada` (dashboard/route.ts:~407,483) e em `buscarPendentes` (fechamentos/route.ts:71,83) — adicionar `comissao_bloqueada` ao `select`.
- [ ] **Step 4: Rodar e ver passar + suíte toda.** PASS.
- [ ] **Step 5: Commit.**

---

### Task 6: `anular` trata a falta (destrava + cancela)

**Files:**
- Modify: `app/api/terapeutas/sessoes/route.ts` (branch `anular`)

**Interfaces:**
- Produces: ao anular uma sessão com `status_consulta==='nao_compareceu'`, além do que já faz: `comissao_bloqueada=false` no update, e `update solicitacoes_falta_comissao set status='cancelado' where sessao_id=? and status='pendente'`. (Se a falta já estava 'aprovado'/'negado', não reabre — mas destrava a sessão, que volta a agendada e não conta até ser reconcluída.)

- [ ] **Steps:** incluir `comissao_bloqueada:false` no updateData do anular; cancelar a falta pendente; conferir erros; smoke + suíte verde; commit.

---

### Task 7: Guardas no `concluir`/`iniciar` individual

**Files:**
- Modify: `app/api/terapeutas/sessoes/route.ts`

**Interfaces:**
- Produces: `concluir` individual recusa (409) se `!sessaoConcluivel(status)` (igual ao lote); `iniciar` recusa se `status==='entregue'`.

- [ ] **Steps:** adicionar as guardas; suíte verde; commit.

---

### Task 8: UI — marcar "Não compareceu" e não induzir erro

**Files:**
- Modify: `app/terapeutas/[id]/page.tsx` (quadrante "entregues hoje", prontuário de sessões), `app/terapeutas/vendas/page.tsx` (lista de sessões)
- (A seção "Faltas aguardando aprovação" em `app/terapeutas/aprovacoes/page.tsx` e o badge em `components/Header.tsx` já existem da v1 — manter.)

**Interfaces:**
- Produces: quando `status_consulta==='nao_compareceu'`, mostrar chip laranja "Não compareceu" em vez do verde "Entregue"; o botão "Anular" vira "Desfazer falta" (ação já segura pela Task 6), e esconder "Concluir"/"Iniciar" nessas linhas.

- [ ] **Steps:** aplicar o chip e os botões nas 3 telas; verificar no localhost (skill `run`) que compila e renderiza; não mutar produção; commit.

---

## Pós-tasks (não codar aqui, registrar)

- Atualizar `spr-digital.md` item 125 com o desenho v2 final e a decisão de contagem.
- FK `solicitacoes_falta_comissao.sessao_id → sessoes(id)` sem cascade: `agendar/route.ts` (reagendamento total) deleta sessões; conferir se precisa desvincular a falta antes (achado I6 do revisor). Avaliar na revisão final; se for risco real, virar Task.
- Revisão final (requesting-code-review) do branch inteiro antes de mostrar ao dono.
