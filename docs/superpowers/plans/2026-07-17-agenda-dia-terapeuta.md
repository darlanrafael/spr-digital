# Agenda do Dia por Terapeuta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "click a day in the month calendar" behavior on `/terapeutas/[id]`'s Agenda tab with a day-by-hour timeline (sessions, personal commitments, free gaps highlighted on hover) that any therapist can use to block personal time and see at a glance what's free.

**Architecture:** A new presentational component (`AgendaDiaTerapeuta`) renders an 08:00–21:00 continuous timeline from props only (no data fetching of its own). `app/terapeutas/[id]/page.tsx` fetches a new `compromissos_terapeuta` table alongside the sessions it already loads, filters both down to the selected day, and passes them in. A new API route handles create/delete of personal commitments with the same password-confirmation pattern used everywhere else in this module. The month grid is unchanged except that clicking a day now opens the new day view instead of nothing happening at the cell level.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4, Supabase (Postgres + PostgREST), no test framework in this repo (verify via `npx tsc --noEmit`, `npm run lint`, and manual `curl`/browser checks against a running `npm run dev` server plus the deployed Vercel instance).

## Global Constraints

- Time window is fixed 08:00–21:00 for every therapist (not configurable).
- Session duration for timeline rendering comes from `terapeutas.duracao_sessao_minutos` (Pedro = 50, everyone else defaults to 60) — never inferred from the therapist's name (this exact codebase hit two separate bugs this same week from name-based inference; do not repeat the pattern).
- Personal commitments (`compromissos_terapeuta`) have no edit flow — correcting one means deleting and re-creating it.
- Clicking a free slot only opens "lançar compromisso pessoal" — no shortcut to scheduling a pending patient from there.
- Every write action (create/delete a commitment) requires password confirmation via the existing `SenhaModal` component and `verificarSenhaUsuario`, exactly like every other write action in this module. No extra "is this your own therapist_id" check — the whole app already works on password-only authorization for this module, so don't invent a stricter rule only here.
- This plan covers only `/terapeutas/[id]`'s own Agenda tab. The separate org-wide `/terapeutas/agenda` page (all therapists on one month grid) is untouched.
- Full spec: `docs/superpowers/specs/2026-07-17-agenda-dia-terapeuta-design.md`.

---

### Task 1: Database schema — `compromissos_terapeuta` table + session duration column

**Files:**
- Create: `supabase/migrations/20260718000000_compromissos_terapeuta.sql`

**Interfaces:**
- Produces: table `compromissos_terapeuta(id uuid, terapeuta_id uuid, titulo text, inicio timestamptz, fim timestamptz, criado_por_nome text, criado_por_tipo text, criado_por_email text, created_at timestamptz)`; column `terapeutas.duracao_sessao_minutos int not null default 60`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260718000000_compromissos_terapeuta.sql

-- Registro de compromisso pessoal do terapeuta na agenda (almoço, gravação
-- de conteúdo etc.) — não é ligado a nenhuma venda/paciente, só serve pra
-- travar um horário na Agenda do Dia. Sem fluxo de edição: corrigir um
-- lançamento errado é apagar e relançar.
create table if not exists compromissos_terapeuta (
  id               uuid        primary key default gen_random_uuid(),
  terapeuta_id     uuid        not null references terapeutas(id),
  titulo           text        not null,
  inicio           timestamptz not null,
  fim              timestamptz not null,
  criado_por_nome  text        not null,
  criado_por_tipo  text        not null,
  criado_por_email text        not null,
  created_at       timestamptz not null default now()
);
create index if not exists idx_compromissos_terapeuta_id_inicio on compromissos_terapeuta(terapeuta_id, inicio);

-- Duração da sessão em minutos, usada só pra desenhar o tamanho do bloco na
-- Agenda do Dia (hoje `sessoes` só guarda o horário de início, não o de
-- término). Deliberadamente um campo próprio em vez de inferir pelo nome do
-- terapeuta — ver Global Constraints do plano.
alter table terapeutas
  add column if not exists duracao_sessao_minutos int not null default 60;
```

- [ ] **Step 2: Apply the migration**

Run: `supabase db push`

**Known issue in this repo:** `supabase migration list` sometimes shows phantom entries out of sync with what's actually on the remote database (seen repeatedly this same week). If `supabase db push` fails with an error like "Remote migration versions not found in local migrations directory", run:

```bash
supabase migration repair --status reverted <the versions the error lists> --yes
supabase db push --include-all
```

Expected final output: `Applying migration 20260718000000_compromissos_terapeuta.sql...` followed by `Finished supabase db push.`

- [ ] **Step 3: Set Pedro Roncada's session duration to 50 minutes**

There's no admin UI for this field (matches how `vendas_a_partir_de` was set earlier this week — direct data patch, not a UI field). Run, with `.env.local`'s `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` loaded:

```bash
set -a && source .env.local && set +a
curl -s -X PATCH "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/terapeutas?nome=eq.Pedro%20Roncada" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{"duracao_sessao_minutos":50}'
```

Expected: JSON array with one object, `"duracao_sessao_minutos":50`.

- [ ] **Step 4: Verify the table and column exist**

```bash
curl -s "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/compromissos_terapeuta?select=id&limit=1" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
curl -s "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/terapeutas?select=nome,duracao_sessao_minutos" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
```

Expected: first call returns `[]` (empty table, no error). Second call returns every active therapist with `duracao_sessao_minutos`, Pedro Roncada at `50`, everyone else at `60`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260718000000_compromissos_terapeuta.sql
git commit -m "feat: tabela compromissos_terapeuta + duracao_sessao_minutos por terapeuta"
```

