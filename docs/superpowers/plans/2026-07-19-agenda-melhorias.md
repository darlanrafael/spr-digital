# Agenda — Horários Fixos, Preview no Mês, Recorrência e Edição Individual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship four related Agenda improvements: per-therapist fixed time slots (Pedro), a free-time preview on each month-grid day card, weekly-recurring personal commitments, and per-session editable dates in the "Agendar sessões" flow.

**Architecture:** Extends the existing Agenda do Dia component (`components/terapeutas/AgendaDiaTerapeuta.tsx`) with an optional "fixed slots" rendering mode gated by a new per-therapist DB column, exports its free-time math so the month grid in `app/terapeutas/[id]/page.tsx` can reuse it for a day-card preview, extends the compromissos API to optionally insert N weekly-repeating rows in one call, and extends the sessions-scheduling API to optionally accept explicit per-session dates instead of always deriving them from the 7-day rule.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4, Supabase (Postgres + PostgREST). No test framework in this repo — verify via `npx tsc --noEmit`, `npm run lint`, manual `curl`/direct Supabase REST checks, and browser walkthroughs against a running `npm run dev` server plus the deployed Vercel instance.

## Global Constraints

- `terapeutas.horarios_fixos` empty (default `'{}'`) must produce **zero behavior change** for any therapist that doesn't have it set (Denise today, any future therapist) — continuous free-time rendering stays exactly as-is.
- The 7-day interval remains the **default** rule for scheduling multiple sessions — explicit per-session date overrides are an opt-in escape hatch, not a replacement of the rule.
- Recurring commitments do not get per-occurrence conflict checking — only a post-creation count is shown. Don't add blocking validation across future weeks.
- No admin UI for editing `horarios_fixos` in this plan — set via direct Supabase REST PATCH, same precedent as `vendas_a_partir_de` and `duracao_sessao_minutos`.
- Full spec: `docs/superpowers/specs/2026-07-19-agenda-melhorias-design.md`.

---

### Task 1: Database — `terapeutas.horarios_fixos`

**Files:**
- Create: `supabase/migrations/20260719000000_horarios_fixos_terapeuta.sql`

**Interfaces:**
- Produces: column `terapeutas.horarios_fixos text[] not null default '{}'` — array of `"HH:MM"` strings.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260719000000_horarios_fixos_terapeuta.sql

-- Lista de horários fixos de atendimento por terapeuta (ex: Pedro atende só
-- em horários específicos do dia, não numa faixa livre contínua). Vazio
-- (padrão) = comportamento atual, sem mudança nenhuma — a Agenda do Dia só
-- entra no modo "horário fixo" quando essa lista tem pelo menos 1 item.
alter table terapeutas
  add column if not exists horarios_fixos text[] not null default '{}';
```

- [ ] **Step 2: Apply the migration**

Run: `supabase db push`

**Known issue in this repo:** `supabase db push` has repeatedly failed this same week with "Remote migration versions not found in local migrations directory" due to a migration-tracking desync unrelated to the migration content itself. If it happens, run `supabase migration list` to see which versions are mismatched (it's been `20260710` and `20260716` every time so far), then:

```bash
supabase migration repair --status reverted 20260710 20260716 --yes
supabase db push --include-all
```

Expected final output: `Applying migration 20260719000000_horarios_fixos_terapeuta.sql...` then `Finished supabase db push.`

- [ ] **Step 3: Set Pedro Roncada's 14 fixed slots**

```bash
set -a && source .env.local && set +a
curl -s -X PATCH "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/terapeutas?nome=eq.Pedro%20Roncada" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{"horarios_fixos":["09:40","10:30","11:20","12:10","12:40","13:30","14:10","16:00","17:30","18:15","19:00","19:30","20:20","21:10"]}'
```

Expected: JSON array with one object, `"horarios_fixos":["09:40","10:30",...]` (14 items).

- [ ] **Step 4: Verify no other therapist was affected**

```bash
curl -s "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/terapeutas?select=nome,horarios_fixos&order=nome" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
```

Expected: Pedro Roncada has the 14-item array; every other therapist has `[]`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260719000000_horarios_fixos_terapeuta.sql
git commit -m "feat: coluna horarios_fixos por terapeuta"
```

---

### Task 2: `AgendaDiaTerapeuta` — modo de horário fixo + funções exportadas pro preview do mês

**Files:**
- Modify: `components/terapeutas/AgendaDiaTerapeuta.tsx`

