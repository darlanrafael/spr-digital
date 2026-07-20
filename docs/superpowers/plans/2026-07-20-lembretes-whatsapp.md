# Lembretes Automáticos via WhatsApp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expor no Next.js os endpoints que o n8n vai consumir pra mandar lembretes de atendimento via WhatsApp (véspera e 30 min antes, grupo e paciente), mais um mecanismo de alerta ao admin quando algo falhar — e, por último, criar os workflows correspondentes no n8n via API.

**Architecture:** O Next.js expõe 3 rotas somente-dados (`pendentes-vespera`, `pendentes-30min`, `marcar-enviado`), protegidas por um header secreto, que o n8n consome pra saber o que enviar e confirmar o que já enviou. `lib/notificar-admin.ts` chama um webhook do n8n sempre que algo falhar (hoje só a geração do link do Meet). Nenhum texto de mensagem nem lógica de envio mora no Next.js — isso tudo fica nos workflows do n8n, criados na Task 6 via chamadas à API REST do n8n.

**Tech Stack:** Next.js API routes, Supabase (`@supabase/supabase-js`), n8n REST API (`X-N8N-API-KEY`).

## Global Constraints

- Não modificar, apagar ou reconfigurar nenhum workflow, credencial ou nó já existente na instância de n8n do usuário — a Task 6 só pode CRIAR workflows novos.
- Horários de negócio (véspera, janela de 30 min) sempre em Brasília (UTC-3), fixo sem horário de verão — mesmo padrão de `app/api/terapeutas/dashboard/route.ts`.
- Os 3 endpoints novos exigem o header `x-whatsapp-cron-secret` igual à env var `WHATSAPP_CRON_SECRET` — 401 caso contrário. Nenhum outro tipo de autenticação (sem sessão de usuário).
- Nenhuma mensagem duplicada — cada tipo de lembrete por sessão só é considerado "pendente" enquanto sua coluna de timestamp correspondente for `null`.
- O texto das mensagens não vive no código — os endpoints devolvem só dados estruturados (nome, telefone, sessão X/Y, data, link).
- `notificarAdmin` nunca lança erro — se o webhook não estiver configurado ou falhar, loga no console e segue (mesmo padrão de `lib/google-meet.ts` quando as credenciais do Google não estão configuradas).
- Nenhum segredo real (chaves, tokens) é commitado em texto puro — tudo em `.env.local` (gitignored) e replicado manualmente no painel da Vercel depois.

---

### Task 1: Colunas novas no banco

**Files:**
- Create: `supabase/migrations/20260720010000_whatsapp_lembretes.sql`

**Interfaces:**
- Produces: coluna `terapeutas.grupo_whatsapp_id` (text, nullable) e colunas `sessoes.lembrete_grupo_vespera_enviado_em` / `lembrete_paciente_vespera_enviado_em` / `lembrete_grupo_30min_enviado_em` / `lembrete_paciente_30min_enviado_em` (todas `timestamptz`, nullable) — usadas por todas as tasks seguintes.

- [ ] **Step 1: Escrever a migration**

```sql
-- supabase/migrations/20260720010000_whatsapp_lembretes.sql

-- Suporte pra automação de lembretes via WhatsApp (n8n + Z-API).
-- grupo_whatsapp_id null = automação desligada pra esse terapeuta até
-- alguém configurar o ID do grupo dele (formato "xxxxxxxxxx-xxxxxxxxxx@g.us").
alter table terapeutas
  add column if not exists grupo_whatsapp_id text;

-- Cada coluna rastreia se aquele tipo específico de lembrete já foi
-- enviado pra aquela sessão — evita mensagem duplicada se o n8n reprocessar
-- ou o cron rodar em cima do horário duas vezes.
alter table sessoes
  add column if not exists lembrete_grupo_vespera_enviado_em timestamptz,
  add column if not exists lembrete_paciente_vespera_enviado_em timestamptz,
  add column if not exists lembrete_grupo_30min_enviado_em timestamptz,
  add column if not exists lembrete_paciente_30min_enviado_em timestamptz;
```

