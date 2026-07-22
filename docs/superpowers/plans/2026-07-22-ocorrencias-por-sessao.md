# Ocorrências por Sessão + Orientação da Sessão no WhatsApp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ligar ocorrências do prontuário a uma sessão específica (não só à venda), reorganizar a tela por sessão, e criar um novo tipo "Orientação da Sessão" que entra automaticamente no lembrete de WhatsApp de 30 minutos.

**Architecture:** Coluna nova `sessao_id` em `ocorrencias_prontuario` (nullable). Endpoint existente `app/api/terapeutas/vendas/route.ts` ganha validação/regra pro novo tipo `orientacao_sessao` no POST e um PUT novo pra editar. A tela `app/terapeutas/[id]/page.tsx` reorganiza a lista por sessão e ganha um 4º formulário de ocorrência. O cron de 30min (`lib/whatsapp-pendentes.ts` + `app/api/whatsapp/pendentes-30min/route.ts`) passa a incluir o texto da orientação no payload que já envia pro n8n; o workflow do n8n (sistema externo, não versionado no git) é atualizado por último pra usar esse campo novo.

**Tech Stack:** Next.js 16 (App Router) + React 19 + Supabase (Postgres + PostgREST) + n8n (self-hosted, API REST) + Z-API (WhatsApp).

## Global Constraints

- Projeto Supabase linkado: `jgpgvskrpjoplcocptdy` — `supabase db push` aplica migrations direto, sem precisar trocar de projeto.
- Sem framework de teste no repo (sem Jest/Vitest). Verificação em todas as tasks segue o padrão já usado neste projeto: `npx tsc --noEmit` pra tipos, e scripts `node -e '...'` batendo direto no Supabase REST (usando `SUPABASE_SERVICE_ROLE_KEY` de `.env.local`) pra verificar dados. Não introduza um test runner novo.
- Prazo mínimo pra registrar/editar uma Orientação da Sessão: **40 minutos** antes do `data_agendada` da sessão. Bloqueia com erro, não deixa salvar.
- Só pode existir **uma** ocorrência `tipo = 'orientacao_sessao'` por `sessao_id`. Segunda tentativa de criar é erro — o front direciona pra edição.
- Título da Orientação da Sessão é sempre fixo: `ORIENTAÇÃO DA SESSÃO:` — nunca digitado pelo usuário, sempre definido no servidor.
- A orientação só entra no lembrete de **30 minutos**, nunca no de véspera.
- Quando entra no lembrete de 30min, vai tanto na mensagem do grupo do terapeuta quanto na mensagem privada do paciente (quando houver telefone), sempre ao final da mensagem.
- Regra "nunca mexer em workflow/credencial pré-existente do n8n" continua valendo pra qualquer coisa que não foi criada por este projeto — mas o workflow "SPR Digital - Lembrete 30 Minutos" **foi criado por este projeto** (task anterior), então editá-lo é esperado e seguro.

---

### Task 1: Migration — coluna `sessao_id` em `ocorrencias_prontuario`

**Files:**
- Create: `supabase/migrations/20260722000000_ocorrencias_sessao_id.sql`

**Interfaces:**
- Produces: coluna `ocorrencias_prontuario.sessao_id uuid references sessoes(id)` (nullable), consultável via PostgREST. Tasks 2, 3, 4, 5, 6, 7 dependem dela existir.

- [ ] **Step 1: Escrever a migration**

```sql
-- supabase/migrations/20260722000000_ocorrencias_sessao_id.sql
alter table ocorrencias_prontuario
  add column sessao_id uuid references sessoes(id);

create index if not exists idx_ocorrencias_prontuario_sessao_id
  on ocorrencias_prontuario(sessao_id);
```

- [ ] **Step 2: Aplicar a migration no banco**

Run: `cd "/Users/rafael/Desktop/CLAUDE CODE - PROJETO DASBOARADS/DRE FINANCEIRO SPR DIGITAL" && supabase db push`

Expected: output confirma a migration `20260722000000_ocorrencias_sessao_id.sql` aplicada, sem erro.

- [ ] **Step 3: Verificar que a coluna existe e é consultável via PostgREST**

Run:
```bash
cd "/Users/rafael/Desktop/CLAUDE CODE - PROJETO DASBOARADS/DRE FINANCEIRO SPR DIGITAL" && node -e '
require("dotenv").config({path:".env.local"})
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
fetch(url + "/rest/v1/ocorrencias_prontuario?select=id,sessao_id&limit=1", {
  headers: { apikey: key, Authorization: "Bearer " + key }
}).then(r => r.json()).then(d => console.log(JSON.stringify(d)))
'
```

Expected: um array JSON (mesmo que vazio ou com 1 item), **não** um erro `column ocorrencias_prontuario.sessao_id does not exist` (código `42703`). Se der esse erro logo após o push, espere ~10s (PostgREST recarrega o schema cache periodicamente) e rode de novo.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260722000000_ocorrencias_sessao_id.sql
git commit -m "feat: adiciona sessao_id em ocorrencias_prontuario"
```

---

### Task 2: API — POST cria "Orientação da Sessão" + grava `sessao_id` em todo tipo

**Files:**
- Modify: `app/api/terapeutas/vendas/route.ts` (POST, linhas 266-368 hoje)
- Modify: `app/api/terapeutas/sessoes/remarcar/route.ts` (linhas 107-116 hoje)

**Interfaces:**
- Consumes: coluna `sessao_id` de Task 1.
- Produces: POST `/api/terapeutas/vendas` aceita `sessao_id?: string` no corpo (top-level, além do já existente `dados_extras`). Quando `tipo === 'orientacao_sessao'`: exige `sessao_id`, valida 40min de antecedência, valida unicidade, força `titulo`. Task 3 (PUT) e Task 5 (front-end) dependem dessas mesmas regras/mensagens de erro.

- [ ] **Step 1: Adicionar `sessao_id` ao tipo do corpo e à desestruturação**

Em `app/api/terapeutas/vendas/route.ts`, dentro de `export async function POST`, troque:

```ts
    const body = await req.json() as {
      sale_id: string
      tipo: string
      titulo: string
      descricao: string
      dados_extras?: Record<string, unknown>
      senha: string
      usuario_nome: string
      usuario_tipo: string
      usuario_email: string
    }
    const { sale_id, tipo, titulo, descricao, dados_extras, senha, usuario_nome, usuario_tipo, usuario_email } = body
```

por:

```ts
    const body = await req.json() as {
      sale_id: string
      tipo: string
      titulo: string
      descricao: string
      sessao_id?: string
      dados_extras?: Record<string, unknown>
      senha: string
      usuario_nome: string
      usuario_tipo: string
      usuario_email: string
    }
    const { sale_id, tipo, titulo, descricao, sessao_id, dados_extras, senha, usuario_nome, usuario_tipo, usuario_email } = body