---

### Task 2: API route — create/delete personal commitments

**Files:**
- Create: `app/api/terapeutas/compromissos/route.ts`

**Interfaces:**
- Consumes: `verificarSenhaUsuario(email, senha)`, `registrarAtividade(params)`, `brasiliaLocalToISO(datetimeLocal)` from `@/lib/terapeutas-auth` (all already exist, signatures documented below).
  - `verificarSenhaUsuario(email: string, senha: string): Promise<{ valido: boolean; usuario?: Record<string, unknown> }>`
  - `registrarAtividade(params: { usuario_nome: string; usuario_tipo: string; tipo_acao: string; sessao_id?: string; sale_id?: string; descricao: string; dados_anteriores?: Record<string, unknown>; dados_novos?: Record<string, unknown> }): Promise<void>`
  - `brasiliaLocalToISO(datetimeLocal: string): string` — converts a `"YYYY-MM-DDTHH:mm"` string (no timezone, as produced by `<input type="datetime-local">`) into a UTC ISO string, assuming Brasília (UTC-3, fixed, no DST).
- Produces: `POST /api/terapeutas/compromissos` (body: `{ terapeuta_id, titulo, inicio, fim, usuario_nome, usuario_tipo, usuario_email, senha }`, `inicio`/`fim` as datetime-local strings) → `{ success: true, id: string }`. `DELETE /api/terapeutas/compromissos` (body: `{ id, usuario_nome, usuario_tipo, usuario_email, senha }`) → `{ success: true }`.

- [ ] **Step 1: Write the route**

```ts
// app/api/terapeutas/compromissos/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarSenhaUsuario, registrarAtividade, brasiliaLocalToISO } from '@/lib/terapeutas-auth'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      terapeuta_id: string
      titulo: string
      inicio: string
      fim: string
      usuario_nome: string
      usuario_tipo: string
      usuario_email: string
      senha: string
    }
    const { terapeuta_id, titulo, inicio, fim, usuario_nome, usuario_tipo, usuario_email, senha } = body

    if (!terapeuta_id || !titulo?.trim() || !inicio || !fim || !usuario_email || !senha) {
      return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 })
    }

    const inicioISO = brasiliaLocalToISO(inicio)
    const fimISO = brasiliaLocalToISO(fim)
    if (new Date(fimISO).getTime() <= new Date(inicioISO).getTime()) {
      return NextResponse.json({ error: 'Horário de fim precisa ser depois do início' }, { status: 400 })
    }

    const { valido, usuario } = await verificarSenhaUsuario(usuario_email, senha)
    if (!valido) return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 })

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('compromissos_terapeuta')
      .insert({
        terapeuta_id,
        titulo: titulo.trim(),
        inicio: inicioISO,
        fim: fimISO,
        criado_por_nome: usuario_nome,
        criado_por_tipo: usuario_tipo,
        criado_por_email: usuario_email,
      })
      .select('id')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await registrarAtividade({
      usuario_nome,
      usuario_tipo: usuario_tipo || ((usuario as Record<string, unknown>)?.tipo as string) || 'admin',
      tipo_acao: 'compromisso_criado',
      descricao: `Compromisso "${titulo.trim()}" lançado na agenda (${new Date(inicioISO).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} – ${new Date(fimISO).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })})`,
      dados_novos: { terapeuta_id, titulo: titulo.trim(), inicio: inicioISO, fim: fimISO },
    })

    return NextResponse.json({ success: true, id: data.id })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json() as {
      id: string
      usuario_nome: string
      usuario_tipo: string
      usuario_email: string
      senha: string
    }
    const { id, usuario_nome, usuario_tipo, usuario_email, senha } = body

    if (!id || !usuario_email || !senha) {
      return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 })
    }

    const { valido } = await verificarSenhaUsuario(usuario_email, senha)
    if (!valido) return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 })

    const supabase = getSupabaseAdmin()
    const { data: compromisso } = await supabase
      .from('compromissos_terapeuta').select('id,titulo').eq('id', id).single()
    if (!compromisso) return NextResponse.json({ error: 'Compromisso não encontrado' }, { status: 404 })

    const { error } = await supabase.from('compromissos_terapeuta').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await registrarAtividade({
      usuario_nome,
      usuario_tipo,
      tipo_acao: 'compromisso_apagado',
      descricao: `Compromisso "${compromisso.titulo}" removido da agenda`,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output (no errors).

- [ ] **Step 3: Manual verification against a running dev server**

```bash
npm run dev &
sleep 3
```

Get a real `terapeuta_id` and a valid `usuarios_sistema` login (email/senha) to test with — ask the person running this plan for a real login if none is known, or reuse `rafael@spr.com` if that's confirmed to work in this environment. Get Pedro Roncada's id:

```bash
set -a && source .env.local && set +a
curl -s "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/terapeutas?nome=eq.Pedro%20Roncada&select=id" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
```

Create a commitment:

```bash
curl -s -X POST http://localhost:3000/api/terapeutas/compromissos \
  -H "Content-Type: application/json" \
  -d '{"terapeuta_id":"<id-do-pedro>","titulo":"Teste plano — almoço","inicio":"2026-07-20T12:00","fim":"2026-07-20T13:00","usuario_nome":"Rafael","usuario_tipo":"admin","usuario_email":"rafael@spr.com","senha":"<senha-real>"}'