- [ ] **Step 2: Aplicar a migration**

Run: `supabase db push --include-all`
Expected: saída confirmando a migration `20260720010000_whatsapp_lembretes` aplicada, sem erro.

Se aparecer erro de migration history desincronizada (já aconteceu antes neste projeto com versões `20260710`/`20260716`), rodar primeiro:
```bash
supabase migration repair --status reverted <versões conflitantes> --yes
supabase db push --include-all
```

- [ ] **Step 3: Verificar as colunas no banco**

```bash
node -e "
require('dotenv').config({path:'.env.local'});
const {createClient} = require('@supabase/supabase-js');
const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
c.from('terapeutas').select('id,grupo_whatsapp_id').limit(1).then(({error}) => console.log('terapeutas.grupo_whatsapp_id:', error ? 'ERRO: '+error.message : 'ok'));
c.from('sessoes').select('id,lembrete_grupo_vespera_enviado_em,lembrete_paciente_vespera_enviado_em,lembrete_grupo_30min_enviado_em,lembrete_paciente_30min_enviado_em').limit(1).then(({error}) => console.log('sessoes.lembrete_*:', error ? 'ERRO: '+error.message : 'ok'));
"
```
Expected: `terapeutas.grupo_whatsapp_id: ok` e `sessoes.lembrete_*: ok`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260720010000_whatsapp_lembretes.sql
git commit -m "feat: colunas de suporte pra lembretes automáticos via WhatsApp"
```

---

### Task 2: Mecanismo de alerta ao admin

**Files:**
- Create: `lib/notificar-admin.ts`
- Modify: `lib/google-meet.ts:76-79` (catch de `criarEventoComMeet`)

**Interfaces:**
- Consumes: nenhuma (task independente).
- Produces: `notificarAdmin(mensagem: string): Promise<void>` exportado de `lib/notificar-admin.ts` — usado pelo webhook do n8n criado na Task 6, e chamado internamente por `lib/google-meet.ts` a partir desta task.

- [ ] **Step 1: Criar `lib/notificar-admin.ts`**

```ts
// lib/notificar-admin.ts

// Dispara um alerta pro admin via webhook do n8n — o n8n decide quem recebe
// (números configurados só lá dentro) e como formata a mensagem. Sem webhook
// configurado, isso é um no-op silencioso (mesmo padrão de lib/google-meet.ts
// quando as credenciais do Google não estão setadas) — nunca lança erro,
// porque um alerta que falha não pode derrubar o fluxo principal que o chamou.
export async function notificarAdmin(mensagem: string): Promise<void> {
  const url = process.env.N8N_ALERTA_WEBHOOK_URL
  if (!url) return
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mensagem }),
    })
  } catch (err) {
    console.error('[notificar-admin] falha ao chamar webhook:', err)
  }
}
```

- [ ] **Step 2: Adicionar `N8N_ALERTA_WEBHOOK_URL` vazia ao `.env.local`**

A URL real só existe depois da Task 6 (o n8n gera ela ao criar o workflow de webhook). Por enquanto, deixar comentada pra documentar a variável:

```bash
printf '\n# Webhook do n8n pra alertas ao admin — preenchido na Task 6\n# N8N_ALERTA_WEBHOOK_URL=\n' >> .env.local
```

- [ ] **Step 3: Verificar que o no-op funciona sem a variável setada**

```bash
npx tsx -e "
import { notificarAdmin } from './lib/notificar-admin'
notificarAdmin('teste sem webhook configurado').then(() => console.log('OK: não lançou erro'))
"
```
Expected: `OK: não lançou erro` (a env var está comentada/ausente, então a função deve retornar sem tentar nenhum fetch).

- [ ] **Step 4: Verificar que o POST acontece quando a variável está setada**

```bash
npx tsx -e "
process.env.N8N_ALERTA_WEBHOOK_URL = 'https://httpbin.org/post'
import { notificarAdmin } from './lib/notificar-admin'
notificarAdmin('teste com webhook configurado').then(() => console.log('OK: chamou sem lançar erro'))
"
```
Expected: `OK: chamou sem lançar erro` (não precisa validar o corpo da resposta — só confirmar que não lança exceção quando há uma URL real).

- [ ] **Step 5: Chamar `notificarAdmin` no catch de `criarEventoComMeet`**

Editar `lib/google-meet.ts` — adicionar o import no topo:

```ts
import { google } from 'googleapis'
import { notificarAdmin } from './notificar-admin'
```

E trocar o catch de `criarEventoComMeet` (linhas 76-79 hoje):

```ts
  } catch (err) {
    console.error('[google-meet] falha ao criar evento:', err)
    return null
  }
