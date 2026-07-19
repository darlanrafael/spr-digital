# Link do Meet Automático Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every real session with a scheduled date automatically gets a real Google Meet link — on normal scheduling, manual patient launch, and rescheduling (cancel old event + create new one).

**Architecture:** A new `lib/google-meet.ts` wraps the `googleapis` Calendar API behind two small functions (`criarEventoComMeet`, `cancelarEvento`) authenticated via a Workspace service account (domain-wide delegation). All three call sites (`agendar`, `lancamento-manual`, `remarcar`) call these functions and store the result on the `sessoes` row. Every call site treats failure as non-fatal — the main operation always succeeds even if Google is unreachable or credentials are missing.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase, `googleapis` (new npm dependency). No test framework — verify via `npx tsc --noEmit`, `npm run lint`, direct Supabase REST checks, and manual `curl` against a running server. Google API calls specifically are verified by checking the resulting `sessoes.link_meet`/`google_event_id` values and, when credentials are available, confirming the event actually exists via the Calendar API's `events.get`.

## Global Constraints

- Zero email invites sent by Google Calendar — `attendees` is never set on the created event.
- The organizing account is a shared Workspace service identity (via domain-wide delegation), never the therapist's or patient's own account, and never appears inside the actual video call unless it separately joins.
- Failure to create/cancel a Google Calendar event NEVER fails the parent operation (scheduling, manual launch, rescheduling) — log and continue with `link_meet`/`google_event_id` left `null`.
- Until `GOOGLE_MEET_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_MEET_PRIVATE_KEY`, and `GOOGLE_MEET_DELEGATED_USER` all exist in the environment, `criarEventoComMeet`/`cancelarEvento` must no-op (return `null` / do nothing) rather than throw.
- Rescheduling cancels the old Google Calendar event and creates a brand new one — it does NOT patch the existing event's time (this was corrected from an earlier draft of the design).
- Full spec: `docs/superpowers/specs/2026-07-20-link-meet-automatico-design.md`.

---

### Task 1: `google_event_id` column + `googleapis` dependency

**Files:**
- Create: `supabase/migrations/20260720000000_google_event_id_sessoes.sql`
- Modify: `package.json` (add `googleapis` dependency)

**Interfaces:**
- Produces: column `sessoes.google_event_id text` (nullable).

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260720000000_google_event_id_sessoes.sql

-- Id do evento no Google Calendar por sessão — necessário pra cancelar o
-- evento certo quando a sessão é remarcada (cancela + cria de novo, não
-- só atualiza o horário do existente).
alter table sessoes
  add column if not exists google_event_id text;
```

- [ ] **Step 2: Apply the migration**

Run: `supabase db push`

**Known issue in this repo:** recurring migration-tracking desync this same week. If `supabase db push` fails with "Remote migration versions not found in local migrations directory", run `supabase migration list` to see which versions are mismatched, then `supabase migration repair --status reverted <those versions> --yes` followed by `supabase db push --include-all`.

- [ ] **Step 3: Verify**

```bash
set -a && source .env.local && set +a
curl -s "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/sessoes?select=id,google_event_id&limit=1" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
```

Expected: one row, `google_event_id` present as a key with value `null`.

- [ ] **Step 4: Install `googleapis`**

Run: `npm install googleapis`
Expected: `package.json`/`package-lock.json` updated, no install errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260720000000_google_event_id_sessoes.sql package.json package-lock.json
git commit -m "feat: coluna google_event_id em sessoes + dependencia googleapis"
```

---

### Task 2: `lib/google-meet.ts` — criar e cancelar evento

**Files:**
- Create: `lib/google-meet.ts`

**Interfaces:**
- Produces (used by Task 3):
  ```ts
  export async function criarEventoComMeet(params: {
    titulo: string
    inicioISO: string
    fimISO: string
  }): Promise<{ eventId: string; meetLink: string } | null>

  export async function cancelarEvento(eventId: string): Promise<void>
  ```
  Both resolve gracefully (no throw) on any failure — missing env vars, network error, API error. Failures are logged via `console.error`, never thrown.

- [ ] **Step 1: Write the module**