```

Expected: `{"success":true,"id":"<uuid>"}`. Verify directly in the database:

```bash
curl -s "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/compromissos_terapeuta?titulo=eq.Teste%20plano%20%E2%80%94%20almo%C3%A7o&select=*" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
```

Expected: one row, `inicio` around `2026-07-20T15:00:00+00:00` (12:00 BRT = 15:00 UTC), `fim` around `2026-07-20T16:00:00+00:00`.

Delete it using the `id` returned above:

```bash
curl -s -X DELETE http://localhost:3000/api/terapeutas/compromissos \
  -H "Content-Type: application/json" \
  -d '{"id":"<uuid-retornado>","usuario_nome":"Rafael","usuario_tipo":"admin","usuario_email":"rafael@spr.com","senha":"<senha-real>"}'
```

Expected: `{"success":true}`. Re-run the verification query above — expect `[]`.

Stop the dev server: `kill %1`

- [ ] **Step 4: Commit**

```bash
git add app/api/terapeutas/compromissos/route.ts
git commit -m "feat: endpoint de criar/apagar compromisso pessoal na agenda do terapeuta"
```

---

### Task 3: `AgendaDiaTerapeuta` component — day timeline rendering

**Files:**
- Create: `components/terapeutas/AgendaDiaTerapeuta.tsx`

**Interfaces:**
- Produces (used by Task 4 and Task 5):
  ```ts
  export type SessaoDia = {
    id: string
    paciente_nome: string
    numero_sessao: number
    total_sessoes: number
    status: string
    data_agendada: string // ISO, never null — caller filters nulls out before passing
  }
  export type CompromissoDia = {
    id: string
    titulo: string
    inicio: string // ISO
    fim: string // ISO
  }
  interface AgendaDiaTerapeutaProps {
    data: Date
    sessoes: SessaoDia[]
    compromissos: CompromissoDia[]
    duracaoSessaoMinutos: number
    onClickSessao: (sessao: SessaoDia) => void
    onClickCompromisso: (compromisso: CompromissoDia) => void
    onClickLivre: (inicio: Date, fim: Date) => void
    onNavegarDia: (direcao: -1 | 1) => void
    onVoltarMes: () => void
  }
  export default function AgendaDiaTerapeuta(props: AgendaDiaTerapeutaProps): JSX.Element
  ```
  Pure presentational component — no data fetching, no internal write state. Renders nothing outside its own bounding `<div>` (no modals; those live in the page, per Task 5).
- Consumes: nothing outside React/lucide-react.

- [ ] **Step 1: Write the component**

```tsx
// components/terapeutas/AgendaDiaTerapeuta.tsx
'use client'

export type SessaoDia = {
  id: string
  paciente_nome: string
  numero_sessao: number
  total_sessoes: number
  status: string
  data_agendada: string
}

export type CompromissoDia = {
  id: string
  titulo: string
  inicio: string
  fim: string
}

interface AgendaDiaTerapeutaProps {
  data: Date
  sessoes: SessaoDia[]
  compromissos: CompromissoDia[]
  duracaoSessaoMinutos: number
  onClickSessao: (sessao: SessaoDia) => void
  onClickCompromisso: (compromisso: CompromissoDia) => void
  onClickLivre: (inicio: Date, fim: Date) => void
  onNavegarDia: (direcao: -1 | 1) => void
  onVoltarMes: () => void
}

const JANELA_INICIO_MIN = 8 * 60   // 08:00
const JANELA_FIM_MIN = 21 * 60     // 21:00
const PX_POR_MIN = 1