```

por:

```ts
  } catch (err) {
    console.error('[google-meet] falha ao criar evento:', err)
    await notificarAdmin(`Falha ao gerar link do Meet para "${params.titulo}" (início: ${params.inicioISO}). Erro: ${String(err)}`)
    return null
  }
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem saída (sem erros).

- [ ] **Step 7: Commit**

```bash
git add lib/notificar-admin.ts lib/google-meet.ts
git commit -m "feat: mecanismo de alerta ao admin (notificarAdmin) via webhook do n8n"
```

Nota: `.env.local` está no `.gitignore` e não entra no commit — a variável comentada adicionada no Step 2 fica só local.

---

### Task 3: Lib compartilhada + endpoint `pendentes-vespera`

**Files:**
- Create: `lib/whatsapp-pendentes.ts`
- Create: `app/api/whatsapp/pendentes-vespera/route.ts`

**Interfaces:**
- Consumes: colunas `terapeutas.grupo_whatsapp_id`, `sessoes.lembrete_*_enviado_em` (Task 1).
- Produces:
  - `verificarSecretCron(req: Request): boolean` — exportado de `lib/whatsapp-pendentes.ts`, reusado pelas Tasks 4 e 5.
  - `buscarPendentes(client: SupabaseClient, params: { inicio: string; fim: string; colGrupo: 'lembrete_grupo_vespera_enviado_em' | 'lembrete_grupo_30min_enviado_em'; colPaciente: 'lembrete_paciente_vespera_enviado_em' | 'lembrete_paciente_30min_enviado_em' }): Promise<TerapeutaPendente[]>` — exportado de `lib/whatsapp-pendentes.ts`, reusado pela Task 4.
  - Tipo `TerapeutaPendente = { terapeuta_id: string; grupo_whatsapp_id: string; sessoes: SessaoPendenteWhatsapp[] }` e `SessaoPendenteWhatsapp = { sessao_id: string; paciente_nome: string; paciente_telefone: string | null; numero_sessao: number; total_sessoes: number; data_agendada: string; link_meet: string | null; grupo_ja_enviado: boolean; paciente_ja_enviado: boolean }`.
  - Rota `GET /api/whatsapp/pendentes-vespera` — consumida pelo n8n na Task 6.

- [ ] **Step 1: Criar `lib/whatsapp-pendentes.ts`**

