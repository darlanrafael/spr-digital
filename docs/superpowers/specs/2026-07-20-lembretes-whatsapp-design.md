# Lembretes automáticos via WhatsApp — Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enviar automaticamente, via WhatsApp, um resumo diário dos atendimentos do dia seguinte (pro grupo do time de cada terapeuta) e lembretes individuais — véspera e 30 minutos antes — pro grupo e pro paciente. Alertar imediatamente o admin quando algo falhar (link do Meet não gerado, envio de WhatsApp com erro).

**Arquitetura:** O Next.js (SPR Digital) expõe endpoints somente-leitura que respondem "quem precisa receber mensagem agora", com dados brutos (nome, telefone, sessão, horário, link) — sem texto pronto. Um endpoint de escrita marca cada item como enviado. Toda a orquestração (agendamento, formatação da mensagem, envio, retry, alerta de erro) vive em workflows do n8n (self-hosted na Digital Ocean do usuário), que chamam a Z-API pra efetivamente mandar as mensagens no WhatsApp. Essa separação mantém o código da aplicação estável — trocar o texto das mensagens, o provedor de WhatsApp (Z-API → D-API no futuro) ou os horários dos disparos não exige deploy, só editar o workflow no n8n.

**Tech Stack:** Next.js API routes (Supabase), n8n (existente, self-hosted), Z-API (WhatsApp Web automation).

## Global Constraints

- Não modificar, apagar ou reconfigurar nenhum workflow, credencial ou nó já existente na instância de n8n do usuário — acesso à API do n8n é estritamente para criar os workflows novos desta automação.
- Todos os horários de negócio (véspera, janela de 30 min) usam o fuso de Brasília (UTC-3), seguindo o mesmo padrão já usado em `app/api/terapeutas/dashboard/route.ts` (`brasiliaStartUTC`/`brasiliaEndUTC`).
- Os endpoints novos são chamados só pelo n8n (sem sessão de usuário) — autenticação via header com chave secreta comparada a uma env var.
- Nenhuma mensagem duplicada: cada tipo de lembrete por sessão só pode ser marcado/enviado uma vez (rastreado por coluna de timestamp).
- O texto das mensagens não vive no código — só a formatação estrutural dos dados (nome, telefone, sessão X/Y, data, link) sai da API; o texto final é montado no n8n.
- O mecanismo de alerta ao admin (`notificarAdmin`) é genérico — não fica restrito aos dois casos de uso iniciais (falha ao gerar link do Meet, falha de envio de WhatsApp) — outros pontos de falha podem ser conectados a ele depois sem redesenho.
- Providers de WhatsApp trocáveis: hoje Z-API, migração futura pra D-API deve exigir só reconfigurar o(s) nó(s) de HTTP Request no n8n, nunca mudar os endpoints do Next.js.

---

## Banco de dados

**`terapeutas`** — nova coluna:
- `grupo_whatsapp_id text null` — ID do grupo do WhatsApp (formato `xxxxxxxxxx-xxxxxxxxxx@g.us`) do time daquele terapeuta. `null` = automação desligada pra esse terapeuta (permite ligar por terapeuta, sem afetar quem ainda não tem grupo configurado).

**`sessoes`** — 4 novas colunas, todas `timestamptz null`:
- `lembrete_grupo_vespera_enviado_em`
- `lembrete_paciente_vespera_enviado_em`
- `lembrete_grupo_30min_enviado_em`
- `lembrete_paciente_30min_enviado_em`

Cada uma é preenchida (via `POST /api/whatsapp/marcar-enviado`) só depois que o n8n confirma que aquele envio específico deu certo. Enquanto `null`, o item continua aparecendo nos endpoints de "pendentes".

## Endpoints novos (Next.js)

Todos exigem header `x-whatsapp-cron-secret` igual à env var `WHATSAPP_CRON_SECRET` — 401 caso contrário.

### `GET /api/whatsapp/pendentes-vespera`

Sessões com `status = 'agendada'`, `data_agendada` dentro do dia de amanhã (Brasília), pertencentes a um terapeuta com `grupo_whatsapp_id` preenchido, e pelo menos um dos dois lembretes de véspera ainda não enviado.

Resposta agrupada por terapeuta:
```json
{
  "terapeutas": [
    {
      "terapeuta_id": "...",
      "grupo_whatsapp_id": "1203...@g.us",
      "sessoes": [
        {
          "sessao_id": "...",
          "paciente_nome": "Maria Silva",
          "paciente_telefone": "5511999999999",
          "numero_sessao": 3,
          "total_sessoes": 8,
          "data_agendada": "2026-07-21T17:00:00+00:00",
          "link_meet": "https://meet.google.com/abc-defg-hij",
          "grupo_ja_enviado": false,
          "paciente_ja_enviado": false
        }
      ]
    }
  ]
}
```