**Interfaces:**
- Consumes: nothing new externally.
- Produces (used by Task 3):
  - `export const JANELA_INICIO_MIN = 480`, `export const JANELA_FIM_MIN = 1260` (already exist as local consts — becomes exported, values unchanged).
  - `export function calcularIntervalosLivres(ocupados: Ocupado[], janelaInicio: number, janelaFim: number): Ocupado[]` (already exists — becomes exported, unchanged).
  - `export type Ocupado = { inicio: number; fim: number }` (already exists — becomes exported, unchanged).
  - `export function fmtDuracao(min: number): string` (already exists — becomes exported, unchanged).
  - `export function contarSlotsLivres(horariosFixos: string[], ocupados: Ocupado[], duracaoMinutos: number): number` — NEW. Parses each `"HH:MM"` into minutes, counts how many don't overlap any entry in `ocupados`.
  - New prop on `AgendaDiaTerapeutaProps`: `horariosFixos?: string[]` (defaults to `[]` when omitted).

This task changes ONLY `AgendaDiaTerapeuta.tsx`. Denise's day view (no `horariosFixos` prop passed yet — that's Task 3) is unaffected until Task 3 wires the prop through.

- [ ] **Step 1: Export the existing internal types/functions the month view will need**

In `components/terapeutas/AgendaDiaTerapeuta.tsx`, change these four declarations from unexported to exported (add the `export` keyword; do not change their bodies):

```ts
export type Ocupado = { inicio: number; fim: number }
```

```ts
export function fmtDuracao(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m}min`
  if (m === 0) return `${h}h`
  return `${h}h${m}min`
}
```

```ts
export function calcularIntervalosLivres(ocupados: Ocupado[], janelaInicio: number, janelaFim: number): Ocupado[] {
  const ordenados = [...ocupados].sort((a, b) => a.inicio - b.inicio)
  const livres: Ocupado[] = []
  let cursor = janelaInicio
  for (const o of ordenados) {
    const inicio = clamp(janelaInicio, o.inicio, janelaFim)
    const fim = clamp(janelaInicio, o.fim, janelaFim)
    if (inicio > cursor) livres.push({ inicio: cursor, fim: inicio })
    cursor = Math.max(cursor, fim)
  }
  if (cursor < janelaFim) livres.push({ inicio: cursor, fim: janelaFim })
  return livres
}
```

And the two window constants near the top of the file:

```ts
export const JANELA_INICIO_MIN = 8 * 60   // 08:00
export const JANELA_FIM_MIN = 21 * 60     // 21:00
```

- [ ] **Step 2: Add `horarioParaMinutos` and `contarSlotsLivres`**

Add right after `calcularIntervalosLivres` (which is now exported per Step 1):

```ts
function horarioParaMinutos(horario: string): number {
  const [h, m] = horario.split(':').map(Number)
  return h * 60 + m
}