```ts
// lib/whatsapp-pendentes.ts
import { SupabaseClient } from '@supabase/supabase-js'

export type SessaoPendenteWhatsapp = {
  sessao_id: string
  paciente_nome: string
  paciente_telefone: string | null
  numero_sessao: number
  total_sessoes: number
  data_agendada: string
  link_meet: string | null
  grupo_ja_enviado: boolean
  paciente_ja_enviado: boolean
}

export type TerapeutaPendente = {
  terapeuta_id: string
  grupo_whatsapp_id: string
  sessoes: SessaoPendenteWhatsapp[]
}

type ColunaGrupo = 'lembrete_grupo_vespera_enviado_em' | 'lembrete_grupo_30min_enviado_em'
type ColunaPaciente = 'lembrete_paciente_vespera_enviado_em' | 'lembrete_paciente_30min_enviado_em'

// Autenticação simples pra chamadas do n8n — não há sessão de usuário aqui,
// só uma chave secreta compartilhada configurada nos dois lados.
export function verificarSecretCron(req: Request): boolean {
  const secret = req.headers.get('x-whatsapp-cron-secret')
  return !!secret && !!process.env.WHATSAPP_CRON_SECRET && secret === process.env.WHATSAPP_CRON_SECRET
}

// Busca sessões agendadas de terapeutas com automação de WhatsApp ligada
// (grupo_whatsapp_id preenchido), dentro da janela de data informada, que
// ainda não tiveram pelo menos um dos dois lembretes daquele tipo enviado.
// Compartilhado entre pendentes-vespera e pendentes-30min — só muda a janela
// de data e quais colunas de controle são checadas.
export async function buscarPendentes(
  client: SupabaseClient,
  params: { inicio: string; fim: string; colGrupo: ColunaGrupo; colPaciente: ColunaPaciente }
): Promise<TerapeutaPendente[]> {
  const { data: terapeutas, error: terapErr } = await client
    .from('terapeutas')
    .select('id,grupo_whatsapp_id')
    .not('grupo_whatsapp_id', 'is', null)
  if (terapErr) throw new Error(terapErr.message)
  if (!terapeutas || terapeutas.length === 0) return []

  const terapeutaIds = terapeutas.map(t => t.id as string)

  const { data: sessoes, error: sessErr } = await client
    .from('sessoes')
    .select(`id,sale_id,terapeuta_id,numero_sessao,total_sessoes,data_agendada,link_meet,paciente_nome,${params.colGrupo},${params.colPaciente}`)
    .eq('status', 'agendada')
    .in('terapeuta_id', terapeutaIds)
    .gte('data_agendada', params.inicio)
    .lte('data_agendada', params.fim)
    .or(`${params.colGrupo}.is.null,${params.colPaciente}.is.null`)
    .order('data_agendada', { ascending: true })
  if (sessErr) throw new Error(sessErr.message)

  type SessaoRow = {
    id: string
    sale_id: string
    terapeuta_id: string
    numero_sessao: number
    total_sessoes: number
    data_agendada: string
    link_meet: string | null
    paciente_nome: string
  } & Record<ColunaGrupo | ColunaPaciente, string | null>

  const linhas = (sessoes ?? []) as unknown as SessaoRow[]

  const saleIds = [...new Set(linhas.map(s => s.sale_id))]
  const telefonePorSale: Record<string, string | null> = {}
  if (saleIds.length > 0) {
    const { data: sales, error: salesErr } = await client.from('sales').select('id,telefone').in('id', saleIds)
    if (salesErr) throw new Error(salesErr.message)
    for (const s of sales ?? []) telefonePorSale[s.id as string] = s.telefone as string | null
  }

  const grupoIdPorTerapeuta: Record<string, string> = {}
  for (const t of terapeutas) grupoIdPorTerapeuta[t.id as string] = t.grupo_whatsapp_id as string

  const porTerapeuta: Record<string, TerapeutaPendente> = {}
  for (const s of linhas) {
    if (!porTerapeuta[s.terapeuta_id]) {
      porTerapeuta[s.terapeuta_id] = {
        terapeuta_id: s.terapeuta_id,
        grupo_whatsapp_id: grupoIdPorTerapeuta[s.terapeuta_id],
        sessoes: [],
      }
    }
    porTerapeuta[s.terapeuta_id].sessoes.push({
      sessao_id: s.id,
      paciente_nome: s.paciente_nome,
      paciente_telefone: telefonePorSale[s.sale_id] ?? null,
      numero_sessao: s.numero_sessao,
      total_sessoes: s.total_sessoes,
      data_agendada: s.data_agendada,
      link_meet: s.link_meet,
      grupo_ja_enviado: !!s[params.colGrupo],
      paciente_ja_enviado: !!s[params.colPaciente],
    })
  }

  return Object.values(porTerapeuta)
}
```

- [ ] **Step 2: Criar a rota `pendentes-vespera`**