```ts
// lib/google-meet.ts
import { google } from 'googleapis'

const CALENDARIO_NOME = 'Atendimentos SPR Digital'

// Sem as 3 variáveis configuradas, a integração fica "desligada" — quem
// chama essas funções sempre recebe null/no-op, sem erro, e o agendamento
// continua funcionando normalmente sem link (mesmo comportamento de hoje).
function credenciaisDisponiveis(): boolean {
  return !!(
    process.env.GOOGLE_MEET_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_MEET_PRIVATE_KEY &&
    process.env.GOOGLE_MEET_DELEGATED_USER
  )
}

function getAuthClient() {
  const privateKey = (process.env.GOOGLE_MEET_PRIVATE_KEY as string).replace(/\\n/g, '\n')
  return new google.auth.JWT({
    email: process.env.GOOGLE_MEET_SERVICE_ACCOUNT_EMAIL,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/calendar'],
    subject: process.env.GOOGLE_MEET_DELEGATED_USER,
  })
}

let calendarIdCache: string | null = null

// Procura (ou cria, na primeira vez) o calendário secundário dedicado —
// evita lotar a agenda pessoal de quem "possui" a conta de serviço com
// toda sessão de todo terapeuta.
async function getCalendarId(calendar: ReturnType<typeof google.calendar>): Promise<string> {
  if (calendarIdCache) return calendarIdCache
  const { data } = await calendar.calendarList.list()
  const existente = data.items?.find(c => c.summary === CALENDARIO_NOME)
  if (existente?.id) {
    calendarIdCache = existente.id
    return existente.id
  }
  const { data: novo } = await calendar.calendars.insert({
    requestBody: { summary: CALENDARIO_NOME },
  })
  calendarIdCache = novo.id as string
  return calendarIdCache
}

export async function criarEventoComMeet(params: {
  titulo: string
  inicioISO: string
  fimISO: string
}): Promise<{ eventId: string; meetLink: string } | null> {
  if (!credenciaisDisponiveis()) return null
  try {
    const auth = getAuthClient()
    const calendar = google.calendar({ version: 'v3', auth })
    const calendarId = await getCalendarId(calendar)

    const { data } = await calendar.events.insert({
      calendarId,
      conferenceDataVersion: 1,
      requestBody: {
        summary: params.titulo,
        start: { dateTime: params.inicioISO },
        end: { dateTime: params.fimISO },
        conferenceData: {
          createRequest: {
            requestId: `spr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
      },
    })

    const meetLink = data.hangoutLink
    if (!data.id || !meetLink) return null
    return { eventId: data.id, meetLink }
  } catch (err) {
    console.error('[google-meet] falha ao criar evento:', err)
    return null
  }
}