// Conta quantos horários fixos (ex: os 14 do Pedro) NÃO batem com nada em
// `ocupados` (sessão ou compromisso já ocupando aquele intervalo) — usado
// pelo preview do card de mês pra terapeuta de horário fixo.
export function contarSlotsLivres(horariosFixos: string[], ocupados: Ocupado[], duracaoMinutos: number): number {
  return horariosFixos.filter(h => {
    const inicio = horarioParaMinutos(h)
    const fim = inicio + duracaoMinutos
    return !ocupados.some(o => inicio < o.fim && fim > o.inicio)
  }).length
}
```

- [ ] **Step 3: Add the `horariosFixos` prop and branch the rendering**

Change the props interface:

```ts
interface AgendaDiaTerapeutaProps {
  data: Date
  sessoes: SessaoDia[]
  compromissos: CompromissoDia[]
  duracaoSessaoMinutos: number
  horariosFixos?: string[]
  onClickSessao: (sessao: SessaoDia) => void
  onClickCompromisso: (compromisso: CompromissoDia) => void
  onClickLivre: (inicio: Date, fim: Date) => void
  onNavegarDia: (direcao: -1 | 1) => void
  onVoltarMes: () => void
}
```

Change the function signature to destructure it with a default:

```ts
export default function AgendaDiaTerapeuta({
  data, sessoes, compromissos, duracaoSessaoMinutos, horariosFixos = [],
  onClickSessao, onClickCompromisso, onClickLivre, onNavegarDia, onVoltarMes,
}: AgendaDiaTerapeutaProps) {
```

Replace the current `livres` computation:

```ts
  const livres = calcularIntervalosLivres(ocupados, JANELA_INICIO_MIN, JANELA_FIM_MIN)
    .flatMap(fatiarLivrePorHora)
```

with a branch that produces fixed-size slot blocks instead of continuous free bands when `horariosFixos` is non-empty:

```ts
  // Terapeuta de horário fixo (ex: Pedro): só os horários da lista contam
  // como "livre" — cada um vira um bloco do tamanho exato da duração da
  // sessão, não uma faixa contínua. Terapeuta sem lista (padrão) mantém o
  // comportamento de sempre: qualquer vão vira livre, picado em pedaços de
  // até 1h pro hover não destacar tudo de uma vez.
  const livres = horariosFixos.length > 0
    ? horariosFixos
        .map(h => ({ inicio: horarioParaMinutos(h), fim: horarioParaMinutos(h) + duracaoSessaoMinutos }))
        .filter(slot => !ocupados.some(o => slot.inicio < o.fim && slot.fim > o.inicio))
    : calcularIntervalosLivres(ocupados, JANELA_INICIO_MIN, JANELA_FIM_MIN).flatMap(fatiarLivrePorHora)
```

No other change needed in the render — the existing `{livres.map((l, i) => ...)}` block already renders each `{inicio, fim}` as a clickable block sized to its own duration; a fixed slot (50-60min) and an hourly free chunk render through the identical JSX path.

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors. (Baseline before this task: 0 tsc errors, 51 lint problems — 39 errors, 12 warnings, all pre-existing and unrelated to this file.)

- [ ] **Step 5: Verify `contarSlotsLivres` by hand**

```bash
node -e "
function contarSlotsLivres(horariosFixos, ocupados, duracaoMinutos) {
  function horarioParaMinutos(h) { const [hh, mm] = h.split(':').map(Number); return hh * 60 + mm }
  return horariosFixos.filter(h => {
    const inicio = horarioParaMinutos(h);
    const fim = inicio + duracaoMinutos;
    return !ocupados.some(o => inicio < o.fim && fim > o.inicio);
  }).length;
}
// 3 horários fixos (09:40, 10:30, 11:20), sessão real ocupando 09:40-10:30 (50min)
console.log(contarSlotsLivres(['09:40','10:30','11:20'], [{inicio: 580, fim: 630}], 50));
"
```

Expected: `2` (09:40 está ocupado pela sessão das 580-630min = 09:40-10:30; 10:30 e 11:20 seguem livres — confirme mentalmente: 09:40 = 580min, a sessão ocupa 580-630, então o slot 09:40 (580-630) colide exatamente e é descontado; 10:30 = 630min, slot 630-680, não colide com 580-630 já que `630 < 630` é falso).

- [ ] **Step 6: Commit**

```bash
git add components/terapeutas/AgendaDiaTerapeuta.tsx
git commit -m "feat: modo de horario fixo na Agenda do Dia + funcoes exportadas pro preview do mes"
```

---

### Task 3: Wire `horarios_fixos` + preview de vagos no card do mês

**Files:**
- Modify: `app/terapeutas/[id]/page.tsx`

**Interfaces:**
- Consumes: `Ocupado`, `contarSlotsLivres`, `calcularIntervalosLivres`, `fmtDuracao`, `JANELA_INICIO_MIN`, `JANELA_FIM_MIN` from `@/components/terapeutas/AgendaDiaTerapeuta` (Task 2).

- [ ] **Step 1: Add `horarios_fixos` to the `Terapeuta` type and the select query**

Find the `Terapeuta` type (has `duracao_sessao_minutos: number` from earlier work) and add:

```ts
type Terapeuta = {
  id: string
  nome: string
  email: string
  percentual_comissao: number
  vendas_a_partir_de: string | null
  duracao_sessao_minutos: number
  horarios_fixos: string[]
}
```

In `loadData()`, find the terapeutas select (currently `'id,nome,email,percentual_comissao,vendas_a_partir_de,duracao_sessao_minutos'`) and add the new column:

```ts
client.from('terapeutas').select('id,nome,email,percentual_comissao,vendas_a_partir_de,duracao_sessao_minutos,horarios_fixos').eq('id', id).single(),
```

- [ ] **Step 2: Import the newly-exported helpers and pass `horariosFixos` to the day view**

Update the import line:

```ts
import AgendaDiaTerapeuta, {
  SessaoDia, CompromissoDia, Ocupado,
  contarSlotsLivres, calcularIntervalosLivres, fmtDuracao,
  JANELA_INICIO_MIN, JANELA_FIM_MIN,
} from '@/components/terapeutas/AgendaDiaTerapeuta'
```

In the `<AgendaDiaTerapeuta ... />` JSX (inside the `agendaDiaSelecionado ? (...)` branch), add the new prop right after `duracaoSessaoMinutos`:

```tsx
                  duracaoSessaoMinutos={terapeuta?.duracao_sessao_minutos ?? 60}
                  horariosFixos={terapeuta?.horarios_fixos ?? []}
```

- [ ] **Step 3: Add a per-day "ocupados" helper and the preview line in the month grid**

Add this function near `sessoesNoDiaAgenda` (reuses the same `sessoes`/`compromissos` state the page already loads):

```ts
  function ocupadosNoDia(dia: number): Ocupado[] {
    const inicioDia = new Date(agendaAno, agendaMes, dia)
    const sessoesDoDia = sessoes.filter(s => {
      if (!s.data_agendada || s.status === 'cancelada') return false
      return new Date(s.data_agendada).toDateString() === inicioDia.toDateString()
    })
    const compromissosDoDia = compromissos.filter(c =>
      new Date(c.inicio).toDateString() === inicioDia.toDateString())
    function minutosDoDia(iso: string): number {
      const d = new Date(iso)
      return d.getHours() * 60 + d.getMinutes()
    }
    return [
      ...sessoesDoDia.map(s => ({
        inicio: minutosDoDia(s.data_agendada as string),
        fim: minutosDoDia(s.data_agendada as string) + (terapeuta?.duracao_sessao_minutos ?? 60),
      })),
      ...compromissosDoDia.map(c => ({ inicio: minutosDoDia(c.inicio), fim: minutosDoDia(c.fim) })),
    ]
  }

  function previewVagosNoDia(dia: number): string {
    const ocupados = ocupadosNoDia(dia)
    if ((terapeuta?.horarios_fixos ?? []).length > 0) {
      const livres = contarSlotsLivres(terapeuta!.horarios_fixos, ocupados, terapeuta?.duracao_sessao_minutos ?? 60)
      return `${livres} vago${livres === 1 ? '' : 's'} de ${terapeuta!.horarios_fixos.length}`
    }
    const minutosLivres = calcularIntervalosLivres(ocupados, JANELA_INICIO_MIN, JANELA_FIM_MIN)
      .reduce((total, l) => total + (l.fim - l.inicio), 0)
    return minutosLivres > 0 ? `${fmtDuracao(minutosLivres)} livre` : 'sem vaga'
  }
```

In the month-grid cell JSX (inside `{agendaCells.map((dia, idx) => { ... })}`, right after the `{ss.length > 3 && (...)}` block, before the closing `</div>` of `space-y-0.5`), add:

```tsx
                                  {ss.length > 3 && (
                                    <span className="text-[10px] text-gray-500">+{ss.length - 3} mais</span>
                                  )}
                                  <p className="text-[10px] text-green-500/70 mt-0.5">{previewVagosNoDia(dia)}</p>
```

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors (same baseline as Task 2 Step 4).

- [ ] **Step 5: Manual verification**

```bash
npm run dev
```

Open Pedro's page → Agenda tab (month view). Confirm each day cell shows a small green line like "14 vagos de 14" (empty days) or fewer for days with real sessions/commitments (e.g. "12 vagos de 14" on 17/07, which has "Gravação Ads Iar" 09:00-12:00 blocking some of the 14 slots). Open Denise's page → Agenda tab, confirm her day cells show "Xh livre" instead (continuous-mode format), matching what her Agenda do Dia already showed as free before this task.

- [ ] **Step 6: Commit**

```bash
git add "app/terapeutas/[id]/page.tsx"
git commit -m "feat: preview de vagos no card do mes + horarios fixos do Pedro na Agenda do Dia"
```

---

### Task 4: Compromisso recorrente (lançamento em massa)

**Files:**
- Modify: `app/api/terapeutas/compromissos/route.ts`
- Modify: `app/terapeutas/[id]/page.tsx`

**Interfaces:**
- Produces: `POST /api/terapeutas/compromissos` body gains optional `repetir_semanas?: number`. Response becomes `{ success: true, ids: string[] }` (was `{ success: true, id: string }` — see Step 1 for why both shapes are kept for compatibility).

- [ ] **Step 1: Extend the POST handler to accept `repetir_semanas`**

In `app/api/terapeutas/compromissos/route.ts`, change the body type and destructuring:

```ts
    const body = await req.json() as {
      terapeuta_id: string
      titulo: string
      inicio: string
      fim: string
      categoria?: string
      repetir_semanas?: number
      usuario_nome: string
      usuario_tipo: string
      usuario_email: string
      senha: string
    }
    const { terapeuta_id, titulo, inicio, fim, categoria, repetir_semanas, usuario_nome, usuario_tipo, usuario_email, senha } = body
```

Replace the single-row insert block:

```ts
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('compromissos_terapeuta')
      .insert({
        terapeuta_id,
        titulo: titulo.trim(),
        inicio: inicioISO,
        fim: fimISO,
        categoria: categoria ?? 'compromisso',
        criado_por_nome: usuario_nome,
        criado_por_tipo: usuario_tipo,
        criado_por_email: usuario_email,
      })
      .select('id')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
```

with:

```ts
    const supabase = getSupabaseAdmin()
    const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000
    const inicioMs = new Date(inicioISO).getTime()
    const fimMs = new Date(fimISO).getTime()
    const repeticoes = repetir_semanas && repetir_semanas > 1 ? Math.min(Math.floor(repetir_semanas), 52) : 1
    const linhas = Array.from({ length: repeticoes }, (_, i) => ({
      terapeuta_id,
      titulo: titulo.trim(),
      inicio: new Date(inicioMs + i * SETE_DIAS_MS).toISOString(),
      fim: new Date(fimMs + i * SETE_DIAS_MS).toISOString(),
      categoria: categoria ?? 'compromisso',
      criado_por_nome: usuario_nome,
      criado_por_tipo: usuario_tipo,
      criado_por_email: usuario_email,
    }))

    const { data, error } = await supabase
      .from('compromissos_terapeuta')
      .insert(linhas)
      .select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
```

Update the `registrarAtividade` call (it currently references singular `titulo`/`inicioISO`/`fimISO` — keep it describing just the first occurrence, but note the count):

```ts
    await registrarAtividade({
      usuario_nome,
      usuario_tipo: usuario_tipo || ((usuario as Record<string, unknown>)?.tipo as string) || 'admin',
      tipo_acao: 'compromisso_criado',
      descricao: repeticoes > 1
        ? `Compromisso "${titulo.trim()}" lançado ${repeticoes}x, semanalmente a partir de ${new Date(inicioISO).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`
        : `Compromisso "${titulo.trim()}" lançado na agenda (${new Date(inicioISO).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} – ${new Date(fimISO).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })})`,
      dados_novos: { terapeuta_id, titulo: titulo.trim(), inicio: inicioISO, fim: fimISO, repeticoes },
    })

    return NextResponse.json({ success: true, ids: data.map(d => d.id) })
```

(Remove the old `return NextResponse.json({ success: true, id: data.id })` line — replaced by the one above.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification — single (non-repeating) still works, then repeating**

```bash
npm run dev &
sleep 3
set -a && source .env.local && set +a
```

Get Pedro's id and a real login (create a throwaway `usuarios_sistema` user the same way earlier tasks this week did, or use a known-working one):

```bash
curl -s "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/terapeutas?nome=eq.Pedro%20Roncada&select=id" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
```

Single (no `repetir_semanas`):

```bash
curl -s -X POST http://localhost:3000/api/terapeutas/compromissos \
  -H "Content-Type: application/json" \
  -d '{"terapeuta_id":"<id-pedro>","titulo":"Teste single","inicio":"2026-08-03T12:00","fim":"2026-08-03T13:00","usuario_nome":"Teste","usuario_tipo":"admin","usuario_email":"<email>","senha":"<senha>"}'
```

Expected: `{"success":true,"ids":["<uuid>"]}` (array with exactly 1 id).

Repeating (4 weeks):

```bash
curl -s -X POST http://localhost:3000/api/terapeutas/compromissos \
  -H "Content-Type: application/json" \
  -d '{"terapeuta_id":"<id-pedro>","titulo":"Teste recorrente","inicio":"2026-08-07T14:00","fim":"2026-08-07T15:00","repetir_semanas":4,"usuario_nome":"Teste","usuario_tipo":"admin","usuario_email":"<email>","senha":"<senha>"}'
```

Expected: `{"success":true,"ids":[...]}` with exactly 4 ids. Verify the 4 rows land on the correct weekly-spaced Fridays:

```bash
curl -s "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/compromissos_terapeuta?titulo=eq.Teste%20recorrente&select=inicio&order=inicio" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
```

Expected: 4 rows, `inicio` values 7 days apart (07/08, 14/08, 21/08, 28/08, each at 17:00 UTC = 14:00 BRT).

Clean up both test batches:

```bash
curl -s "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/compromissos_terapeuta?titulo=in.(Teste%20single,Teste%20recorrente)&select=id" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
# delete each id returned via: curl -s -X DELETE .../compromissos_terapeuta?id=eq.<id> ...
```

Stop the dev server: `kill %1`

- [ ] **Step 4: Add the recurrence UI to the "Lançar compromisso" form**

In `app/terapeutas/[id]/page.tsx`, add state near the other `compromissoNovo*` declarations:

```ts
  const [compromissoNovoRepetir, setCompromissoNovoRepetir] = useState(false)
  const [compromissoNovoSemanas, setCompromissoNovoSemanas] = useState('8')
  const [compromissoNovoSucesso, setCompromissoNovoSucesso] = useState<number | null>(null)
```

In `abrirLancarCompromisso`, reset the new state alongside the existing resets:

```ts
  function abrirLancarCompromisso(inicio: Date, fim: Date) {
    setCompromissoNovoTitulo('')
    setCompromissoNovoCategoria('compromisso')
    setCompromissoNovoRepetir(false)
    setCompromissoNovoSemanas('8')
```

(keep the rest of the function body unchanged — this only adds two lines after `setCompromissoNovoCategoria('compromisso')`).

In `handleLancarCompromisso`, add `repetir_semanas` to the POST body and handle the plural response:

```ts
      body: JSON.stringify({
        terapeuta_id: id,
        titulo: compromissoNovoTitulo,
        categoria: compromissoNovoCategoria,
        inicio: compromissoNovoInicio,
        fim: compromissoNovoFim,
        repetir_semanas: compromissoNovoRepetir ? (parseInt(compromissoNovoSemanas, 10) || 1) : undefined,
        usuario_nome: sessionNome || adminEmail.split('@')[0],
```

Find where the function handles the success path (`setCompromissoNovoSenhaOpen(false); setCompromissoNovoOpen(false)`) and change it to:

```ts
    const json = await res.json()
    setCompromissoNovoLoading(false)
    if (!res.ok) { setCompromissoNovoErro(json.error ?? 'Erro'); return }
    setCompromissoNovoSenhaOpen(false); setCompromissoNovoOpen(false)
    setCompromissoNovoTitulo(''); setCompromissoNovoCategoria('compromisso')
    setCompromissoNovoInicio(''); setCompromissoNovoFim('')
    const criados = (json.ids as string[])?.length ?? 1
    if (compromissoNovoRepetir && criados > 1) setCompromissoNovoSucesso(criados)
    setCompromissoNovoRepetir(false); setCompromissoNovoSemanas('8')
    loadData()
```

In the form JSX, right after the Início/Fim `grid grid-cols-2` block and before `{compromissoNovoErro && ...}`, add:

```tsx
              <div>
                <label className="flex items-center gap-2 text-xs text-gray-400">
                  <input type="checkbox" checked={compromissoNovoRepetir} onChange={e => setCompromissoNovoRepetir(e.target.checked)}
                    className="rounded border-white/10 bg-gray-800" />
                  Repetir semanalmente
                </label>
                {compromissoNovoRepetir && (
                  <div className="mt-2">
                    <label className="text-xs text-gray-400 block mb-1">Por quantas semanas</label>
                    <input type="number" min={2} max={52} value={compromissoNovoSemanas}
                      onChange={e => setCompromissoNovoSemanas(e.target.value)}
                      className="w-24 bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
                  </div>
                )}
              </div>
```

Add a small success confirmation modal near the other similar ones (e.g. right after the `compromissoNovoSenhaOpen` `<SenhaModal>`), mirroring the existing `manualSucesso` pattern:

```tsx
      {compromissoNovoSucesso && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setCompromissoNovoSucesso(null)}>
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-sm mx-4 text-center" onClick={e => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-7 h-7 text-green-500" />
            </div>
            <h3 className="text-base font-semibold text-white mb-1">Compromissos criados!</h3>
            <p className="text-sm text-gray-400 mb-5">{compromissoNovoSucesso} compromissos lançados, um por semana.</p>
            <button onClick={() => setCompromissoNovoSucesso(null)}
              className="w-full py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors">
              OK
            </button>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors.

- [ ] **Step 6: Manual verification**

```bash
npm run dev
```

Open a therapist's day view, click a free slot, check "Repetir semanalmente", set "3" semanas, fill a title, confirm with senha. Confirm: the success modal shows "3 compromissos lançados, um por semana", and the timeline (today) shows the new commitment block. Navigate the day view forward 7 and 14 days (`›` twice) to confirm the recurring copies appear there too.

- [ ] **Step 7: Commit**

```bash
git add app/api/terapeutas/compromissos/route.ts "app/terapeutas/[id]/page.tsx"
git commit -m "feat: compromisso recorrente semanal em lote"
```

---

### Task 5: Editar horário individual ao agendar sessões

**Files:**
- Modify: `app/api/terapeutas/sessoes/agendar/route.ts`
- Modify: `app/terapeutas/vendas/page.tsx`

**Interfaces:**
- Produces: `POST /api/terapeutas/sessoes/agendar` body gains optional `datas_sessoes?: string[]` (datetime-local strings, one per session, same format as `data_primeira_sessao`).

- [ ] **Step 1: Extend the API route to accept explicit per-session dates**

In `app/api/terapeutas/sessoes/agendar/route.ts`, add `datas_sessoes` to the body type:

```ts
  const { sale_id, terapeuta_id, data_primeira_sessao, numero_sessoes, datas_sessoes, usuario_email, senha } = body as {
    sale_id: string
    terapeuta_id: string
    data_primeira_sessao: string
    numero_sessoes?: number
    datas_sessoes?: string[]
    usuario_email: string
    senha: string
  }
```

Replace the date-computation block:

```ts
  const primeiraDataMs = new Date(brasiliaLocalToISO(data_primeira_sessao)).getTime()
  const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000
  const sessoes = Array.from({ length: numSessoes }, (_, i) => {
    return {
      sale_id,
      terapeuta_id,
      numero_sessao: i + 1,
      total_sessoes: numSessoes,
      status: 'agendada',
      status_consulta: 'aguardando',
      data_agendada: new Date(primeiraDataMs + i * SETE_DIAS_MS).toISOString(),
```

with:

```ts
  // Regra padrão: 7 em 7 dias a partir da primeira. `datas_sessoes` (opcional,
  // um datetime-local por sessão) deixa o comercial corrigir pontualmente uma
  // sessão que sai da regra — sem mudar como as demais são calculadas.
  const primeiraDataMs = new Date(brasiliaLocalToISO(data_primeira_sessao)).getTime()
  const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000
  const datasExplicitas = datas_sessoes && datas_sessoes.length === numSessoes
    ? datas_sessoes.map(d => new Date(brasiliaLocalToISO(d)).toISOString())
    : null
  const sessoes = Array.from({ length: numSessoes }, (_, i) => {
    return {
      sale_id,
      terapeuta_id,
      numero_sessao: i + 1,
      total_sessoes: numSessoes,
      status: 'agendada',
      status_consulta: 'aguardando',
      data_agendada: datasExplicitas ? datasExplicitas[i] : new Date(primeiraDataMs + i * SETE_DIAS_MS).toISOString(),
```

(Everything else in that object literal — `link_meet`, `comissao_valor`, etc. — stays exactly as-is.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Make the preview dates editable in `vendas/page.tsx`**

Add a generic Date→datetime-local helper right after `nowForDatetimeLocal` (same conversion logic, generalized to any `Date`):

```ts
function dateToDatetimeLocal(date: Date): string {
  const d = new Date(date)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}
```

Add state for the editable list near `agendarDataPrimeira`/`agendarNumSessoesInput`:

```ts
  const [agendarDatasEditadas, setAgendarDatasEditadas] = useState<string[]>([])
```

Replace the derived `agendarPreviewDatas` (currently computed inline as `Date[]` on every render) with a `useEffect` that (re)initializes the editable state whenever the base parameters change, plus a plain derived array for convenience:

```ts
  useEffect(() => {
    if (!agendarDataPrimeira || !agendarVenda) { setAgendarDatasEditadas([]); return }
    setAgendarDatasEditadas(Array.from({ length: agendarNumSessoes }, (_, i) => {
      const d = new Date(agendarDataPrimeira)
      d.setDate(d.getDate() + i * 7)
      return dateToDatetimeLocal(d)
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agendarDataPrimeira, agendarNumSessoes, agendarVendaId])
```

Remove the old inline `agendarPreviewDatas` derivation:

```ts
  const agendarPreviewDatas = agendarDataPrimeira && agendarVenda
    ? Array.from({ length: agendarNumSessoes }, (_, i) => {
        const d = new Date(agendarDataPrimeira)
        d.setDate(d.getDate() + i * 7)
        return d
      })
    : []
```

(delete this block entirely — `agendarDatasEditadas` replaces it).

- [ ] **Step 4: Render the preview list as editable inputs**

Replace the read-only preview block:

```tsx
              {agendarPreviewDatas.length > 0 && (
                <div className="bg-gray-800/60 rounded-lg p-3">
                  <p className="text-xs text-gray-400 mb-2 font-medium">Datas das {agendarNumSessoes} sessões (intervalo de 7 dias):</p>
                  <div className="space-y-1">
                    {agendarPreviewDatas.map((d, i) => (
                      <div key={i} className="flex items-center gap-3 text-xs">
                        <span className="text-gray-500 w-16 shrink-0">Sessão {i + 1}:</span>
                        <span className="text-white">{d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
```

with:

```tsx
              {agendarDatasEditadas.length > 0 && (
                <div className="bg-gray-800/60 rounded-lg p-3">
                  <p className="text-xs text-gray-400 mb-2 font-medium">Datas das {agendarNumSessoes} sessões (intervalo de 7 dias — edite se alguma sessão real sair da regra):</p>
                  <div className="space-y-1.5">
                    {agendarDatasEditadas.map((valor, i) => (
                      <div key={i} className="flex items-center gap-3 text-xs">
                        <span className="text-gray-500 w-16 shrink-0">Sessão {i + 1}:</span>
                        <input type="datetime-local" value={valor}
                          onChange={e => setAgendarDatasEditadas(prev => prev.map((v, idx) => idx === i ? e.target.value : v))}
                          className="flex-1 bg-gray-800 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500/50" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
```

- [ ] **Step 5: Send the (possibly-edited) dates on submit**

In `handleAgendar`, add `datas_sessoes` to the POST body:

```ts
      body: JSON.stringify({
        sale_id: agendarVendaId, terapeuta_id: agendarTerapeutaId,
        data_primeira_sessao: agendarDataPrimeira,
        numero_sessoes: agendarNumSessoes,
        datas_sessoes: agendarDatasEditadas.length === agendarNumSessoes ? agendarDatasEditadas : undefined,
        usuario_email: adminEmail, senha,
      }),
```

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors.

- [ ] **Step 7: Manual verification**

```bash
npm run dev
```

Open `/terapeutas/vendas`, open "Agendar" on any pending sale, pick a first date/time and a session count. Confirm the preview shows editable datetime inputs (not plain text) pre-filled with the 7-day sequence. Edit session 2's time to something off the 7-day pattern, confirm with senha. Verify in the DB that session 2's `data_agendada` matches the edited value while sessions 1/3/etc. still match the 7-day rule:

```bash
set -a && source .env.local && set +a
curl -s "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/sessoes?sale_id=eq.<sale_id>&select=numero_sessao,data_agendada&order=numero_sessao" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
```

Then repeat without editing any date (leave the computed defaults as-is) and confirm all sessions still land exactly 7 days apart, same as before this task — the default path must be unaffected.

- [ ] **Step 8: Commit**

```bash
git add app/api/terapeutas/sessoes/agendar/route.ts app/terapeutas/vendas/page.tsx
git commit -m "feat: permitir editar horario individual ao agendar sessoes"
```

---

### Task 6: Deploy and verify in production

**Files:** none (verification only).

- [ ] **Step 1: Final typecheck and lint on the full branch**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors vs. the established baseline (51 pre-existing problems).

- [ ] **Step 2: Push and wait for the Vercel deployment to match the latest commit**

```bash
git push origin main
LOCAL_SHA=$(git rev-parse HEAD)
for i in $(seq 1 20); do
  DEP=$(gh api repos/darlanrafael/spr-digital/deployments --jq '.[0].sha' 2>/dev/null)
  if [ "$DEP" = "$LOCAL_SHA" ]; then echo "MATCH: $DEP"; break; fi
  sleep 15
done
```

Expected: `MATCH: <local sha>` within a few minutes. Deploy propagation lag has happened before in this repo — keep polling rather than assuming failure.

- [ ] **Step 3: Smoke-test all four changes against production**

1. Open `https://spr-digital.vercel.app/terapeutas/<id-do-pedro>` → Agenda → month view: confirm day cards show "X vagos de 14". Click a day → confirm the day view shows only the 14 fixed slots as clickable/highlighted, not a continuous free band.
2. Open Denise's Agenda → month view: confirm day cards show "Xh livre" (continuous mode, unchanged).
3. Repeat the recurring-commitment curl test from Task 4 Step 3 against `https://spr-digital.vercel.app` instead of localhost; confirm 4 rows created 7 days apart, then delete them all.
4. Repeat the editable-session-date browser walkthrough from Task 5 Step 7 against the live site; confirm the edited date persists and the rest of the pattern is unaffected.

- [ ] **Step 4: Report completion**

Summarize to the user: month grid now previews free capacity per day, Pedro's Agenda shows his real fixed slots instead of a continuous band, personal commitments can repeat weekly in one shot, and the commercial team can now nudge an individual session's time without breaking the 7-day default for the rest — all live at `spr-digital.vercel.app`.

---

## Self-Review Notes

- **Spec coverage:** §1 horários fixos → Tasks 1-2-3 ✓; §2 preview no mês → Task 3 ✓; §3 compromisso recorrente → Task 4 ✓; §4 edição individual → Task 5 ✓; "sem UI de admin pra horarios_fixos" (Fora de escopo) → no task adds one ✓; "sem checagem de conflito recorrente" (Fora de escopo) → Task 4 explicitly has no per-occurrence validation ✓; "regra de 7 dias continua padrão" (Global Constraint) → Task 5's `datas_sessoes` is opt-in, falls back to the unchanged 7-day computation when omitted or wrong length ✓.
- **Placeholder scan:** none found — every step has literal code, exact commands, and stated expected output.
- **Type consistency:** `Ocupado`, `contarSlotsLivres`, `calcularIntervalosLivres`, `fmtDuracao`, `JANELA_INICIO_MIN`, `JANELA_FIM_MIN` are exported once in Task 2 and imported with matching names/signatures in Task 3; `horariosFixos?: string[]` prop name matches between Task 2's interface and Task 3's JSX usage; `repetir_semanas`/`ids` (API) and `datas_sessoes` (API) field names match exactly between their respective server (Task 4/5 Step 1) and client (Task 4/5 later steps) code.