```

- [ ] **Step 2: Adicionar a validação do tipo `orientacao_sessao`**

Logo depois do bloco `if (tipo === 'solicitacao_reembolso' && dados_extras) { ... }` (antes do insert final em `ocorrencias_prontuario`), adicione:

```ts
    if (tipo === 'orientacao_sessao') {
      if (!sessao_id) {
        return NextResponse.json({ error: 'Selecione a sessão' }, { status: 400 })
      }

      const { data: sessaoRow, error: sessaoErr } = await supabase
        .from('sessoes').select('id,data_agendada').eq('id', sessao_id).single()
      if (sessaoErr || !sessaoRow) {
        return NextResponse.json({ error: 'Sessão não encontrada' }, { status: 404 })
      }

      if (sessaoRow.data_agendada) {
        const faltamMs = new Date(sessaoRow.data_agendada).getTime() - Date.now()
        if (faltamMs < 40 * 60 * 1000) {
          return NextResponse.json(
            { error: 'Faltam menos de 40 minutos para a sessão — não dá mais tempo de entrar no lembrete automático.' },
            { status: 400 }
          )
        }
      }

      const { data: existente } = await supabase
        .from('ocorrencias_prontuario')
        .select('id')
        .eq('sessao_id', sessao_id)
        .eq('tipo', 'orientacao_sessao')
        .maybeSingle()
      if (existente) {
        return NextResponse.json(
          { error: 'Já existe uma orientação registrada para essa sessão — edite a existente em vez de criar outra.' },
          { status: 409 }
        )
      }
    }
```

- [ ] **Step 3: Gravar `sessao_id` e forçar o título no insert final**

Troque o insert final:

```ts
    const { data: ocorrencia, error: ocErr } = await supabase
      .from('ocorrencias_prontuario')
      .insert({
        sale_id,
        tipo,
        titulo,
        descricao,
        dados_extras: dados_extras ?? null,
        criado_por_nome: usuario_nome,
        criado_por_tipo: usuario_tipo,
        criado_por_email: usuario_email,
      })
      .select()
      .single()
```

por:

```ts
    const { data: ocorrencia, error: ocErr } = await supabase
      .from('ocorrencias_prontuario')
      .insert({
        sale_id,
        // Cai pro sessao_id de dentro de dados_extras quando o chamador só
        // preenche lá (ex: fluxo antigo de remarcação) — mantém a coluna nova
        // sempre preenchida sem precisar mudar todo caller hoje.
        sessao_id: sessao_id ?? (dados_extras?.sessao_id as string | undefined) ?? null,
        tipo,
        titulo: tipo === 'orientacao_sessao' ? 'ORIENTAÇÃO DA SESSÃO:' : titulo,
        descricao,
        dados_extras: dados_extras ?? null,
        criado_por_nome: usuario_nome,
        criado_por_tipo: usuario_tipo,
        criado_por_email: usuario_email,
      })
      .select()
      .single()
```

- [ ] **Step 4: Gravar `sessao_id` também no insert de `/api/terapeutas/sessoes/remarcar`**

Em `app/api/terapeutas/sessoes/remarcar/route.ts`, troque:

```ts
  await client.from('ocorrencias_prontuario').insert({
    sale_id: sessao.sale_id,
    tipo: 'remarcacao',
    titulo: `Remarcação — Sessão ${sessao.numero_sessao}`,
    descricao: descricaoCompleta,
    dados_extras: { sessao_id, motivo: motivo ?? null, solicitado_por: solicitado_por ?? null, data_anterior: sessao.data_agendada, nova_data: novaDataISO },
    criado_por_nome: usuarioNome,
    criado_por_tipo: usuarioTipo,
    criado_por_email: usuario_email,
  })
```

por:

```ts
  await client.from('ocorrencias_prontuario').insert({
    sale_id: sessao.sale_id,
    sessao_id,
    tipo: 'remarcacao',
    titulo: `Remarcação — Sessão ${sessao.numero_sessao}`,
    descricao: descricaoCompleta,
    dados_extras: { sessao_id, motivo: motivo ?? null, solicitado_por: solicitado_por ?? null, data_anterior: sessao.data_agendada, nova_data: novaDataISO },
    criado_por_nome: usuarioNome,
    criado_por_tipo: usuarioTipo,
    criado_por_email: usuario_email,
  })
```

- [ ] **Step 5: Typecheck**

Run: `cd "/Users/rafael/Desktop/CLAUDE CODE - PROJETO DASBOARADS/DRE FINANCEIRO SPR DIGITAL" && npx tsc --noEmit`
Expected: sem output (sem erros).

- [ ] **Step 6: Verificar as regras manualmente contra o banco real**

Pegue uma sessão futura real (status `agendada`, `data_agendada` daqui a mais de 40min) pra testar. Substitua `SESSAO_ID_TESTE` abaixo por um id real (pode pegar com
`node -e '...sessoes?status=eq.agendada&order=data_agendada.asc&limit=5...'` se precisar).

```bash
cd "/Users/rafael/Desktop/CLAUDE CODE - PROJETO DASBOARADS/DRE FINANCEIRO SPR DIGITAL" && npm run dev &
sleep 3
curl -s -X POST http://localhost:3000/api/terapeutas/vendas \
  -H 'Content-Type: application/json' \
  -d '{"sale_id":"SALE_ID_TESTE","tipo":"orientacao_sessao","sessao_id":"SESSAO_ID_TESTE","titulo":"ignorado","descricao":"Teste de orientação — pode apagar","senha":"SENHA_REAL","usuario_nome":"Teste","usuario_tipo":"admin","usuario_email":"rafael@spr.com"}'
```

Expected: `{"success":true,"ocorrencia":{... "titulo":"ORIENTAÇÃO DA SESSÃO:", "sessao_id":"SESSAO_ID_TESTE", ...}}`. Repetir a mesma chamada de novo deve retornar `409` com a mensagem de duplicidade. Depois de confirmar, apague a ocorrência de teste:

```bash
node -e '
require("dotenv").config({path:".env.local"})
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
fetch(url + "/rest/v1/ocorrencias_prontuario?descricao=eq." + encodeURIComponent("Teste de orientação — pode apagar"), {
  method: "DELETE", headers: { apikey: key, Authorization: "Bearer " + key }
}).then(r => console.log(r.status))
'
```

- [ ] **Step 7: Commit**

```bash
git add app/api/terapeutas/vendas/route.ts app/api/terapeutas/sessoes/remarcar/route.ts
git commit -m "feat: valida e cria ocorrência do tipo orientacao_sessao"
```

---

### Task 3: API — PUT edita "Orientação da Sessão"

**Files:**
- Modify: `app/api/terapeutas/vendas/route.ts` (adicionar `export async function PUT` no final do arquivo)

**Interfaces:**
- Consumes: mesma regra de 40min de Task 2, mesmas colunas.
- Produces: `PUT /api/terapeutas/vendas` com corpo `{ id, descricao, senha, usuario_nome, usuario_tipo, usuario_email }` — edita `descricao` de uma ocorrência existente, só se `tipo === 'orientacao_sessao'`. Task 5 (front-end) chama esse endpoint pro fluxo de edição.

- [ ] **Step 1: Adicionar o handler PUT**

No final de `app/api/terapeutas/vendas/route.ts` (depois do `export async function POST`), adicione:

```ts