### `GET /api/whatsapp/pendentes-30min`

Mesma forma de resposta, mas filtra `data_agendada` entre "agora" e "agora + 30 minutos", com pelo menos um dos dois lembretes de 30-min ainda não enviado. Fica seguro rodar a cada poucos minutos — um item só some da lista depois de marcado enviado ou depois que o horário da sessão já passou.

### `POST /api/whatsapp/marcar-enviado`

Body: `{ "sessao_id": "...", "tipo": "grupo_vespera" | "paciente_vespera" | "grupo_30min" | "paciente_30min" }`

Seta a coluna correspondente pra `now()`. Idempotente — chamar de novo pro mesmo item só atualiza o timestamp, não é erro.

### `POST /api/whatsapp/alerta` (chamado pelo próprio Next.js, não pelo n8n)

Não é um endpoint HTTP exposto — é a implementação de `notificarAdmin(mensagem: string)` em `lib/notificar-admin.ts`, que faz um `fetch` pro webhook do n8n (URL guardada em `N8N_ALERTA_WEBHOOK_URL`). Nunca lança erro (mesmo padrão de `lib/google-meet.ts`: se o webhook falhar, loga no console e segue — um alerta que falha não pode derrubar o fluxo principal).

## Onde `notificarAdmin` é chamado

- **`lib/google-meet.ts`** — dentro do `catch` de `criarEventoComMeet`, quando a chamada à API do Google falha de verdade (não no caminho de "credenciais não configuradas", que é comportamento esperado em dev). Mensagem inclui o nome do paciente/sessão que ficou sem link.
- Ponto de extensão pra outros casos de falha no futuro (não implementado agora): qualquer chamada externa que hoje só faz `console.error` é candidata.

## Workflows no n8n (construídos via API, sem tocar em nada existente)

**Workflow 1 — Lembrete véspera** (trigger: Schedule, todo dia 21:30 Brasília)
1. HTTP Request → `GET /api/whatsapp/pendentes-vespera`
2. Para cada terapeuta: monta 1 mensagem de resumo (todas as sessões) → HTTP Request → Z-API (mensagem pro grupo) → em caso de sucesso, `POST /api/whatsapp/marcar-enviado` (`tipo: grupo_vespera`) pra cada sessão incluída → em caso de erro, dispara alerta pro admin com o erro da Z-API.
3. Para cada sessão com telefone de paciente: monta mensagem individual → Z-API (mensagem pro paciente) → marca `paciente_vespera` enviado, ou alerta em caso de erro.

**Workflow 2 — Lembrete 30 minutos antes** (trigger: Schedule, a cada 5 minutos)
1. HTTP Request → `GET /api/whatsapp/pendentes-30min`
2. Mesma lógica do Workflow 1, mas pros tipos `grupo_30min` / `paciente_30min`.

**Webhook de alerta** (trigger: Webhook, chamado pelo Next.js via `notificarAdmin`)
1. Recebe a mensagem de erro.
2. Envia via Z-API pros 2 números do admin (configurados como credencial/variável dentro do próprio workflow — o Next.js nunca sabe quem são).

## Casos de borda

- **Paciente sem telefone:** pula a mensagem individual (não marca `paciente_*` como enviado nem como erro — simplesmente não existe target); continua aparecendo no resumo do grupo normalmente.
- **Sessão sem `link_meet`:** a linha do link não aparece na mensagem (nem no resumo, nem nas individuais).
- **Sessão remarcada/cancelada depois do lembrete de véspera já enviado, antes do de 30 min:** como os dois tipos são rastreados em colunas separadas, o lembrete de 30 min é reavaliado independente — se a sessão não estiver mais `agendada`, some da lista de pendentes-30min normalmente (o filtro de status já exclui).
- **n8n roda em cima da hora e o disparo de véspera atrasa:** sem problema — o endpoint filtra por data (dia de amanhã), não por horário exato; funciona mesmo se rodar horas depois do previsto.

## Fora de escopo (não desta vez)

- Suporte a mais de 2 números de alerta ao admin (fica hardcoded no workflow do n8n, fácil de editar lá se precisar).
- Migração pra D-API (arquitetura já preparada, mas a troca em si fica pra depois).
- Qualquer alerta além dos dois casos citados (fica só o mecanismo genérico pronto).