function minutosDoDia(iso: string): number {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

function horaParaData(diaBase: Date, minutos: number): Date {
  const d = new Date(diaBase)
  d.setHours(0, minutos, 0, 0)
  return d
}

function fmtHora(min: number): string {
  const h = Math.floor(min / 60).toString().padStart(2, '0')
  const m = (min % 60).toString().padStart(2, '0')
  return `${h}:${m}`
}

function fmtDuracao(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m}min`
  if (m === 0) return `${h}h`
  return `${h}h${m}min`
}

type Ocupado = { inicio: number; fim: number }

// Calcula os intervalos livres dentro da janela do dia, dado tudo que já
// ocupa horário (sessões + compromissos, em minutos desde meia-noite). O
// cursor nunca anda pra trás, então intervalos sobrepostos/aninhados não
// geram um "livre" fantasma no meio deles.
function calcularIntervalosLivres(ocupados: Ocupado[], janelaInicio: number, janelaFim: number): Ocupado[] {
  const ordenados = [...ocupados].sort((a, b) => a.inicio - b.inicio)
  const livres: Ocupado[] = []
  let cursor = janelaInicio
  for (const o of ordenados) {
    const inicio = Math.max(o.inicio, janelaInicio)
    const fim = Math.min(o.fim, janelaFim)
    if (inicio > cursor) livres.push({ inicio: cursor, fim: inicio })
    cursor = Math.max(cursor, fim)
  }
  if (cursor < janelaFim) livres.push({ inicio: cursor, fim: janelaFim })
  return livres
}

export default function AgendaDiaTerapeuta({
  data, sessoes, compromissos, duracaoSessaoMinutos,
  onClickSessao, onClickCompromisso, onClickLivre, onNavegarDia, onVoltarMes,
}: AgendaDiaTerapeutaProps) {
  const isHoje = data.toDateString() === new Date().toDateString()
  const agora = new Date()
  const agoraMin = agora.getHours() * 60 + agora.getMinutes()

  const sessoesComHorario = sessoes.map(s => ({
    sessao: s,
    inicio: minutosDoDia(s.data_agendada),
    fim: minutosDoDia(s.data_agendada) + duracaoSessaoMinutos,
  }))

  const compromissosComHorario = compromissos.map(c => ({
    compromisso: c,
    inicio: minutosDoDia(c.inicio),
    fim: minutosDoDia(c.fim),
  }))

  const ocupados: Ocupado[] = [
    ...sessoesComHorario.map(s => ({ inicio: s.inicio, fim: s.fim })),
    ...compromissosComHorario.map(c => ({ inicio: c.inicio, fim: c.fim })),
  ]
  const livres = calcularIntervalosLivres(ocupados, JANELA_INICIO_MIN, JANELA_FIM_MIN)

  const alturaTotal = (JANELA_FIM_MIN - JANELA_INICIO_MIN) * PX_POR_MIN
  const primeiraHora = Math.ceil(JANELA_INICIO_MIN / 60)
  const ultimaHora = Math.floor(JANELA_FIM_MIN / 60)
  const horasMarcadas = Array.from({ length: ultimaHora - primeiraHora + 1 }, (_, i) => primeiraHora + i)

  return (
    <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
        <button onClick={onVoltarMes} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">‹ Mês</button>
        <div className="flex items-center gap-3">
          <button onClick={() => onNavegarDia(-1)} aria-label="Dia anterior"
            className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors">‹</button>
          <p className="text-sm font-semibold text-white capitalize">
            {data.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
          </p>
          <button onClick={() => onNavegarDia(1)} aria-label="Próximo dia"
            className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors">›</button>
        </div>
        <div className="w-12" />
      </div>

      <div className="flex items-center gap-4 px-5 py-2.5 border-b border-white/5 text-[11px] text-gray-500">
        <span className="flex items-center gap-1.5"><i className="w-[3px] h-2.5 rounded-sm bg-indigo-500 inline-block" /> Sessão</span>
        <span className="flex items-center gap-1.5"><i className="w-[3px] h-2.5 rounded-sm bg-stone-400 inline-block" /> Compromisso</span>
        <span className="flex items-center gap-1.5"><i className="w-2 h-2 rounded-sm bg-green-400/60 inline-block" /> Livre — clique pra bloquear</span>
      </div>

      <div className="flex px-5 py-4">
        <div className="w-12 shrink-0 relative" style={{ height: alturaTotal }}>
          {horasMarcadas.map(h => (
            <div key={h} className="absolute right-2 text-[10px] text-gray-600 -translate-y-1/2"
              style={{ top: (h * 60 - JANELA_INICIO_MIN) * PX_POR_MIN }}>
              {h.toString().padStart(2, '0')}:00
            </div>
          ))}
        </div>

        <div className="relative flex-1 border-l border-white/5" style={{ height: alturaTotal }}>
          {horasMarcadas.map(h => (
            <div key={h} className="absolute left-0 right-0 border-t border-white/5"
              style={{ top: (h * 60 - JANELA_INICIO_MIN) * PX_POR_MIN }} />
          ))}

          {livres.map((l, i) => (
            <div key={`livre-${i}`}
              onClick={() => onClickLivre(horaParaData(data, l.inicio), horaParaData(data, l.fim))}
              className="absolute left-0 right-0 group cursor-pointer hover:bg-white/[0.03] rounded-lg transition-colors flex items-center px-3"
              style={{ top: (l.inicio - JANELA_INICIO_MIN) * PX_POR_MIN, height: (l.fim - l.inicio) * PX_POR_MIN }}>
              <span className="text-[11px] text-transparent group-hover:text-green-400 transition-colors">
                + {fmtDuracao(l.fim - l.inicio)} livre
              </span>
            </div>
          ))}

          {sessoesComHorario.map(({ sessao, inicio, fim }) => (
            <button key={sessao.id} onClick={() => onClickSessao(sessao)}
              className="absolute left-0 right-2 text-left rounded-r-lg border-l-[3px] border-indigo-500 bg-indigo-500/10 hover:bg-indigo-500/20 transition-colors px-2.5 py-1 overflow-hidden"
              style={{ top: (inicio - JANELA_INICIO_MIN) * PX_POR_MIN, height: Math.max((fim - inicio) * PX_POR_MIN, 20) }}>
              <p className="text-[11px] font-medium text-indigo-200 truncate">{sessao.paciente_nome}</p>
              <p className="text-[10px] text-indigo-400/80 truncate">{fmtHora(inicio)}–{fmtHora(fim)} · Sessão {sessao.numero_sessao}/{sessao.total_sessoes}</p>
            </button>
          ))}

          {compromissosComHorario.map(({ compromisso, inicio, fim }) => (
            <button key={compromisso.id} onClick={() => onClickCompromisso(compromisso)}
              className="absolute left-0 right-2 text-left rounded-r-lg border-l-[3px] border-stone-400 bg-stone-400/10 hover:bg-stone-400/20 transition-colors px-2.5 py-1 overflow-hidden"
              style={{ top: (inicio - JANELA_INICIO_MIN) * PX_POR_MIN, height: Math.max((fim - inicio) * PX_POR_MIN, 20) }}>
              <p className="text-[11px] font-medium text-stone-300 truncate">🔒 {compromisso.titulo}</p>
              <p className="text-[10px] text-stone-500 truncate">{fmtHora(inicio)}–{fmtHora(fim)}</p>
            </button>
          ))}

          {isHoje && agoraMin >= JANELA_INICIO_MIN && agoraMin <= JANELA_FIM_MIN && (
            <div className="absolute left-0 right-0 h-px bg-red-400 z-10"
              style={{ top: (agoraMin - JANELA_INICIO_MIN) * PX_POR_MIN }}>
              <span className="absolute -left-1 -top-[3px] w-[7px] h-[7px] rounded-full bg-red-400" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. (`components/terapeutas/` is a new directory — this step also confirms it's picked up by both tools without config changes.)

- [ ] **Step 3: Verify `calcularIntervalosLivres` by hand**

This repo has no test framework, so verify the pure function directly with `node`:

```bash
node -e "
function calcularIntervalosLivres(ocupados, janelaInicio, janelaFim) {
  const ordenados = [...ocupados].sort((a, b) => a.inicio - b.inicio);
  const livres = [];
  let cursor = janelaInicio;
  for (const o of ordenados) {
    const inicio = Math.max(o.inicio, janelaInicio);
    const fim = Math.min(o.fim, janelaFim);
    if (inicio > cursor) livres.push({ inicio: cursor, fim: inicio });
    cursor = Math.max(cursor, fim);
  }
  if (cursor < janelaFim) livres.push({ inicio: cursor, fim: janelaFim });
  return livres;
}
// sessão 09:00-09:50 (540-590) + compromisso 10:00-10:30 (600-630), janela 08:00-12:30 (480-750)
console.log(JSON.stringify(calcularIntervalosLivres([{inicio:540,fim:590},{inicio:600,fim:630}], 480, 750)));
// overlap: dois compromissos sobrepostos não devem gerar livre fantasma no meio
console.log(JSON.stringify(calcularIntervalosLivres([{inicio:540,fim:600},{inicio:570,fim:650}], 480, 750)));
"
```

Expected first line: `[{"inicio":480,"fim":540},{"inicio":590,"fim":600},{"inicio":630,"fim":750}]` (livre 08:00–09:00, 09:50–10:00, 10:30–12:30).
Expected second line: `[{"inicio":480,"fim":540},{"inicio":650,"fim":750}]` (um único bloco ocupado 09:00–10:50, sem furo fantasma no meio da sobreposição).

- [ ] **Step 4: Commit**

```bash
git add components/terapeutas/AgendaDiaTerapeuta.tsx
git commit -m "feat: componente AgendaDiaTerapeuta — timeline do dia por horário"
```

---

### Task 4: Wire the day view into `/terapeutas/[id]` (read-only integration)

**Files:**
- Modify: `app/terapeutas/[id]/page.tsx`

**Interfaces:**
- Consumes: `AgendaDiaTerapeuta`, `SessaoDia`, `CompromissoDia` from `@/components/terapeutas/AgendaDiaTerapeuta` (Task 3).
- Produces: page state `agendaDiaSelecionado: Date | null` and `compromissos: CompromissoDia[]`, both consumed by Task 5.

This task makes the month grid open a working, read-only day view (real sessions positioned correctly, now-line, hover-to-see-free-time, clicking a session opens the existing detail modal). Clicking a free slot or a commitment does nothing yet — that's Task 5.

- [ ] **Step 1: Import the new component and add state**

In `app/terapeutas/[id]/page.tsx`, add near the top with the other imports (around line 15, after `Pagination`):

```ts
import AgendaDiaTerapeuta, { SessaoDia, CompromissoDia } from '@/components/terapeutas/AgendaDiaTerapeuta'
```

Add `duracao_sessao_minutos` to the `Terapeuta` type (currently at line 22-28):

```ts
type Terapeuta = {
  id: string
  nome: string
  email: string
  percentual_comissao: number
  vendas_a_partir_de: string | null
  duracao_sessao_minutos: number
}
```

Add new state right after the existing Agenda state block (`agendaDetalhe`, around line 318):

```ts
const [agendaDiaSelecionado, setAgendaDiaSelecionado] = useState<Date | null>(null)
const [compromissos, setCompromissos] = useState<CompromissoDia[]>([])
```

- [ ] **Step 2: Fetch `duracao_sessao_minutos` and `compromissos_terapeuta`**

In `loadData()`, the first query already selects from `terapeutas` — add the new column (around line 394):

```ts
client.from('terapeutas').select('id,nome,email,percentual_comissao,vendas_a_partir_de,duracao_sessao_minutos').eq('id', id).single(),
```

Right after `setSessoes(sessoesData)` (in the version from the previous work this week, this is right after the block that sets `sessoesData`/`saleIdsVisiveis` — look for the line `setSessoes(sessoesData)`), add a fetch for this therapist's commitments:

```ts
const { data: compromissosData } = await client
  .from('compromissos_terapeuta').select('id,titulo,inicio,fim').eq('terapeuta_id', id).order('inicio')
setCompromissos((compromissosData ?? []) as CompromissoDia[])
```

- [ ] **Step 3: Replace the month grid's day-cell click behavior**

Find the Agenda tab render block (search for `{terapeutaTab === 'agenda' && (`). Currently every day cell shows up to 3 session buttons, each opening `agendaDetalhe` directly, with no click handler on the cell itself. Replace the whole `{terapeutaTab === 'agenda' && ( ... )}` block with:

```tsx
{terapeutaTab === 'agenda' && (
  agendaDiaSelecionado ? (
    <AgendaDiaTerapeuta
      data={agendaDiaSelecionado}
      sessoes={sessoes
        .filter(s => s.data_agendada && s.status !== 'cancelada'
          && new Date(s.data_agendada).toDateString() === agendaDiaSelecionado.toDateString())
        .map((s): SessaoDia => ({
          id: s.id,
          paciente_nome: s.paciente_nome,
          numero_sessao: s.numero_sessao,
          total_sessoes: s.total_sessoes,
          status: s.status,
          data_agendada: s.data_agendada as string,
        }))}
      compromissos={compromissos.filter(c =>
        new Date(c.inicio).toDateString() === agendaDiaSelecionado.toDateString())}
      duracaoSessaoMinutos={terapeuta?.duracao_sessao_minutos ?? 60}
      onClickSessao={(sessaoDia) => {
        const sessaoCompleta = sessoes.find(s => s.id === sessaoDia.id)
        if (sessaoCompleta) setAgendaDetalhe(sessaoCompleta)
      }}
      onClickCompromisso={() => { /* wired in Task 5 */ }}
      onClickLivre={() => { /* wired in Task 5 */ }}
      onNavegarDia={(dir) => setAgendaDiaSelecionado(d => {
        if (!d) return d
        const novo = new Date(d)
        novo.setDate(novo.getDate() + dir)
        return novo
      })}
      onVoltarMes={() => setAgendaDiaSelecionado(null)}
    />
  ) : (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm font-medium text-white">{MESES_NOME[agendaMes]} {agendaAno}</p>
        <div className="flex items-center gap-1">
          <button onClick={() => navMesAgenda(-1)} aria-label="Mês anterior" className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button onClick={() => navMesAgenda(1)} aria-label="Próximo mês" className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="bg-gray-900 border border-white/10 rounded-xl overflow-hidden">
        <div className="grid grid-cols-7 border-b border-white/10">
          {DIAS_SEMANA.map(d => (
            <div key={d} className="px-2 py-3 text-center text-xs text-gray-500 font-medium">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {agendaCells.map((dia, idx) => {
            const ss = dia ? sessoesNoDiaAgenda(dia) : []
            const isHoje = dia === agendaHojeCell
            return (
              <button key={idx} type="button" disabled={!dia}
                onClick={() => dia && setAgendaDiaSelecionado(new Date(agendaAno, agendaMes, dia))}
                className={`min-h-[90px] p-1.5 border-b border-r border-white/5 text-left ${!dia ? 'bg-gray-900/50 cursor-default' : 'hover:bg-white/5 transition-colors cursor-pointer'}`}>
                {dia && (
                  <>
                    <span className={`text-xs font-medium inline-flex w-6 h-6 items-center justify-center rounded-full mb-1 ${
                      isHoje ? 'bg-indigo-600 text-white' : 'text-gray-400'
                    }`}>{dia}</span>
                    <div className="space-y-0.5">
                      {ss.slice(0, 3).map(s => (
                        <div key={s.id}
                          className="w-full text-left text-[10px] px-1.5 py-0.5 rounded bg-indigo-600/20 text-indigo-300 truncate">
                          {s.data_agendada ? new Date(s.data_agendada).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''} {s.paciente_nome.split(' ')[0]}
                        </div>
                      ))}
                      {ss.length > 3 && (
                        <span className="text-[10px] text-gray-500">+{ss.length - 3} mais</span>
                      )}
                    </div>
                  </>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
)}
```

Note this drops the per-session `onClick={() => setAgendaDetalhe(s)}` on the month-grid chips (they're now a plain, non-interactive preview `<div>`) — clicking anywhere on the day cell opens the day view instead, where clicking the session block opens the same detail modal.

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 5: Manual verification**

```bash
npm run dev
```

Open `http://localhost:3000/terapeutas/<id-de-um-terapeuta-com-sessoes-reais>` (Pedro or Denise), log in, go to the Agenda tab, click a day that has at least one real session. Confirm:
- The day view opens (header shows the right weekday/date, "‹ Mês" link visible).
- The session block is positioned at roughly the right vertical spot for its time and has the right height (Pedro: thin block ~50px tall; other therapists: ~60px).
- Clicking the session block opens the same "Detalhes da consulta" modal that worked before this change (iniciar/concluir/anular/remarcar still work).
- If the selected day is today, a thin red line appears at the current time.
- Hovering an empty area shows "+ Xh livre" (or similar) text — clicking it does nothing yet (expected, Task 5 wires it).
- "‹ Mês" returns to the month grid, and the month grid itself still looks and behaves like before (day cells, "+N mais" preview).

- [ ] **Step 6: Commit**

```bash
git add "app/terapeutas/[id]/page.tsx"
git commit -m "feat: abrir Agenda do Dia ao clicar um dia no calendário do terapeuta"
```

---

### Task 5: Lançar/apagar compromisso pessoal (write UI)

**Files:**
- Modify: `app/terapeutas/[id]/page.tsx`

**Interfaces:**
- Consumes: `POST`/`DELETE /api/terapeutas/compromissos` (Task 2), `onClickLivre`/`onClickCompromisso` callbacks already wired as no-ops in Task 4.

- [ ] **Step 1: Add state for both flows**

Near the other modal state (after the `compromissos` state added in Task 4):

```ts
// Lançar compromisso pessoal — a partir de um clique em horário livre na Agenda do Dia
const [compromissoNovoOpen, setCompromissoNovoOpen] = useState(false)
const [compromissoNovoTitulo, setCompromissoNovoTitulo] = useState('')
const [compromissoNovoInicio, setCompromissoNovoInicio] = useState('')
const [compromissoNovoFim, setCompromissoNovoFim] = useState('')
const [compromissoNovoErro, setCompromissoNovoErro] = useState('')
const [compromissoNovoLoading, setCompromissoNovoLoading] = useState(false)
const [compromissoNovoSenhaOpen, setCompromissoNovoSenhaOpen] = useState(false)

// Apagar compromisso — a partir de um clique num bloco de compromisso na Agenda do Dia
const [compromissoApagar, setCompromissoApagar] = useState<CompromissoDia | null>(null)
const [compromissoApagarErro, setCompromissoApagarErro] = useState('')
const [compromissoApagarLoading, setCompromissoApagarLoading] = useState(false)
const [compromissoApagarSenhaOpen, setCompromissoApagarSenhaOpen] = useState(false)
```

- [ ] **Step 2: Add the datetime-local conversion helper and handlers**

Near `nowForDatetimeLocal()` (top-level helper functions area), add:

```ts
function dateToDatetimeLocal(date: Date): string {
  const d = new Date(date)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}
```

Near the other handlers (e.g. after `handleLancamentoManual`), add:

```ts
function abrirLancarCompromisso(inicio: Date, fim: Date) {
  setCompromissoNovoTitulo('')
  setCompromissoNovoInicio(dateToDatetimeLocal(inicio))
  setCompromissoNovoFim(dateToDatetimeLocal(fim))
  setCompromissoNovoErro('')
  setCompromissoNovoOpen(true)
}

async function handleLancarCompromisso(senha: string) {
  setCompromissoNovoLoading(true); setCompromissoNovoErro('')
  const res = await fetch('/api/terapeutas/compromissos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      terapeuta_id: id,
      titulo: compromissoNovoTitulo,
      inicio: compromissoNovoInicio,
      fim: compromissoNovoFim,
      usuario_nome: sessionNome || adminEmail.split('@')[0],
      usuario_tipo: isTerapeutaSession ? 'terapeuta' : 'admin',
      usuario_email: adminEmail,
      senha,
    }),
  })
  const json = await res.json()
  setCompromissoNovoLoading(false)
  if (!res.ok) { setCompromissoNovoErro(json.error ?? 'Erro'); return }
  setCompromissoNovoSenhaOpen(false); setCompromissoNovoOpen(false)
  setCompromissoNovoTitulo(''); setCompromissoNovoInicio(''); setCompromissoNovoFim('')
  loadData()
}

async function handleApagarCompromisso(senha: string) {
  if (!compromissoApagar) return
  setCompromissoApagarLoading(true); setCompromissoApagarErro('')
  const res = await fetch('/api/terapeutas/compromissos', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: compromissoApagar.id,
      usuario_nome: sessionNome || adminEmail.split('@')[0],
      usuario_tipo: isTerapeutaSession ? 'terapeuta' : 'admin',
      usuario_email: adminEmail,
      senha,
    }),
  })
  const json = await res.json()
  setCompromissoApagarLoading(false)
  if (!res.ok) { setCompromissoApagarErro(json.error ?? 'Erro'); return }
  setCompromissoApagarSenhaOpen(false); setCompromissoApagar(null)
  loadData()
}

const compromissoNovoValido = compromissoNovoTitulo.trim().length > 0
  && compromissoNovoInicio && compromissoNovoFim
  && new Date(compromissoNovoFim) > new Date(compromissoNovoInicio)
```

- [ ] **Step 3: Wire the callbacks left as no-ops in Task 4**

In the `<AgendaDiaTerapeuta ... />` JSX from Task 4, replace:

```tsx
onClickCompromisso={() => { /* wired in Task 5 */ }}
onClickLivre={() => { /* wired in Task 5 */ }}
```

with:

```tsx
onClickCompromisso={(compromisso) => { setCompromissoApagar(compromisso); setCompromissoApagarErro('') }}
onClickLivre={(inicio, fim) => abrirLancarCompromisso(inicio, fim)}
```

- [ ] **Step 4: Add the two modals**

Add near the other modals at the bottom of the file (e.g. right before `<MobileNav />`):

```tsx
{/* Modal: Lançar compromisso pessoal */}
{compromissoNovoOpen && !compromissoNovoSenhaOpen && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
    <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-sm mx-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white">Lançar compromisso</h3>
        <button onClick={() => setCompromissoNovoOpen(false)} className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
      </div>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-gray-400 block mb-1">Título <span className="text-red-400">*</span></label>
          <input type="text" value={compromissoNovoTitulo} onChange={e => setCompromissoNovoTitulo(e.target.value)}
            placeholder="Ex: Almoço, Gravação de conteúdo"
            className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-400 block mb-1">Início <span className="text-red-400">*</span></label>
            <input type="datetime-local" value={compromissoNovoInicio} onChange={e => setCompromissoNovoInicio(e.target.value)}
              className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Fim <span className="text-red-400">*</span></label>
            <input type="datetime-local" value={compromissoNovoFim} onChange={e => setCompromissoNovoFim(e.target.value)}
              className="w-full bg-gray-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
          </div>
        </div>
        {compromissoNovoErro && <p className="text-xs text-red-400">{compromissoNovoErro}</p>}
      </div>
      <div className="flex gap-3 mt-5">
        <button onClick={() => setCompromissoNovoOpen(false)}
          className="flex-1 px-4 py-2 text-sm text-gray-400 bg-gray-800 border border-white/10 rounded-lg">Cancelar</button>
        <button onClick={() => {
          if (!compromissoNovoValido) { setCompromissoNovoErro('Preencha o título e um intervalo válido'); return }
          setCompromissoNovoErro(''); setCompromissoNovoSenhaOpen(true)
        }} disabled={!compromissoNovoValido}
          className="flex-1 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg transition-colors">
          Confirmar
        </button>
      </div>
    </div>
  </div>
)}

<SenhaModal
  isOpen={compromissoNovoSenhaOpen}
  onClose={() => { setCompromissoNovoSenhaOpen(false); setCompromissoNovoErro('') }}
  onConfirm={handleLancarCompromisso}
  titulo="Confirmar compromisso"
  descricao="Digite sua senha para travar esse horário na agenda"
  loading={compromissoNovoLoading}
  erro={compromissoNovoErro}
/>

{/* Modal: apagar compromisso pessoal */}
{compromissoApagar && !compromissoApagarSenhaOpen && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
    <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-sm mx-4">
      <h3 className="text-sm font-semibold text-white mb-1">Apagar compromisso</h3>
      <p className="text-xs text-gray-400 mb-4">
        &quot;{compromissoApagar.titulo}&quot; será removido da agenda. Essa ação não pode ser desfeita.
      </p>
      {compromissoApagarErro && <p className="text-xs text-red-400 mb-3">{compromissoApagarErro}</p>}
      <div className="flex gap-2">
        <button onClick={() => setCompromissoApagar(null)}
          className="flex-1 px-3 py-2 text-sm text-gray-400 bg-gray-800 border border-white/10 rounded-lg">Cancelar</button>
        <button onClick={() => setCompromissoApagarSenhaOpen(true)}
          className="flex-1 px-3 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors">
          Apagar
        </button>
      </div>
    </div>
  </div>
)}

<SenhaModal
  isOpen={compromissoApagarSenhaOpen}
  onClose={() => { setCompromissoApagarSenhaOpen(false); setCompromissoApagarErro('') }}
  onConfirm={handleApagarCompromisso}
  titulo="Confirmar exclusão"
  descricao="Digite sua senha para apagar o compromisso"
  loading={compromissoApagarLoading}
  erro={compromissoApagarErro}
/>
```

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 6: Manual verification**

```bash
npm run dev
```

On a therapist's Agenda tab, open the day view, hover an empty area and click it. Confirm:
- The "Lançar compromisso" form opens with início/fim pre-filled to roughly the hovered gap.
- Submitting with a title and valid senha closes the modal and the new commitment appears on the timeline (stone-colored block with a lock icon) at the right position/duration.
- Clicking that new block opens the "Apagar compromisso" confirmation; confirming with senha removes it from the timeline.
- Clicking "Confirmar" with an empty title shows the inline validation error and does not open the password modal.

- [ ] **Step 7: Commit**

```bash
git add "app/terapeutas/[id]/page.tsx"
git commit -m "feat: lançar e apagar compromisso pessoal na Agenda do Dia"
```

---

### Task 6: Deploy and verify in production

**Files:** none (verification only).

- [ ] **Step 1: Final typecheck and lint on the full branch**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

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

Expected: `MATCH: <local sha>` printed within a few minutes. If it takes longer than ~5 minutes, this has happened before in this repo (deploy propagation lag) — keep polling rather than assuming failure.

- [ ] **Step 3: Smoke-test against production**

Repeat the create/delete curl calls from Task 2 Step 3, but against `https://spr-digital.vercel.app/api/terapeutas/compromissos` instead of `localhost:3000`, using a real therapist id and a real login. Confirm the same expected responses, then confirm no leftover test row remains in `compromissos_terapeuta` afterward.

Open `https://spr-digital.vercel.app/terapeutas/<id-do-pedro>` in a browser, go to Agenda, click a day with a real session (e.g. today, if Leone's session is still there), and visually confirm the timeline renders correctly in production — same checks as Task 4 Step 5 and Task 5 Step 6, against the live site this time.

- [ ] **Step 4: Report completion**

Summarize to the user: what changed (month grid unchanged, day click now opens a hour-by-hour timeline; personal commitments can be lançado/apagado; session block size now reflects `duracao_sessao_minutos` per therapist), and that it's live at `spr-digital.vercel.app`.

---

## Self-Review Notes

- **Spec coverage:** window 08:00–21:00 (Task 3 constants) ✓; continuous timeline with exact-duration blocks (Task 3 positioning math) ✓; Pedro 50min / others 60min via a real column, not name inference (Task 1 + Task 3 `duracaoSessaoMinutos` prop) ✓; left-accent-bar minimal visual style approved in the companion (Task 3 classes) ✓; month view unchanged, day click opens day view (Task 4) ✓; session click reuses existing `agendaDetalhe` modal (Task 4 Step 3) ✓; free slot hover + click → only "lançar compromisso", no patient-scheduling shortcut (Task 5) ✓; commitments have no edit flow, delete-and-recreate only (Task 5 has create + delete, no edit UI) ✓; password confirmation via `SenhaModal`/`verificarSenhaUsuario`, no extra ownership check (Task 2 + Task 5) ✓; feature available to any active therapist, not Pedro-only (nothing in Tasks 3-5 is Pedro-specific; `duracaoSessaoMinutos` defaults to 60 for everyone else) ✓; org-wide `/terapeutas/agenda` untouched (no task modifies it) ✓; now-line only on today (Task 3 `isHoje` check) ✓.
- **Placeholder scan:** none found — every step has literal code, exact commands, and stated expected output.
- **Type consistency:** `SessaoDia`/`CompromissoDia` defined once in Task 3 and imported unchanged in Tasks 4-5; `AgendaDiaTerapeutaProps` callback signatures (`onClickSessao(sessao: SessaoDia)`, `onClickCompromisso(compromisso: CompromissoDia)`, `onClickLivre(inicio: Date, fim: Date)`, `onNavegarDia(direcao: -1 | 1)`, `onVoltarMes()`) match exactly how Task 4 and Task 5 call them.