// ─── PUT — editar ocorrência do tipo orientacao_sessao ────────────────────────
// Único tipo editável — os demais (nota, remarcação, reembolso) continuam
// sendo histórico imutável, só inserção.
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as {
      id: string
      descricao: string
      senha: string
      usuario_nome: string
      usuario_tipo: string
      usuario_email: string
    }
    const { id, descricao, senha, usuario_nome, usuario_tipo, usuario_email } = body

    const { valido } = await verificarSenhaUsuario(usuario_email, senha)
    if (!valido) return NextResponse.json({ error: 'Senha incorreta' }, { status: 401 })

    const supabase = getSupabaseAdmin()

    const { data: existente, error: fetchErr } = await supabase
      .from('ocorrencias_prontuario').select('id,tipo,sessao_id').eq('id', id).single()
    if (fetchErr || !existente) {
      return NextResponse.json({ error: 'Ocorrência não encontrada' }, { status: 404 })
    }
    if (existente.tipo !== 'orientacao_sessao') {
      return NextResponse.json({ error: 'Esse tipo de ocorrência não pode ser editado' }, { status: 400 })
    }

    if (existente.sessao_id) {
      const { data: sessaoRow } = await supabase
        .from('sessoes').select('data_agendada').eq('id', existente.sessao_id).single()
      if (sessaoRow?.data_agendada) {
        const faltamMs = new Date(sessaoRow.data_agendada).getTime() - Date.now()
        if (faltamMs < 40 * 60 * 1000) {
          return NextResponse.json(
            { error: 'Faltam menos de 40 minutos para a sessão — não é mais possível editar a orientação.' },
            { status: 400 }
          )
        }
      }
    }

    const { data: ocorrencia, error: updErr } = await supabase
      .from('ocorrencias_prontuario')
      .update({ titulo: 'ORIENTAÇÃO DA SESSÃO:', descricao })
      .eq('id', id)
      .select()
      .single()
    if (updErr) throw new Error(updErr.message)

    await registrarAtividade({
      usuario_nome,
      usuario_tipo,
      tipo_acao: 'orientacao_sessao_editada',
      sessao_id: existente.sessao_id ?? undefined,
      descricao,
    })

    return NextResponse.json({ success: true, ocorrencia })
  } catch (err) {
    console.error('[terapeutas/vendas PUT]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Verificar manualmente**

Reaproveite a ocorrência de teste criada no Step 6 da Task 2 (ou crie uma nova do mesmo jeito) e edite:

```bash
curl -s -X PUT http://localhost:3000/api/terapeutas/vendas \
  -H 'Content-Type: application/json' \
  -d '{"id":"ID_DA_OCORRENCIA","descricao":"Teste editado — pode apagar","senha":"SENHA_REAL","usuario_nome":"Teste","usuario_tipo":"admin","usuario_email":"rafael@spr.com"}'
```

Expected: `{"success":true,"ocorrencia":{... "descricao":"Teste editado — pode apagar" ...}}`. Depois apague a ocorrência de teste (mesmo script DELETE da Task 2).

- [ ] **Step 4: Commit**

```bash
git add app/api/terapeutas/vendas/route.ts
git commit -m "feat: permite editar ocorrência orientacao_sessao"
```

---

### Task 4: Front-end — tipos, metadados e seletor opcional de sessão na Nota

**Files:**
- Modify: `app/terapeutas/[id]/page.tsx`

**Interfaces:**
- Consumes: coluna `sessao_id` (Task 1), endpoint POST de Task 2.
- Produces: `Ocorrencia.sessao_id`, `OCORRENCIA_META.orientacao_sessao`, estado `notaSessaoId`. Tasks 5 e 6 dependem desses tipos/estado.

- [ ] **Step 1: Adicionar `sessao_id` ao tipo `Ocorrencia`**

Troque (linha 71):

```ts
type Ocorrencia = {
  id: string
  sale_id: string
  tipo: string
  titulo: string
  descricao: string
  criado_por_nome: string
  criado_por_tipo: string
  created_at: string
}
```

por:

```ts
type Ocorrencia = {
  id: string
  sale_id: string
  sessao_id: string | null
  tipo: string
  titulo: string
  descricao: string
  criado_por_nome: string
  criado_por_tipo: string
  created_at: string
}
```

- [ ] **Step 2: Adicionar entrada no `OCORRENCIA_META`**

Troque (linha 256-263):

```ts
const OCORRENCIA_META: Record<string, { icon: string; label: string; cls: string }> = {
  nota:                  { icon: '📝', label: 'Nota',                    cls: 'text-gray-400 bg-gray-400/10 border-gray-400/20' },
  remarcacao:            { icon: '📅', label: 'Remarcação',              cls: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20' },
  confirmacao_entrega:   { icon: '✅', label: 'Sessão Entregue',         cls: 'text-green-500 bg-green-500/10 border-green-500/20' },
  solicitacao_reembolso: { icon: '💰', label: 'Solicitação de Reembolso', cls: 'text-orange-400 bg-orange-400/10 border-orange-400/20' },
  reembolso_aprovado:    { icon: '✅', label: 'Reembolso Aprovado',      cls: 'text-green-500 bg-green-500/10 border-green-500/20' },
  reembolso_rejeitado:   { icon: '❌', label: 'Reembolso Rejeitado',     cls: 'text-red-400 bg-red-400/10 border-red-400/20' },
}
```

por:

```ts
const OCORRENCIA_META: Record<string, { icon: string; label: string; cls: string }> = {
  nota:                  { icon: '📝', label: 'Nota',                    cls: 'text-gray-400 bg-gray-400/10 border-gray-400/20' },
  remarcacao:            { icon: '📅', label: 'Remarcação',              cls: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20' },
  confirmacao_entrega:   { icon: '✅', label: 'Sessão Entregue',         cls: 'text-green-500 bg-green-500/10 border-green-500/20' },
  solicitacao_reembolso: { icon: '💰', label: 'Solicitação de Reembolso', cls: 'text-orange-400 bg-orange-400/10 border-orange-400/20' },
  reembolso_aprovado:    { icon: '✅', label: 'Reembolso Aprovado',      cls: 'text-green-500 bg-green-500/10 border-green-500/20' },
  reembolso_rejeitado:   { icon: '❌', label: 'Reembolso Rejeitado',     cls: 'text-red-400 bg-red-400/10 border-red-400/20' },
  orientacao_sessao:     { icon: '📣', label: 'Orientação da Sessão',    cls: 'text-blue-400 bg-blue-400/10 border-blue-400/20' },
}
```

- [ ] **Step 3: Selecionar `sessao_id` no `loadData()`**

Troque (linha 487):

```ts
        client.from('ocorrencias_prontuario').select('id,sale_id,tipo,titulo,descricao,criado_por_nome,criado_por_tipo,created_at').in('sale_id', saleIdsVisiveis).order('created_at', { ascending: false }),
```

por:

```ts
        client.from('ocorrencias_prontuario').select('id,sale_id,sessao_id,tipo,titulo,descricao,criado_por_nome,criado_por_tipo,created_at').in('sale_id', saleIdsVisiveis).order('created_at', { ascending: false }),
```

- [ ] **Step 4: Adicionar estado `notaSessaoId` (seletor opcional na Nota)**

Logo depois de (linha 426):

```ts
  const [notaSenhaOpen, setNotaSenhaOpen] = useState(false)
```

adicione:

```ts
  const [notaSessaoId, setNotaSessaoId] = useState('')
```

- [ ] **Step 5: Adicionar o seletor de sessão (opcional) no formulário de Nota**

No formulário de Nota (linhas 1958-1989), logo depois do campo Título e antes do campo Descrição, adicione um seletor. Troque:

```tsx
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Título <span className="text-red-400">*</span></label>
                      <input type="text" value={notaTitulo} onChange={e => setNotaTitulo(e.target.value)} maxLength={100}
                        placeholder="Ex: Observação após sessão 2..."
                        className="w-full bg-gray-700 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Descrição <span className="text-red-400">*</span> (mín. 10 caracteres)</label>
```

por:

```tsx
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Título <span className="text-red-400">*</span></label>
                      <input type="text" value={notaTitulo} onChange={e => setNotaTitulo(e.target.value)} maxLength={100}
                        placeholder="Ex: Observação após sessão 2..."
                        className="w-full bg-gray-700 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Vincular a uma sessão (opcional)</label>
                      <select value={notaSessaoId} onChange={e => setNotaSessaoId(e.target.value)}
                        className="w-full bg-gray-700 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50">
                        <option value="">Nota geral (sem sessão específica)</option>
                        {prontuarioSessoesOrdenadas.map(s => (
                          <option key={s.id} value={s.id}>
                            Sessão {s.numero_sessao} — {fmtDt(s.data_agendada)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Descrição <span className="text-red-400">*</span> (mín. 10 caracteres)</label>
```

- [ ] **Step 6: Enviar `sessao_id` no POST da Nota e limpar o campo ao fechar/salvar**

Em `handleNota` (linhas 878-902), troque:

```ts
  async function handleNota(senha: string) {
    if (!prontuarioSaleMaisRecente) return
    setNotaLoading(true)
    setNotaErro('')
    const res = await fetch('/api/terapeutas/vendas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sale_id: prontuarioSaleMaisRecente.id,
        tipo: 'nota',
        titulo: notaTitulo,
        descricao: notaDesc,
        senha,
        usuario_nome: sessionNome || adminEmail.split('@')[0],
        usuario_tipo: isTerapeutaSession ? 'terapeuta' : 'admin',
        usuario_email: adminEmail,
      }),
    })
    const json = await res.json()
    setNotaLoading(false)
    if (!res.ok) { setNotaErro(json.error ?? 'Erro'); return }
    setNotaSenhaOpen(false); setOcorrenciaTipo(null)
    setNotaTitulo(''); setNotaDesc('')
    loadData()
  }
```

por:

```ts
  async function handleNota(senha: string) {
    if (!prontuarioSaleMaisRecente) return
    setNotaLoading(true)
    setNotaErro('')
    const res = await fetch('/api/terapeutas/vendas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sale_id: prontuarioSaleMaisRecente.id,
        sessao_id: notaSessaoId || undefined,
        tipo: 'nota',
        titulo: notaTitulo,
        descricao: notaDesc,
        senha,
        usuario_nome: sessionNome || adminEmail.split('@')[0],
        usuario_tipo: isTerapeutaSession ? 'terapeuta' : 'admin',
        usuario_email: adminEmail,
      }),
    })
    const json = await res.json()
    setNotaLoading(false)
    if (!res.ok) { setNotaErro(json.error ?? 'Erro'); return }
    setNotaSenhaOpen(false); setOcorrenciaTipo(null)
    setNotaTitulo(''); setNotaDesc(''); setNotaSessaoId('')
    loadData()
  }
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add "app/terapeutas/[id]/page.tsx"
git commit -m "feat: nota do prontuário ganha seletor de sessão opcional"
```

---

### Task 5: Front-end — botão e formulário "Orientação da Sessão" (criar/editar)

**Files:**
- Modify: `app/terapeutas/[id]/page.tsx`

**Interfaces:**
- Consumes: `Ocorrencia.sessao_id` (Task 4), POST/PUT de Tasks 2/3, `sessoesPendentesProntuario`, `prontuarioOcorrencias`.
- Produces: `orientacaoExistentePorSessao: Record<string, Ocorrencia>` (usado por Task 6 pra saber, sessão por sessão, se já existe orientação).

- [ ] **Step 1: Adicionar `'orientacao'` à união de `ocorrenciaTipo` e os novos estados**

Troque (linha 420):

```ts
  const [ocorrenciaTipo, setOcorrenciaTipo] = useState<'select' | 'nota' | 'remarcacao' | 'reembolso' | null>(null)
```

por:

```ts
  const [ocorrenciaTipo, setOcorrenciaTipo] = useState<'select' | 'nota' | 'remarcacao' | 'reembolso' | 'orientacao' | null>(null)
```

Logo depois do bloco de estados de reembolso (depois de `const [reeSenhaOpen, setReeSenhaOpen] = useState(false)`, linha 440), adicione:

```ts

  const [orientSessaoId, setOrientSessaoId] = useState('')
  const [orientDesc, setOrientDesc] = useState('')
  const [orientEditandoId, setOrientEditandoId] = useState<string | null>(null)
  const [orientErro, setOrientErro] = useState('')
  const [orientLoading, setOrientLoading] = useState(false)
  const [orientSenhaOpen, setOrientSenhaOpen] = useState(false)
```

- [ ] **Step 2: Adicionar o memo `orientacaoExistentePorSessao`**

Logo depois do memo `prontuarioOcorrencias` (linhas 806-811), adicione:

```ts
  const orientacaoExistentePorSessao = useMemo(() => {
    const map: Record<string, Ocorrencia> = {}
    for (const o of prontuarioOcorrencias) {
      if (o.tipo === 'orientacao_sessao' && o.sessao_id) map[o.sessao_id] = o
    }
    return map
  }, [prontuarioOcorrencias])
```

- [ ] **Step 3: Regra dos 40 minutos e validade do formulário**

Logo depois de `const remValido = ...` (linha 826), adicione:

```ts
  const orientSessaoEscolhida = prontuarioSessoesOrdenadas.find(s => s.id === orientSessaoId)
  const orientFaltamMs = orientSessaoEscolhida?.data_agendada
    ? new Date(orientSessaoEscolhida.data_agendada).getTime() - Date.now()
    : null
  const orientBloqueadaPorPrazo = orientFaltamMs !== null && orientFaltamMs < 40 * 60 * 1000
  const orientValida = orientSessaoId.length > 0 && orientDesc.trim().length >= 10 && !orientBloqueadaPorPrazo
```

- [ ] **Step 4: Handler de criar/editar (`handleOrientacao`)**

Logo depois de `handleReembolso` (depois da linha 965, `}`), adicione:

```ts
  async function handleOrientacao(senha: string) {
    if (!orientValida) return
    setOrientLoading(true); setOrientErro('')

    if (orientEditandoId) {
      const res = await fetch('/api/terapeutas/vendas', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: orientEditandoId,
          descricao: orientDesc,
          senha,
          usuario_nome: sessionNome || adminEmail.split('@')[0],
          usuario_tipo: isTerapeutaSession ? 'terapeuta' : 'admin',
          usuario_email: adminEmail,
        }),
      })
      const json = await res.json()
      setOrientLoading(false)
      if (!res.ok) { setOrientErro(json.error ?? 'Erro'); return }
    } else {
      if (!prontuarioSaleMaisRecente) { setOrientLoading(false); return }
      const res = await fetch('/api/terapeutas/vendas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sale_id: prontuarioSaleMaisRecente.id,
          sessao_id: orientSessaoId,
          tipo: 'orientacao_sessao',
          titulo: 'ORIENTAÇÃO DA SESSÃO:',
          descricao: orientDesc,
          senha,
          usuario_nome: sessionNome || adminEmail.split('@')[0],
          usuario_tipo: isTerapeutaSession ? 'terapeuta' : 'admin',
          usuario_email: adminEmail,
        }),
      })
      const json = await res.json()
      setOrientLoading(false)
      if (!res.ok) { setOrientErro(json.error ?? 'Erro'); return }
    }

    setOrientSenhaOpen(false); setOcorrenciaTipo(null)
    setOrientSessaoId(''); setOrientDesc(''); setOrientEditandoId(null)
    loadData()
  }
```

- [ ] **Step 5: Botão "Orientação da Sessão" no seletor de tipo**

Troque (linhas 1939-1951):

```tsx
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {[
                        { tipo: 'nota' as const, icon: '📝', title: 'Nota / Observação', desc: 'Registre uma nota ou observação sobre o paciente' },
                        { tipo: 'remarcacao' as const, icon: '📅', title: 'Remarcar Consulta', desc: 'Solicite a remarcação de uma consulta agendada' },
                        { tipo: 'reembolso' as const, icon: '💰', title: 'Solicitação de Reembolso Parcial', desc: 'Reembolso de sessões não realizadas — vai para aprovação do CEO' },
                      ].map(({ tipo, icon, title, desc }) => (
                        <button key={tipo} onClick={() => setOcorrenciaTipo(tipo)}
                          className="text-left p-3 bg-gray-800 hover:bg-gray-700 border border-white/10 hover:border-white/20 rounded-xl transition-colors">
                          <p className="text-base mb-1">{icon}</p>
                          <p className="text-xs font-medium text-white mb-1">{title}</p>
                          <p className="text-[10px] text-gray-500 leading-relaxed">{desc}</p>
                        </button>
                      ))}
                    </div>
```

por:

```tsx
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      {[
                        { tipo: 'nota' as const, icon: '📝', title: 'Nota / Observação', desc: 'Registre uma nota ou observação sobre o paciente' },
                        { tipo: 'remarcacao' as const, icon: '📅', title: 'Remarcar Consulta', desc: 'Solicite a remarcação de uma consulta agendada' },
                        { tipo: 'reembolso' as const, icon: '💰', title: 'Solicitação de Reembolso Parcial', desc: 'Reembolso de sessões não realizadas — vai para aprovação do CEO' },
                        { tipo: 'orientacao' as const, icon: '📣', title: 'Orientação da Sessão', desc: 'Vai automaticamente no lembrete de 30min (grupo do terapeuta e paciente)' },
                      ].map(({ tipo, icon, title, desc }) => (
                        <button key={tipo} onClick={() => setOcorrenciaTipo(tipo)}
                          className="text-left p-3 bg-gray-800 hover:bg-gray-700 border border-white/10 hover:border-white/20 rounded-xl transition-colors">
                          <p className="text-base mb-1">{icon}</p>
                          <p className="text-xs font-medium text-white mb-1">{title}</p>
                          <p className="text-[10px] text-gray-500 leading-relaxed">{desc}</p>
                        </button>
                      ))}
                    </div>
```

- [ ] **Step 6: Formulário "Orientação da Sessão"**

Logo depois do formulário de Reembolso (depois da linha 2125, `)}`, e antes de `{/* Lista de ocorrências */}`), adicione:

```tsx
                {/* Formulário: ORIENTAÇÃO DA SESSÃO */}
                {ocorrenciaTipo === 'orientacao' && (
                  <div className="bg-gray-800/50 border border-white/5 rounded-xl p-4 mb-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-white">📣 {orientEditandoId ? 'Editar orientação da sessão' : 'Nova orientação da sessão'}</p>
                      <button onClick={() => { setOcorrenciaTipo(null); setOrientSessaoId(''); setOrientDesc(''); setOrientEditandoId(null); setOrientErro('') }}
                        className="text-gray-500 hover:text-white"><X className="w-3.5 h-3.5" /></button>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Qual sessão? <span className="text-red-400">*</span></label>
                      <select value={orientSessaoId} disabled={!!orientEditandoId} onChange={e => {
                        const sid = e.target.value
                        setOrientSessaoId(sid)
                        const existente = orientacaoExistentePorSessao[sid]
                        if (existente) {
                          setOrientEditandoId(existente.id)
                          setOrientDesc(existente.descricao)
                        } else {
                          setOrientEditandoId(null)
                          setOrientDesc('')
                        }
                      }} className="w-full bg-gray-700 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50 disabled:opacity-60">
                        <option value="">Selecionar sessão...</option>
                        {sessoesPendentesProntuario.map(s => (
                          <option key={s.id} value={s.id}>
                            Sessão {s.numero_sessao} — {fmtDt(s.data_agendada)}{orientacaoExistentePorSessao[s.id] ? ' (já tem orientação — editar)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    {orientBloqueadaPorPrazo && (
                      <p className="text-[11px] text-amber-400">⚠️ Faltam menos de 40 minutos para essa sessão — não dá mais tempo de entrar no lembrete automático de 30min. Não é possível registrar/editar.</p>
                    )}
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Título</label>
                      <input type="text" value="ORIENTAÇÃO DA SESSÃO:" disabled
                        className="w-full bg-gray-700/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-400" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-1">Descrição <span className="text-red-400">*</span> (mín. 10 caracteres)</label>
                      <textarea value={orientDesc} onChange={e => setOrientDesc(e.target.value)} rows={4}
                        placeholder="Ex: Hoje nessa sessão será o marido dela que vai fazer, ele questionou..."
                        className="w-full bg-gray-700 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500/50 resize-y" />
                    </div>
                    {orientErro && <p className="text-xs text-red-400">{orientErro}</p>}
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => { setOcorrenciaTipo(null); setOrientSessaoId(''); setOrientDesc(''); setOrientEditandoId(null); setOrientErro('') }}
                        className="px-3 py-1.5 text-xs text-gray-400 bg-gray-700 rounded-lg">Cancelar</button>
                      <button onClick={() => {
                        if (!orientSessaoId) { setOrientErro('Selecione a sessão'); return }
                        if (orientDesc.trim().length < 10) { setOrientErro('Descreva com pelo menos 10 caracteres'); return }
                        if (orientBloqueadaPorPrazo) { setOrientErro('Faltam menos de 40 minutos para a sessão'); return }
                        setOrientErro(''); setOrientSenhaOpen(true)
                      }} disabled={!orientValida}
                        className="px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors">
                        {orientEditandoId ? 'Salvar edição' : 'Registrar orientação'}
                      </button>
                    </div>
                  </div>
                )}
```

- [ ] **Step 7: Modal de senha da Orientação**

Logo depois do `<SenhaModal ... titulo="Confirmar remarcação" ... />` existente (por volta da linha 2174+), adicione um novo `<SenhaModal>`:

```tsx
      <SenhaModal
        isOpen={orientSenhaOpen}
        onClose={() => { setOrientSenhaOpen(false); setOrientErro('') }}
        onConfirm={handleOrientacao}
        titulo={orientEditandoId ? 'Salvar edição da orientação' : 'Registrar orientação'}
        descricao="Digite sua senha para confirmar"
        loading={orientLoading}
        erro={orientErro}
      />
```

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 9: Verificação manual no navegador**

Run: `npm run dev`, abrir `http://localhost:3000/terapeutas/<id de um terapeuta com sessão futura>`, entrar no prontuário de um paciente com sessão agendada daqui a mais de 40min, clicar "+ Registrar Ocorrência" → "📣 Orientação da Sessão", escolher a sessão, escrever um texto de teste, confirmar com senha real. Verificar que aparece na lista (mesmo antes da Task 6, ela ainda aparece na lista antiga). Escolher a mesma sessão de novo no formulário e confirmar que o texto já vem preenchido e o botão vira "Salvar edição". Apagar a ocorrência de teste do banco ao final (mesmo script DELETE das tasks anteriores).

- [ ] **Step 10: Commit**

```bash
git add "app/terapeutas/[id]/page.tsx"
git commit -m "feat: formulário de Orientação da Sessão (criar/editar) no prontuário"
```

---

### Task 6: Front-end — lista de Ocorrências agrupada por sessão

**Files:**
- Modify: `app/terapeutas/[id]/page.tsx`

**Interfaces:**
- Consumes: `Ocorrencia.sessao_id` (Task 4), `prontuarioSessoesOrdenadas`, `prontuarioOcorrencias`.
- Produces: substitui a lista plana atual por seções agrupadas — não introduz nenhuma interface nova pra outras tasks.

- [ ] **Step 1: Adicionar o memo de agrupamento**

Logo depois do memo `orientacaoExistentePorSessao` (Task 5, Step 2), adicione:

```ts
  const ocorrenciasAgrupadasPorSessao = useMemo(() => {
    const porSessao: { sessao: Sessao; ocorrencias: Ocorrencia[] }[] = []
    for (const s of prontuarioSessoesOrdenadas) {
      const lista = prontuarioOcorrencias.filter(o => o.sessao_id === s.id)
      if (lista.length > 0) porSessao.push({ sessao: s, ocorrencias: lista })
    }
    // Mais recente primeiro — mesma sessão pode ter data_agendada antiga
    // se foi remarcada, então ordena pela sessão (numero_sessao desc), não
    // por data_agendada.
    porSessao.sort((a, b) => b.sessao.numero_sessao - a.sessao.numero_sessao)
    const geral = prontuarioOcorrencias.filter(o => !o.sessao_id)
    return { porSessao, geral }
  }, [prontuarioSessoesOrdenadas, prontuarioOcorrencias])
```

- [ ] **Step 2: Substituir a lista plana por seções agrupadas**

Troque (linhas 2127-2150):

```tsx
                {/* Lista de ocorrências */}
                <div className="space-y-2">
                  {prontuarioOcorrencias.length === 0 ? (
                    <p className="text-xs text-gray-600 text-center py-4">Nenhuma ocorrência registrada.</p>
                  ) : prontuarioOcorrencias.map(o => {
                    const meta = OCORRENCIA_META[o.tipo] ?? { icon: '📌', label: o.tipo, cls: 'text-gray-400 bg-gray-400/10 border-gray-400/20' }
                    return (
                      <div key={o.id} className={`border rounded-xl p-3 ${meta.cls}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span>{meta.icon}</span>
                            <span className="text-[11px] font-medium">{meta.label}</span>
                          </div>
                          <span className="text-[10px] opacity-60">{fmtDt(o.created_at)}</span>
                        </div>
                        <p className="text-xs text-white font-medium mb-0.5">{o.titulo}</p>
                        <p className="text-xs opacity-80 leading-relaxed">{o.descricao}</p>
                        <p className="text-[10px] opacity-50 mt-2">
                          Registrado por {o.criado_por_nome} ({o.criado_por_tipo})
                        </p>
                      </div>
                    )
                  })}
                </div>