export async function cancelarEvento(eventId: string): Promise<void> {
  if (!credenciaisDisponiveis()) return
  try {
    const auth = getAuthClient()
    const calendar = google.calendar({ version: 'v3', auth })
    const calendarId = await getCalendarId(calendar)
    await calendar.events.delete({ calendarId, eventId })
  } catch (err) {
    console.error('[google-meet] falha ao cancelar evento:', err)
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify graceful no-op without credentials**

```bash
node -e "
process.env.NODE_ENV = 'development'
" 2>&1
npx tsx -e "
import('./lib/google-meet.ts').then(async (m) => {
  delete process.env.GOOGLE_MEET_SERVICE_ACCOUNT_EMAIL
  delete process.env.GOOGLE_MEET_PRIVATE_KEY
  delete process.env.GOOGLE_MEET_DELEGATED_USER
  const r = await m.criarEventoComMeet({ titulo: 'teste', inicioISO: new Date().toISOString(), fimISO: new Date().toISOString() })
  console.log('resultado sem credenciais:', r)
  await m.cancelarEvento('id-qualquer')
  console.log('cancelarEvento sem credenciais: não lançou erro')
})
"
```

Expected: `resultado sem credenciais: null` and `cancelarEvento sem credenciais: não lançou erro`, no exception thrown.

- [ ] **Step 4: If `.env.local` already has the 3 Google Meet variables set, verify a real event end-to-end**

```bash
set -a && source .env.local && set +a
npx tsx -e "
import('./lib/google-meet.ts').then(async (m) => {
  const inicio = new Date(Date.now() + 24*60*60*1000)
  const fim = new Date(inicio.getTime() + 30*60*1000)
  const r = await m.criarEventoComMeet({ titulo: 'Teste plano — apagar', inicioISO: inicio.toISOString(), fimISO: fim.toISOString() })
  console.log('criado:', JSON.stringify(r))
  if (r) { await m.cancelarEvento(r.eventId); console.log('cancelado com sucesso') }
})
"
```

Expected (if credentials are present and valid): `criado: {"eventId":"...","meetLink":"https://meet.google.com/..."}` followed by `cancelado com sucesso`. If `GOOGLE_MEET_DELEGATED_USER` isn't set yet, this step is expected to print `resultado: null` (same as Step 3) — that's fine, not a failure, just means Task 2 ships in degraded mode until the credential arrives; re-run this step once it's added to confirm the real path.

- [ ] **Step 5: Commit**

```bash
git add lib/google-meet.ts
git commit -m "feat: lib/google-meet.ts — criar e cancelar evento com Meet via conta de servico"
```

---

### Task 3: Wire into agendar, lançamento manual, e remarcar

**Files:**
- Modify: `app/api/terapeutas/sessoes/agendar/route.ts`
- Modify: `app/api/terapeutas/vendas/lancamento-manual/route.ts`
- Modify: `app/api/terapeutas/sessoes/remarcar/route.ts`

**Interfaces:**
- Consumes: `criarEventoComMeet`, `cancelarEvento` from `@/lib/google-meet` (Task 2).

- [ ] **Step 1: Wire into `sessoes/agendar/route.ts`**

Read the file first (it was modified this same week — a `try/catch` now wraps most of the handler body). After the `sessoes` array is built and inserted (`await client.from('sessoes').insert(sessoes)`), and BEFORE the `registrarAtividade` call, add:

```ts
  // Link do Meet — não trava o agendamento se a API do Google falhar (ver
  // lib/google-meet.ts: sem credenciais configuradas, isso é um no-op).
  for (const s of sessoes) {
    const evento = await criarEventoComMeet({
      titulo: `Sessão — ${s.paciente_nome}`,
      inicioISO: s.data_agendada,
      fimISO: new Date(new Date(s.data_agendada).getTime() + 60 * 60 * 1000).toISOString(),
    })
    if (evento) {
      await client.from('sessoes')
        .update({ link_meet: evento.meetLink, google_event_id: evento.eventId })
        .eq('sale_id', sale_id).eq('numero_sessao', s.numero_sessao)
    }
  }
```

Add the import at the top of the file:

```ts
import { criarEventoComMeet } from '@/lib/google-meet'
```

- [ ] **Step 2: Wire into `vendas/lancamento-manual/route.ts`**

Read the file first to confirm current structure (it builds a `sessoes` array very similarly, then does `client.from('sessoes').insert(sessoes)`). After that insert succeeds, before the `registrarAtividade` call, add the same loop pattern as Step 1, adapted to this file's variable names (the session objects here use `paciente_nome`, `numero_sessao`, `data_agendada` fields — same shape as Task's Step 1, confirm exact field names against the real file before writing the loop). Add the same import.

- [ ] **Step 3: Wire into `sessoes/remarcar/route.ts`**

Read the file first. Find where it updates `data_agendada` on the existing session row. Before updating, fetch the session's current `google_event_id` and `paciente_nome` (if not already in scope). After the reschedule's `data_agendada` update succeeds:

```ts
  // Remarcação cancela o evento antigo e cria um novo — não só atualiza o
  // horário do existente (link continuar "válido" com o horário errado
  // seria pior que não ter link).
  if (sessaoAtual.google_event_id) {
    await cancelarEvento(sessaoAtual.google_event_id)
  }
  const evento = await criarEventoComMeet({
    titulo: `Sessão — ${sessaoAtual.paciente_nome}`,
    inicioISO: novaDataISO,
    fimISO: new Date(new Date(novaDataISO).getTime() + 60 * 60 * 1000).toISOString(),
  })
  await client.from('sessoes')
    .update({
      link_meet: evento?.meetLink ?? null,
      google_event_id: evento?.eventId ?? null,
    })
    .eq('id', sessao_id)
```

(`sessaoAtual`, `novaDataISO`, `sessao_id` — adapt to whatever the real variable names are in this file; read it first.) Add the same import (`criarEventoComMeet`, plus `cancelarEvento`).

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors vs. the established baseline.

- [ ] **Step 5: Manual verification (works in degraded mode even without final credentials)**

```bash
npm run dev &
sleep 3
```

Exercise the three flows (agendar via a throwaway pending sale, lançamento manual, remarcar) the same way earlier plans this week did — create throwaway `usuarios_sistema` test user if needed, create/clean up throwaway `sales`/`sessoes` rows. Confirm:
- Without `GOOGLE_MEET_DELEGATED_USER` set: all three flows succeed exactly as before this task, `link_meet`/`google_event_id` stay `null`, no errors surfaced to the caller.
- If all 3 env vars are present and valid by the time this step runs: `link_meet` gets a real `https://meet.google.com/...` URL and `google_event_id` is set; rescheduling produces a NEW `google_event_id` (different from the original) and the old event is gone (`calendar.events.get` on the old id returns 404/gone, if you want to double-check via a quick script).

Clean up all test data created.

- [ ] **Step 6: Commit**

```bash
git add app/api/terapeutas/sessoes/agendar/route.ts app/api/terapeutas/vendas/lancamento-manual/route.ts app/api/terapeutas/sessoes/remarcar/route.ts
git commit -m "feat: gerar link do Meet automaticamente ao agendar, lancar manualmente e remarcar sessao"
```

---

### Task 4: Deploy and verify in production

**Files:** none (verification + Vercel env var configuration).

- [ ] **Step 1: Final typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`

- [ ] **Step 2: Add the 3 environment variables to Vercel (production)**

This step needs the human — either via `vercel env add <NAME> production` for each of the 3 variables (if the Vercel CLI is authenticated in this environment) or by pasting them into the Vercel dashboard (Project → Settings → Environment Variables). Confirm all 3 are present before proceeding: `GOOGLE_MEET_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_MEET_PRIVATE_KEY`, `GOOGLE_MEET_DELEGATED_USER`.

- [ ] **Step 3: Push and wait for the Vercel deployment to match the latest commit**

```bash
git push origin main
LOCAL_SHA=$(git rev-parse HEAD)
for i in $(seq 1 20); do
  DEP=$(gh api repos/darlanrafael/spr-digital/deployments --jq '.[0].sha' 2>/dev/null)
  if [ "$DEP" = "$LOCAL_SHA" ]; then echo "MATCH: $DEP"; break; fi
  sleep 15
done
```

- [ ] **Step 4: Smoke-test against production**

Repeat the three-flow verification from Task 3 Step 5 against `https://spr-digital.vercel.app` instead of localhost. If the 3 env vars are configured in Vercel by this point, confirm real Meet links appear; if not yet configured, confirm the three flows still work in degraded mode (no link, no errors) exactly as they did before this feature.

- [ ] **Step 5: Report completion**

Summarize to the user: the three session-creation paths now generate real Google Meet links automatically once the 3 environment variables are set in Vercel; until then, everything works exactly as before (no link, no breakage). Confirm which state it's currently in (degraded or fully active) based on Step 2's outcome.

---

## Self-Review Notes

- **Spec coverage:** real Meet link via Calendar API + service account + domain delegation → Task 2 ✓; single shared organizing account, no email invites (`attendees` never set) → Task 2 `criarEventoComMeet` body ✓; dedicated secondary calendar → Task 2 `getCalendarId` ✓; graceful degradation or missing/failing credentials → Task 2's `credenciaisDisponiveis()` guard + try/catch ✓; applies to agendar + lançamento manual + remarcar → Task 3 ✓; remarcar cancels + recreates (not patches) → Task 3 Step 3 ✓; `google_event_id` column → Task 1 ✓.
- **Placeholder scan:** none — every step has literal code or exact commands. Task 3's per-file wiring steps ask the implementer to confirm real variable names against the actual file before writing the loop, since two of those three files were modified elsewhere this week and their exact current shape must be read fresh — this is a instruction to verify against reality, not a placeholder for missing content (the code pattern itself is fully specified).
- **Type consistency:** `criarEventoComMeet`/`cancelarEvento` signatures defined once in Task 2, used identically across all three call sites in Task 3.