```ts
// app/api/whatsapp/pendentes-vespera/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarSecretCron, buscarPendentes } from '@/lib/whatsapp-pendentes'

// Brasília = UTC-3, fixo (sem horário de verão desde 2019). "Amanhã" é
// calculado em cima da data de Brasília, não da data UTC do servidor.
function brasiliaAmanhaRangeUTC(): { inicio: string; fim: string } {
  const now = new Date()
  const br = new Date(now.getTime() - 3 * 60 * 60 * 1000)
  const amanha = new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate() + 1))
  const inicio = new Date(Date.UTC(amanha.getUTCFullYear(), amanha.getUTCMonth(), amanha.getUTCDate(), 3, 0, 0))
  const fim = new Date(Date.UTC(amanha.getUTCFullYear(), amanha.getUTCMonth(), amanha.getUTCDate() + 1, 2, 59, 59))
  return { inicio: inicio.toISOString(), fim: fim.toISOString() }
}

export async function GET(req: NextRequest) {
  if (!verificarSecretCron(req)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  const { inicio, fim } = brasiliaAmanhaRangeUTC()
  try {
    const terapeutas = await buscarPendentes(getSupabaseAdmin(), {
      inicio, fim,
      colGrupo: 'lembrete_grupo_vespera_enviado_em',
      colPaciente: 'lembrete_paciente_vespera_enviado_em',
    })
    return NextResponse.json({ terapeutas })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
```

- [ ] **Step 3: Gerar e adicionar `WHATSAPP_CRON_SECRET` ao `.env.local`**

```bash
SECRET=$(openssl rand -hex 32)
printf "\nWHATSAPP_CRON_SECRET=%s\n" "$SECRET" >> .env.local
echo "Guarde esse valor — vai ser usado nos headers do n8n na Task 6: $SECRET"
```

- [ ] **Step 4: Verificar o 401 sem a chave certa**

Com o servidor local rodando (`npm run dev` em outro terminal):

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/whatsapp/pendentes-vespera
curl -s -o /dev/null -w "%{http_code}\n" -H "x-whatsapp-cron-secret: chave-errada" http://localhost:3000/api/whatsapp/pendentes-vespera
```
Expected: `401` nas duas chamadas.

- [ ] **Step 5: Verificar a resposta com a chave certa**

```bash
source .env.local
curl -s -H "x-whatsapp-cron-secret: $WHATSAPP_CRON_SECRET" http://localhost:3000/api/whatsapp/pendentes-vespera | node -e "
let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>console.log(JSON.stringify(JSON.parse(d),null,2)))
"
```
Expected: `200` com `{"terapeutas":[]}` (vazio é esperado — nenhum terapeuta tem `grupo_whatsapp_id` configurado ainda nesse ponto do desenvolvimento). Se algum terapeuta de teste tiver `grupo_whatsapp_id` setado manualmente, a lista deve vir preenchida com o formato documentado na spec.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem saída.

- [ ] **Step 7: Commit**

```bash
git add lib/whatsapp-pendentes.ts app/api/whatsapp/pendentes-vespera
git commit -m "feat: endpoint GET /api/whatsapp/pendentes-vespera"
```

---

### Task 4: Endpoint `pendentes-30min`

**Files:**
- Create: `app/api/whatsapp/pendentes-30min/route.ts`

**Interfaces:**
- Consumes: `verificarSecretCron` e `buscarPendentes` de `lib/whatsapp-pendentes.ts` (Task 3).
- Produces: rota `GET /api/whatsapp/pendentes-30min` — consumida pelo n8n na Task 6.

- [ ] **Step 1: Criar a rota**

```ts
// app/api/whatsapp/pendentes-30min/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarSecretCron, buscarPendentes } from '@/lib/whatsapp-pendentes'