```

por:

```tsx
                {/* Lista de ocorrências — agrupada por sessão */}
                <div className="space-y-4">
                  {prontuarioOcorrencias.length === 0 ? (
                    <p className="text-xs text-gray-600 text-center py-4">Nenhuma ocorrência registrada.</p>
                  ) : (
                    <>
                      {ocorrenciasAgrupadasPorSessao.porSessao.map(({ sessao, ocorrencias: lista }) => (
                        <div key={sessao.id}>
                          <p className="text-[11px] font-semibold text-gray-400 mb-2">
                            Sessão {sessao.numero_sessao} — {fmtDt(sessao.data_agendada)}
                          </p>
                          <div className="space-y-2">
                            {lista.map(o => {
                              const meta = OCORRENCIA_META[o.tipo] ?? { icon: '📌', label: o.tipo, cls: 'text-gray-400 bg-gray-400/10 border-gray-400/20' }
                              return (
                                <div key={o.id} className={`border rounded-xl p-3 ${meta.cls}`}>
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                      <span>{meta.icon}</span>
                                      <span className="text-[11px] font-medium">{meta.label}</span>
                                    </div>
                                    <span className="text-[10px] opacity-60">{fmtDt(o.created_at)}</span>
                                  </div>
                                  <p className="text-xs text-white font-medium mb-0.5">{o.titulo}</p>
                                  <p className="text-xs opacity-80 leading-relaxed">{o.descricao}</p>
                                  <p className="text-[10px] opacity-50 mt-2">
                                    Registrado por {o.criado_por_nome} ({o.criado_por_tipo})
                                  </p>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                      {ocorrenciasAgrupadasPorSessao.geral.length > 0 && (
                        <div>
                          <p className="text-[11px] font-semibold text-gray-400 mb-2">Geral</p>
                          <div className="space-y-2">
                            {ocorrenciasAgrupadasPorSessao.geral.map(o => {
                              const meta = OCORRENCIA_META[o.tipo] ?? { icon: '📌', label: o.tipo, cls: 'text-gray-400 bg-gray-400/10 border-gray-400/20' }
                              return (
                                <div key={o.id} className={`border rounded-xl p-3 ${meta.cls}`}>
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                      <span>{meta.icon}</span>
                                      <span className="text-[11px] font-medium">{meta.label}</span>
                                    </div>
                                    <span className="text-[10px] opacity-60">{fmtDt(o.created_at)}</span>
                                  </div>
                                  <p className="text-xs text-white font-medium mb-0.5">{o.titulo}</p>
                                  <p className="text-xs opacity-80 leading-relaxed">{o.descricao}</p>
                                  <p className="text-[10px] opacity-50 mt-2">
                                    Registrado por {o.criado_por_nome} ({o.criado_por_tipo})
                                  </p>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Verificação manual no navegador**

No mesmo prontuário usado na Task 5, confirmar que a Orientação de teste aparece dentro da seção "Sessão N — ...", e que notas antigas sem `sessao_id` aparecem em "Geral". Registrar uma Nota vinculando a uma sessão e confirmar que ela migra pra seção da sessão certa.

- [ ] **Step 5: Commit**

```bash
git add "app/terapeutas/[id]/page.tsx"
git commit -m "feat: agrupa a lista de ocorrências por sessão no prontuário"
```

---

### Task 7: WhatsApp — incluir a orientação no lembrete de 30 minutos

**Files:**
- Modify: `lib/whatsapp-pendentes.ts`
- Modify: `app/api/whatsapp/pendentes-30min/route.ts`

**Interfaces:**
- Consumes: coluna `sessao_id`/`tipo = 'orientacao_sessao'` de `ocorrencias_prontuario` (Tasks 1-3).
- Produces: `SessaoPendenteWhatsapp.orientacao_sessao: string | null`. Task 8 (n8n) consome esse campo no payload que já chega pro workflow.

- [ ] **Step 1: Adicionar o campo ao tipo e o parâmetro à função**

Em `lib/whatsapp-pendentes.ts`, troque:

```ts
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
```

por:

```ts
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
  orientacao_sessao: string | null
}
```

E troque a assinatura da função:

```ts
export async function buscarPendentes(
  client: SupabaseClient,
  params: { inicio: string; fim: string; colGrupo: ColunaGrupo; colPaciente: ColunaPaciente }
): Promise<TerapeutaPendente[]> {
```

por:

```ts
export async function buscarPendentes(
  client: SupabaseClient,
  params: { inicio: string; fim: string; colGrupo: ColunaGrupo; colPaciente: ColunaPaciente; incluirOrientacao?: boolean }
): Promise<TerapeutaPendente[]> {
```

- [ ] **Step 2: Buscar as orientações e montar o mapa**

Logo depois do bloco que monta `telefonePorSale`/`dataHoraPorSale` (linhas 74-84 hoje, o `if (saleIds.length > 0) { ... }` que consulta `sales`), adicione:

```ts
  const orientacaoPorSessao: Record<string, string> = {}
  if (params.incluirOrientacao) {
    const sessaoIds = linhas.map(s => s.id)
    if (sessaoIds.length > 0) {
      const { data: orientacoes, error: orientErr } = await client
        .from('ocorrencias_prontuario')
        .select('sessao_id,descricao')
        .in('sessao_id', sessaoIds)
        .eq('tipo', 'orientacao_sessao')
      if (orientErr) throw new Error(orientErr.message)
      for (const o of orientacoes ?? []) {
        if (o.sessao_id) orientacaoPorSessao[o.sessao_id as string] = o.descricao as string
      }
    }
  }
```

- [ ] **Step 3: Incluir o campo no objeto retornado por sessão**

Troque:

```ts
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
```

por:

```ts
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
      orientacao_sessao: orientacaoPorSessao[s.id] ?? null,
    })
```

- [ ] **Step 4: Passar `incluirOrientacao: true` só no cron de 30min**

Em `app/api/whatsapp/pendentes-30min/route.ts`, troque:

```ts
    const terapeutas = await buscarPendentes(getSupabaseAdmin(), {
      inicio: agora.toISOString(),
      fim: emTrintaMin.toISOString(),
      colGrupo: 'lembrete_grupo_30min_enviado_em',
      colPaciente: 'lembrete_paciente_30min_enviado_em',
    })
```

por:

```ts
    const terapeutas = await buscarPendentes(getSupabaseAdmin(), {
      inicio: agora.toISOString(),
      fim: emTrintaMin.toISOString(),
      colGrupo: 'lembrete_grupo_30min_enviado_em',
      colPaciente: 'lembrete_paciente_30min_enviado_em',
      incluirOrientacao: true,
    })
```

(`app/api/whatsapp/pendentes-vespera/route.ts` não muda — não passa `incluirOrientacao`, então `orientacao_sessao` sempre vem `null` lá.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Verificar manualmente contra o banco real**

Crie uma orientação de teste pra uma sessão real dentro da janela de 30min (ou ajuste `inicio`/`fim` no teste pra cobrir uma sessão futura qualquer), depois chame o endpoint com o secret de cron:

```bash
cd "/Users/rafael/Desktop/CLAUDE CODE - PROJETO DASBOARADS/DRE FINANCEIRO SPR DIGITAL" && grep WHATSAPP_CRON_SECRET .env.local
npm run dev &
sleep 3
curl -s http://localhost:3000/api/whatsapp/pendentes-30min -H "x-whatsapp-cron-secret: SEGREDO_DO_ENV"
```

Expected: JSON com `terapeutas[].sessoes[]` incluindo `"orientacao_sessao": "..."` pra sessão de teste, e `"orientacao_sessao": null` pras demais.

- [ ] **Step 7: Commit**

```bash
git add lib/whatsapp-pendentes.ts app/api/whatsapp/pendentes-30min/route.ts
git commit -m "feat: lembrete de 30min busca orientação da sessão vinculada"
```

---

### Task 8: n8n — usar a orientação na mensagem do lembrete de 30min

**Files:**
- Nenhum arquivo no git — atualização direta do workflow "SPR Digital - Lembrete 30 Minutos" no n8n self-hosted (`https://n8n.pedroroncada.com.br`), via API REST, igual foi feito pra criar os workflows originalmente. Esse workflow **foi criado por este mesmo projeto** (task anterior de lembretes de WhatsApp) — editá-lo está dentro da regra combinada com o usuário (só workflows pré-existentes de outras coisas são intocáveis).

**Interfaces:**
- Consumes: campo `orientacao_sessao: string | null` que Task 7 já inclui no payload de `/api/whatsapp/pendentes-30min` (é esse endpoint que o workflow chama via HTTP Request).

- [ ] **Step 1: Localizar o workflow e o node "Montar Envios"**

```bash
source "/Users/rafael/Desktop/CLAUDE CODE - PROJETO DASBOARADS/DRE FINANCEIRO SPR DIGITAL/.env.local"
curl -s "$N8N_BASE_URL/api/v1/workflows" -H "X-N8N-API-KEY: $N8N_API_KEY" \
  | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log(d.data.filter(w=>w.name.includes("Lembrete 30")).map(w=>({id:w.id,name:w.name})))'
```

Expected: um único resultado, algo como `[{ id: '...', name: 'SPR Digital - Lembrete 30 Minutos' }]`. Guarde o `id`.

- [ ] **Step 2: Baixar o workflow completo e localizar o node "Montar Envios"**

```bash
curl -s "$N8N_BASE_URL/api/v1/workflows/WORKFLOW_ID" -H "X-N8N-API-KEY: $N8N_API_KEY" > /tmp/wf_30min_atual.json
node -e '
const wf = JSON.parse(require("fs").readFileSync("/tmp/wf_30min_atual.json","utf8"))
const node = wf.nodes.find(n => n.name === "Montar Envios")
console.log(node.parameters.jsCode)
'
```

Expected: o código atual, igual ao documentado no design (função que monta `envios` com `tipo: 'grupo_30min'` e `tipo: 'paciente_30min'`).

- [ ] **Step 3: Atualizar o `jsCode` do node "Montar Envios"**

Escreva um script Node que carrega `/tmp/wf_30min_atual.json`, substitui o `jsCode` do node "Montar Envios" pela versão abaixo (mesma lógica, com o bloco de orientação acrescentado ao final das duas mensagens quando `s.orientacao_sessao` vier preenchido), e salva de volta:

```js
// /tmp/atualizar_wf_30min.js
const fs = require('fs')
const wf = JSON.parse(fs.readFileSync('/tmp/wf_30min_atual.json', 'utf8'))
const node = wf.nodes.find(n => n.name === 'Montar Envios')

node.parameters.jsCode = `
function emojiGenero(nomeCompleto) {
  const primeiroNome = (nomeCompleto || '').trim().split(' ')[0].toLowerCase()
  const feminino = /a$/.test(primeiroNome)
  return feminino ? '👩🏻\\u200d🦰' : '🧔🏻\\u200d♂️'
}

function fmtHorario(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
}
function fmtData(iso) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })
}
function fmtDataHora(iso) {
  return fmtData(iso) + ', ' + fmtHorario(iso)
}
function blocoOrientacao(s) {
  if (!s.orientacao_sessao) return ''
  return '\\n\\n📣 *ORIENTAÇÃO DA SESSÃO:*\\n' + s.orientacao_sessao
}

const terapeutas = $input.first().json.terapeutas || []
const envios = []

for (const t of terapeutas) {
  for (const s of t.sessoes) {
    if (!s.grupo_ja_enviado) {
      let l = '⏰ Em 30 min:\\n' + emojiGenero(s.paciente_nome) + ' ' + s.paciente_nome + ' - sessão ' + s.numero_sessao + '/' + s.total_sessoes
      if (s.paciente_telefone) l += '\\n📞 ' + s.paciente_telefone
      l += '\\n🕐 Data da sessão: ' + fmtDataHora(s.data_agendada)
      if (s.link_meet) l += '\\n🎥 Link do Meet: ' + s.link_meet
      l += blocoOrientacao(s)
      envios.push({ json: {
        tipo: 'grupo_30min',
        destino: t.grupo_whatsapp_id,
        mensagem: l,
        sessao_ids: [s.sessao_id],
      }})
    }
    if (!s.paciente_ja_enviado && s.paciente_telefone) {
      const primeiroNome = s.paciente_nome.split(' ')[0]
      let msg = 'Oi ' + primeiroNome + '! Sua sessão começa em 30 minutos (' + fmtHorario(s.data_agendada) + ').'
      if (s.link_meet) msg += '\\nLink: ' + s.link_meet
      msg += blocoOrientacao(s)
      envios.push({ json: {
        tipo: 'paciente_30min',
        destino: s.paciente_telefone,
        mensagem: msg,
        sessao_ids: [s.sessao_id],
      }})
    }
  }
}

return envios
`

fs.writeFileSync('/tmp/wf_30min_atualizado.json', JSON.stringify(wf))
console.log('ok')
```

Run: `node /tmp/atualizar_wf_30min.js`
Expected: `ok`.

- [ ] **Step 4: Enviar a atualização pro n8n (PUT)**

A API do n8n rejeita campos somente-leitura (`id`, `createdAt`, `updatedAt`, etc.) num PUT — mande só `name`, `nodes`, `connections`, `settings`:

```bash
node -e '
const fs = require("fs")
const wf = JSON.parse(fs.readFileSync("/tmp/wf_30min_atualizado.json", "utf8"))
const body = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings ?? {} }
fs.writeFileSync("/tmp/wf_30min_put_body.json", JSON.stringify(body))
'
curl -s -X PUT "$N8N_BASE_URL/api/v1/workflows/WORKFLOW_ID" \
  -H "X-N8N-API-KEY: $N8N_API_KEY" -H "Content-Type: application/json" \
  --data @/tmp/wf_30min_put_body.json | tee /tmp/wf_30min_put_result.json
```

Expected: JSON de resposta com o workflow atualizado, sem erro. Se der erro de campo não permitido, veja qual campo a mensagem aponta e remova do `body` antes de tentar de novo.

- [ ] **Step 5: Confirmar o node atualizado**

```bash
node -e '
const d = JSON.parse(require("fs").readFileSync("/tmp/wf_30min_put_result.json","utf8"))
const node = d.nodes.find(n => n.name === "Montar Envios")
console.log(node.parameters.jsCode.includes("blocoOrientacao") ? "OK — contém blocoOrientacao" : "FALTOU")
'
```

Expected: `OK — contém blocoOrientacao`.

- [ ] **Step 6: Teste ponta a ponta com número de teste**

Registre uma Orientação de teste pra uma sessão real que caia dentro dos próximos ~30min (ou aguarde uma sessão real chegar nessa janela), e confirme no WhatsApp de teste (grupo de alerta / número pessoal, igual os testes anteriores desse pipeline) que a mensagem chega com o bloco `📣 *ORIENTAÇÃO DA SESSÃO:*` ao final. **Não** aponte esse teste pro grupo real do terapeuta nem pro telefone real do paciente — reaproveite o mesmo esquema de número de teste já usado nas tasks anteriores desse pipeline de lembretes.

- [ ] **Step 7: Relatar ao usuário**

Sem commit nesta task (nada no git muda). Avisar o usuário que o workflow "SPR Digital - Lembrete 30 Minutos" foi atualizado no n8n e pedir confirmação de que uma mensagem real chegou corretamente formatada antes de considerar o pipeline completo.