export async function GET(req: NextRequest) {
  if (!verificarSecretCron(req)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }
  const agora = new Date()
  const emTrintaMin = new Date(agora.getTime() + 30 * 60 * 1000)
  try {
    const terapeutas = await buscarPendentes(getSupabaseAdmin(), {
      inicio: agora.toISOString(),
      fim: emTrintaMin.toISOString(),
      colGrupo: 'lembrete_grupo_30min_enviado_em',
      colPaciente: 'lembrete_paciente_30min_enviado_em',
    })
    return NextResponse.json({ terapeutas })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verificar 401 e 200**

Com `npm run dev` rodando:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/whatsapp/pendentes-30min
source .env.local
curl -s -H "x-whatsapp-cron-secret: $WHATSAPP_CRON_SECRET" http://localhost:3000/api/whatsapp/pendentes-30min
```
Expected: primeira chamada `401`; segunda chamada `200` com `{"terapeutas":[]}` (ou preenchido, se houver sessão de teste começando nos próximos 30 min com terapeuta configurado).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem saída.

- [ ] **Step 4: Commit**

```bash
git add app/api/whatsapp/pendentes-30min
git commit -m "feat: endpoint GET /api/whatsapp/pendentes-30min"
```

---

### Task 5: Endpoint `marcar-enviado`

**Files:**
- Create: `app/api/whatsapp/marcar-enviado/route.ts`

**Interfaces:**
- Consumes: `verificarSecretCron` de `lib/whatsapp-pendentes.ts` (Task 3); colunas `sessoes.lembrete_*_enviado_em` (Task 1).
- Produces: rota `POST /api/whatsapp/marcar-enviado` — consumida pelo n8n na Task 6, depois de cada envio bem-sucedido.

- [ ] **Step 1: Criar a rota**

```ts
// app/api/whatsapp/marcar-enviado/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { verificarSecretCron } from '@/lib/whatsapp-pendentes'

const COLUNA_POR_TIPO = {
  grupo_vespera: 'lembrete_grupo_vespera_enviado_em',
  paciente_vespera: 'lembrete_paciente_vespera_enviado_em',
  grupo_30min: 'lembrete_grupo_30min_enviado_em',
  paciente_30min: 'lembrete_paciente_30min_enviado_em',
} as const

type Tipo = keyof typeof COLUNA_POR_TIPO

export async function POST(req: NextRequest) {
  if (!verificarSecretCron(req)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const { sessao_id, tipo } = body as { sessao_id?: string; tipo?: string }
  if (!sessao_id || !tipo || !(tipo in COLUNA_POR_TIPO)) {
    return NextResponse.json(
      { error: 'sessao_id e tipo (grupo_vespera|paciente_vespera|grupo_30min|paciente_30min) são obrigatórios' },
      { status: 400 }
    )
  }

  const coluna = COLUNA_POR_TIPO[tipo as Tipo]
  const { error } = await getSupabaseAdmin()
    .from('sessoes')
    .update({ [coluna]: new Date().toISOString() })
    .eq('id', sessao_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
```

- [ ] **Step 2: Verificar validação de entrada**

Com `npm run dev` rodando:

```bash
source .env.local
curl -s -w "\n%{http_code}\n" -X POST -H "x-whatsapp-cron-secret: $WHATSAPP_CRON_SECRET" -H "Content-Type: application/json" -d '{}' http://localhost:3000/api/whatsapp/marcar-enviado
```
Expected: `400` com mensagem de erro sobre campos obrigatórios.

- [ ] **Step 3: Verificar marcação real numa sessão de teste**

```bash
node -e "
require('dotenv').config({path:'.env.local'});
const {createClient} = require('@supabase/supabase-js');
const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
c.from('sessoes').select('id').eq('status','agendada').limit(1).single().then(({data,error}) => {
  if (error) return console.error(error);
  console.log('SESSAO_ID='+data.id);
});
"
```
Copiar o `SESSAO_ID` impresso e rodar:

```bash
source .env.local
curl -s -w "\n%{http_code}\n" -X POST \
  -H "x-whatsapp-cron-secret: $WHATSAPP_CRON_SECRET" -H "Content-Type: application/json" \
  -d '{"sessao_id":"<SESSAO_ID>","tipo":"grupo_vespera"}' \
  http://localhost:3000/api/whatsapp/marcar-enviado
```
Expected: `200` com `{"success":true}`. Depois, confirmar no banco:

```bash
node -e "
require('dotenv').config({path:'.env.local'});
const {createClient} = require('@supabase/supabase-js');
const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
c.from('sessoes').select('lembrete_grupo_vespera_enviado_em').eq('id','<SESSAO_ID>').single().then(({data}) => console.log(data));
"
```
Expected: `lembrete_grupo_vespera_enviado_em` com um timestamp recente, não `null`.

**Importante:** depois de testar, resetar a coluna pra não deixar dado de teste sujando a sessão real:
```bash
node -e "
require('dotenv').config({path:'.env.local'});
const {createClient} = require('@supabase/supabase-js');
const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
c.from('sessoes').update({lembrete_grupo_vespera_enviado_em: null}).eq('id','<SESSAO_ID>').then(() => console.log('resetado'));
"
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem saída.

- [ ] **Step 5: Commit**

```bash
git add app/api/whatsapp/marcar-enviado
git commit -m "feat: endpoint POST /api/whatsapp/marcar-enviado"
```

---

### Task 6: Workflows no n8n (BLOQUEADA — precisa de credenciais externas)

**Não dispachar como subagent normal.** Esta task depende de informações que só existem fora do repositório e que o controlador (sessão principal) precisa coletar do usuário ANTES de começar — um subagent isolado não consegue pedir isso sozinho de forma confiável. Reunir tudo abaixo primeiro, com o usuário, então executar (diretamente ou via subagent com os valores já em mãos):

- API key do n8n + URL base da instância (ex.: `https://n8n.seudominio.com`) — **ainda não recebida** (usuário disse "eu te mando a chave" mas não mandou até o momento em que este plano foi escrito).
- Credenciais da Z-API: `instance ID` e `token` (a conta ainda precisa ser criada e o número dedicado pareado via QR code).
- Os 2 IDs de grupo do WhatsApp (`grupo_whatsapp_id`) — de "Info - Agendamentos" (Pedro) e "Info - Agendamentos - Denise" (Denise). Formato `xxxxxxxxxx-xxxxxxxxxx@g.us`. A Z-API tem endpoint pra listar os grupos que o número conectado participa — usar isso pra descobrir o ID de cada um.
- Os 2 números de telefone do admin que recebem alerta (formato `55DDDNNNNNNNNN`, mesmo padrão já usado em `sales.telefone`).
- O valor gerado de `WHATSAPP_CRON_SECRET` (Task 3, Step 3).
- A URL base do app em produção (`https://spr-digital.vercel.app`) — os workflows do n8n vão chamar os endpoints de lá, não do localhost.
- Confirmar se a mensagem de suporte pro paciente (texto extra combinado na spec) já tem número definido, ou se fica sem essa linha por enquanto.

**Files:**
- Nenhum arquivo no repositório — esta task só cria workflows via chamadas HTTP à API REST do n8n (`POST {N8N_BASE_URL}/api/v1/workflows`, header `X-N8N-API-KEY: <chave>`).

**Interfaces:**
- Consumes: `GET /api/whatsapp/pendentes-vespera` (Task 3), `GET /api/whatsapp/pendentes-30min` (Task 4), `POST /api/whatsapp/marcar-enviado` (Task 5), webhook gerado pelo próprio workflow de alerta (consumido por `notificarAdmin`, Task 2).
- Produces: 2 workflows agendados + 1 workflow de webhook, rodando na instância de n8n do usuário. Nenhuma interface de código — o "contrato" são os 3 endpoints já existentes.

- [ ] **Step 1: Criar o workflow de alerta (webhook)**

Estrutura do workflow (nós e conexões) a criar via `POST {N8N_BASE_URL}/api/v1/workflows`:
- Nó **Webhook** (trigger): método POST, path `spr-alerta-admin`, modo de resposta "Immediately".
- Nó **HTTP Request**: para a Z-API, mandando a mensagem recebida (`{{$json.body.mensagem}}`) pros 2 números do admin — um nó de HTTP Request por número (ou um nó com loop sobre uma lista fixa dos 2 números).

Depois de criado e **ativado**, o n8n expõe uma URL de produção do tipo `{N8N_BASE_URL}/webhook/spr-alerta-admin` — copiar essa URL.

- [ ] **Step 2: Configurar `N8N_ALERTA_WEBHOOK_URL` em `.env.local` e na Vercel**

```bash
# substituir pela URL real copiada no Step 1
sed -i '' 's|# N8N_ALERTA_WEBHOOK_URL=|N8N_ALERTA_WEBHOOK_URL=<url-real>|' .env.local
```

Adicionar a mesma variável em Vercel → Settings → Environment Variables (`N8N_ALERTA_WEBHOOK_URL`, mesmo valor), e disparar um novo deploy (`git commit --allow-empty -m "chore: trigger deploy" && git push`) pra pegar a env var nova — funções serverless já em execução não veem env vars adicionadas depois do build.

- [ ] **Step 3: Testar o alerta ponta a ponta**

```bash
source .env.local
npx tsx -e "
import { notificarAdmin } from './lib/notificar-admin'
notificarAdmin('Teste manual do alerta — ignorar').then(() => console.log('enviado'))
"
```
Expected: mensagem "Teste manual do alerta — ignorar" chega nos 2 números do admin no WhatsApp.

- [ ] **Step 4: Criar o workflow "Lembrete véspera"**

Estrutura do workflow via `POST {N8N_BASE_URL}/api/v1/workflows`:
- Nó **Schedule Trigger**: todo dia, 21:30, timezone `America/Sao_Paulo`.
- Nó **HTTP Request** (`GET {APP_BASE_URL}/api/whatsapp/pendentes-vespera`, header `x-whatsapp-cron-secret: <WHATSAPP_CRON_SECRET>`).
- Nó **Split/Loop** sobre `terapeutas[]` retornado.
- Por terapeuta: montar o texto do resumo (nome, telefone formatado, "sessão X/Y", horário em Brasília, link) juntando todas as `sessoes[]` → **HTTP Request** pra Z-API mandando pro `grupo_whatsapp_id` → em sucesso, **HTTP Request** (`POST {APP_BASE_URL}/api/whatsapp/marcar-enviado`, `{sessao_id, tipo: "grupo_vespera"}`) pra cada sessão incluída no resumo → em erro, **HTTP Request** pro webhook de alerta (Step 1) com o erro da Z-API.
- Sub-loop sobre `sessoes[]` com `paciente_telefone` não nulo: montar mensagem individual → **HTTP Request** Z-API pro telefone do paciente → sucesso marca `paciente_vespera` enviado, erro dispara alerta.

- [ ] **Step 5: Criar o workflow "Lembrete 30 minutos"**

Mesma estrutura do Step 4, mudando:
- **Schedule Trigger**: a cada 5 minutos.
- Endpoint: `GET {APP_BASE_URL}/api/whatsapp/pendentes-30min`.
- Tipos marcados: `grupo_30min` / `paciente_30min`.

- [ ] **Step 6: Ativar os dois workflows**

Via API: `PATCH {N8N_BASE_URL}/api/v1/workflows/{id}` com `{"active": true}` pra cada um dos 2 workflows.

- [ ] **Step 7: Teste end-to-end com dado real**

Criar (ou usar) uma venda de teste com sessão agendada pra "amanhã" (dentro da janela de véspera) num terapeuta com `grupo_whatsapp_id` configurado, disparar manualmente o workflow "Lembrete véspera" pelo painel do n8n (execução manual, sem esperar o horário), e confirmar:
1. A mensagem de resumo chegou no grupo certo.
2. A mensagem individual chegou no número de teste.
3. As colunas `lembrete_grupo_vespera_enviado_em` / `lembrete_paciente_vespera_enviado_em` da sessão de teste foram preenchidas.
4. Rodando o workflow de novo imediatamente, nenhuma mensagem duplicada é enviada (a sessão já não aparece mais em `pendentes-vespera`).

Repetir o mesmo teste pro workflow "Lembrete 30 minutos" com uma sessão de teste marcada pra daqui a alguns minutos.

- [ ] **Step 8: Reportar ao usuário**

Sem commit nesta task (nada no repositório muda) — reportar diretamente: quais workflows foram criados, os 2 IDs de grupo configurados em qual terapeuta, e confirmação dos testes end-to-end do Step 7.
