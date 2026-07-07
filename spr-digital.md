# SPR Digital — Documentação Completa do Projeto

> **Arquivo de referência definitivo.** Serve como guia de instalação do zero, memória persistente de contexto e registro de todas as decisões de arquitetura. Qualquer pessoa (ou Claude em um novo chat) consegue subir o projeto exatamente como está lendo este documento.

---

## 1. Visão Geral

**Nome do projeto:** SPR Digital — Controle de Projetos  
**Repositório:** https://github.com/darlanrafael/spr-digital.git  
**Localização local:** `/Users/rafael/Desktop/CLAUDE CODE - PROJETO DASBOARADS/DRE FINANCEIRO SPR DIGITAL/`

**Propósito:** Dashboard financeiro interno da agência SPR Digital para controle de projetos de infoprodutos. Centraliza faturamento bruto/líquido, impostos, custos fixos e variáveis, investimento em Meta Ads, ROAS, DRE mensal, fechamentos por sócio, fluxo de caixa e um módulo separado para gestão de atendimentos de terapeutas.

**IMPORTANTE:** Este projeto é completamente independente do `projeto-trafego` (dashboard de tráfego pago com Meta Ads/Kiwify/Hubla para monitoramento de campanhas). Nunca misturar contexto entre os dois.

---

## 2. Stack Técnica

| Camada | Tecnologia |
|---|---|
| Framework | Next.js 16.2.7 (App Router) |
| Runtime | React 19.2.4 |
| Linguagem | TypeScript 5 |
| Estilização | Tailwind CSS v4 |
| Banco de dados | Supabase (PostgreSQL) |
| Cliente Supabase | `@supabase/supabase-js` v2 |
| Gráficos | Recharts v3 |
| Ícones | Lucide React v1 |
| Datas | date-fns v4 |
| Deploy | Vercel |

**Versões exatas do `package.json`:**
```json
{
  "next": "16.2.7",
  "react": "19.2.4",
  "react-dom": "19.2.4",
  "@supabase/supabase-js": "^2.108.1",
  "date-fns": "^4.4.0",
  "lucide-react": "^1.17.0",
  "recharts": "^3.8.1",
  "tailwindcss": "^4",
  "@tailwindcss/postcss": "^4",
  "typescript": "^5",
  "tsx": "^4.22.4"
}
```

---

## 3. Estrutura de Arquivos

```
spr-digital/
├── app/
│   ├── layout.tsx                    # Layout raiz com AppProvider
│   ├── globals.css                   # Tailwind + variáveis CSS
│   ├── page.tsx                      # Dashboard principal (rota /)
│   ├── login/page.tsx                # Página de login
│   ├── vendas/page.tsx               # Listagem de vendas
│   ├── dre/page.tsx                  # DRE mensal + fluxo de caixa
│   ├── fechamentos/page.tsx          # Fechamentos financeiros por sócio
│   ├── caixa/page.tsx                # Extrato de caixa
│   ├── analises/page.tsx             # Análises avançadas
│   └── api/
│       ├── sales/route.ts            # GET vendas por período
│       ├── costs/route.ts            # GET custos
│       ├── closings/route.ts         # GET fechamentos
│       ├── cashflow/route.ts         # GET fluxo de caixa
│       ├── meta/
│       │   ├── insights/route.ts     # GET gasto Meta Ads via API
│       │   └── test/route.ts         # Teste de conexão Meta
│       ├── webhooks/
│       │   ├── kiwify/route.ts       # POST webhook Kiwify
│       │   └── hubla/route.ts        # POST webhook Hubla
│       └── terapeutas/
│           ├── login/route.ts
│           ├── dashboard/route.ts
│           ├── sessoes/route.ts
│           ├── sessoes/agendar/route.ts
│           ├── sessoes/confirmar/route.ts
│           ├── sessoes/remarcar/route.ts
│           ├── vendas/route.ts
│           ├── aprovacoes/route.ts
│           └── admin/
│               ├── terapeutas/route.ts
│               ├── usuarios/route.ts
│               └── log/route.ts
├── app/terapeutas/
│   ├── layout.tsx                    # Layout do módulo terapeutas
│   ├── page.tsx                      # Dashboard terapeutas (admin)
│   ├── login/page.tsx
│   ├── agenda/page.tsx
│   ├── lista/page.tsx
│   ├── vendas/page.tsx
│   ├── aprovacoes/page.tsx
│   ├── admin/page.tsx
│   └── [id]/page.tsx                 # Perfil individual do terapeuta
├── components/
│   ├── Header.tsx                    # Navegação top com seletor de projeto
│   ├── MobileNav.tsx                 # Nav inferior mobile
│   ├── MetricCard.tsx                # Card de métrica reutilizável
│   ├── Modal.tsx                     # Modal genérico
│   ├── PlatformBadge.tsx             # Badge kiwify/hubla
│   ├── ProtectedRoute.tsx            # Guard de rota (redireciona para /login)
│   ├── BestTimesPanel.tsx            # Análise melhores dias/horários
│   └── SenhaModal.tsx                # Modal de senha (módulo terapeutas)
├── contexts/
│   └── AppContext.tsx                # Estado global (user, sales, costs, etc.)
├── lib/
│   ├── auth.ts                       # Login/logout via localStorage
│   ├── supabase.ts                   # Clientes Supabase (anon + admin)
│   ├── services.ts                   # CRUD completo no Supabase
│   ├── meta.ts                       # Integração Meta Ads API
│   ├── formatters.ts                 # Formatadores de moeda, data, cálculos
│   └── terapeutas-auth.ts            # Auth e lógica do módulo terapeutas
├── types/
│   └── index.ts                      # Todos os tipos TypeScript
├── data/                             # Dados mock (fallback quando Supabase não responde)
│   ├── sales.json
│   ├── costs.json
│   ├── closings.json
│   ├── cashflow.json
│   ├── projects.json
│   └── products.json
├── supabase/
│   └── schema.sql                    # Schema completo do banco de dados
├── scripts/
│   └── seed.ts                       # Script para popular dados iniciais
├── public/                           # Assets estáticos (logos SVG padrão Next.js)
├── .gitignore
├── next.config.ts
├── tsconfig.json
├── postcss.config.mjs
└── eslint.config.mjs
```

---

## 4. Banco de Dados — Schema Completo

Execute no **SQL Editor do Supabase** na ordem abaixo. O script já inclui `DROP TABLE` para re-execução segura.

```sql
-- Drop em ordem reversa de dependência
drop table if exists cashflow cascade;
drop table if exists closings cascade;
drop table if exists meta_ads cascade;
drop table if exists variable_costs cascade;
drop table if exists fixed_costs cascade;
drop table if exists sales cascade;
drop table if exists products cascade;
drop table if exists projects cascade;

-- Tabela 1: projects
create table projects (
  id          text        primary key,
  nome        text        not null,
  descricao   text        not null default '',
  ativo       boolean     not null default true,
  gestor_id   text        not null default '',
  cor         text        not null default '#6366f1',
  created_at  timestamptz not null default now()
);

-- Tabela 2: products
create table products (
  id          text        primary key,
  project_id  text        not null references projects(id) on delete cascade,
  nome        text        not null,
  plataforma  text        not null,
  preco       numeric     not null default 0,
  aliquota    numeric     not null default 0,
  created_at  timestamptz not null default now()
);

-- Tabela 3: sales
create table sales (
  id                  text        primary key,
  project_id          text        not null references projects(id) on delete cascade,
  nome                text        not null,
  email               text        not null default '',
  telefone            text        not null default '',
  cpf                 text,
  produto             text        not null,
  plataforma          text        not null,
  plataforma_sale_id  text,                          -- ID da venda na plataforma (deduplicação)
  order_id            text,                          -- order_id da Kiwify/Hubla (deduplicação webhook)
  preco_base          numeric     not null default 0,
  valor_pago_cliente  numeric     not null default 0,
  valor_com_juros     numeric,                          -- valor com juros de parcelamento (Hubla totalCents/100, Kiwify charge_amount/100); adicionado em 01/07/2026 via migration
  valor_liquido       numeric     not null default 0,
  data_hora           timestamptz not null,
  utm_source          text        not null default '',
  utm_medium          text        not null default '',
  utm_campaign        text        not null default '',
  utm_content         text        not null default '',
  utm_term            text        not null default '',
  status              text        not null default 'aprovada',
  data_reembolso      date,
  created_at          timestamptz not null default now()
);

-- Tabela 4: fixed_costs (globais, sem projeto)
-- 06/07/2026: coluna `ativo` removida, coluna `data` adicionada (mês de
-- referência, dia sempre 01) — cada custo fixo agora é um lançamento por
-- mês, igual variable_costs, em vez de um molde sempre ativo.
create table fixed_costs (
  id          text        primary key,
  descricao   text        not null,
  valor       numeric     not null default 0,
  data        date        not null,
  created_at  timestamptz not null default now()
);

-- Tabela 5: variable_costs
create table variable_costs (
  id          text        primary key,
  project_id  text        references projects(id) on delete set null,
  descricao   text        not null,
  valor       numeric     not null default 0,
  data        date        not null,
  created_at  timestamptz not null default now()
);

-- Tabela 6: meta_ads (gasto mensal manual por projeto)
create table meta_ads (
  id          uuid        primary key default gen_random_uuid(),
  project_id  text        not null references projects(id) on delete cascade,
  mes         text        not null,
  valor       numeric     not null default 0,
  created_at  timestamptz not null default now(),
  unique(project_id, mes)
);

-- Tabela 7: closings (fechamentos com JSONB)
create table closings (
  id                      text        primary key,
  project_id              text        references projects(id) on delete set null,
  data                    date        not null,
  data_confirmacao        timestamptz,
  periodo_inicio          date        not null,
  periodo_fim             date        not null,
  produtos_incluidos      text[]      not null default '{}',
  faturamento_bruto       numeric     not null default 0,
  impostos                numeric     not null default 0,
  taxas_plataforma        numeric     not null default 0,
  faturamento_liquido     numeric     not null default 0,
  custos_totais           numeric     not null default 0,
  custos_fixos_total      numeric     not null default 0,
  custos_variaveis_total  numeric     not null default 0,
  lucro_bruto             numeric     not null default 0,
  reserva_caixa           numeric     not null default 0,
  lucro_real              numeric     not null default 0,
  socios                  jsonb       not null default '[]',
  compradores             jsonb       not null default '[]',
  alertas                 jsonb       not null default '[]',
  by_product              jsonb       not null default '[]',
  created_at              timestamptz not null default now()
);

-- Tabela 8: cashflow
create table cashflow (
  id                text        primary key,
  project_id        text        references projects(id) on delete set null,
  data              date        not null,
  descricao         text        not null,
  origem            text        not null default '',
  tipo              text        not null,
  valor             numeric     not null default 0,
  saldo_acumulado   numeric     not null default 0,
  created_at        timestamptz not null default now()
);

-- Índices
create index idx_sales_project_id     on sales(project_id);
create index idx_sales_data_hora      on sales(data_hora desc);
create index idx_sales_status         on sales(status);
create index idx_products_project_id  on products(project_id);
create index idx_variable_costs_proj  on variable_costs(project_id);
create index idx_meta_ads_project_id  on meta_ads(project_id);
create index idx_closings_project_id  on closings(project_id);
create index idx_closings_confirm     on closings(data_confirmacao desc);
create index idx_cashflow_project_id  on cashflow(project_id);
create index idx_cashflow_data        on cashflow(data desc);
```

**Atenção:** Usar `TEXT` como PK em `projects`, `products`, `sales`, etc. para manter compatibilidade com os IDs do app (`proj_1`, `prod_1`, `sale_001`).

### Schema do Módulo Terapeutas

Execute este script **separadamente**, após o schema principal acima. São 7 tabelas adicionais no mesmo Supabase.

```sql
-- Drop em ordem reversa de dependência
drop table if exists solicitacoes_reembolso cascade;
drop table if exists atividades_log cascade;
drop table if exists ocorrencias_prontuario cascade;
drop table if exists sessoes cascade;
drop table if exists usuarios_sistema cascade;
drop table if exists terapeutas cascade;

-- Tabela 1: terapeutas
create table terapeutas (
  id                   uuid        primary key default gen_random_uuid(),
  nome                 text        not null,
  email                text        not null,
  percentual_comissao  numeric     not null default 30,
  ativo                boolean     not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz
);

-- Tabela 2: usuarios_sistema (login próprio, senha SHA256 + salt)
-- Senha = SHA256(senha + 'spr-terapeutas-salt-2026')
-- Tipos: 'admin', 'comercial', 'terapeuta'
create table usuarios_sistema (
  id           uuid        primary key default gen_random_uuid(),
  nome         text        not null,
  email        text        not null unique,
  senha_hash   text        not null,
  tipo         text        not null,
  terapeuta_id uuid        references terapeutas(id) on delete set null,
  permissoes   jsonb       not null default '{}',
  ativo        boolean     not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);

-- Tabela 3: sessoes
-- status: 'agendada' | 'pendente' | 'entregue' | 'cancelada' | 'remarcada'
-- status_consulta: 'aguardando' | 'em_atendimento' | 'concluida' | 'cancelada' | 'remarcada'
create table sessoes (
  id                        uuid        primary key default gen_random_uuid(),
  sale_id                   text        not null references sales(id) on delete cascade,
  terapeuta_id              uuid        not null references terapeutas(id),
  numero_sessao             int         not null,
  total_sessoes             int         not null,
  status                    text        not null default 'agendada',
  status_consulta           text        default 'aguardando',
  data_agendada             timestamptz,
  link_meet                 text,
  comissao_valor            numeric     not null default 0,
  comissao_paga             boolean     not null default false,
  paciente_nome             text        not null,
  paciente_email            text        not null default '',
  agendado_por              text,
  vendedor_nome             text,
  vendedor_email            text,
  data_entrega              timestamptz,
  entregue_confirmado_por   text,
  iniciado_em               timestamptz,
  concluido_em              timestamptz,
  observacoes               text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz
);

-- Tabela 4: ocorrencias_prontuario (histórico de ações por venda)
-- tipos: 'nota' | 'confirmacao_entrega' | 'reembolso_aprovado' | 'reembolso_rejeitado'
create table ocorrencias_prontuario (
  id               uuid        primary key default gen_random_uuid(),
  sale_id          text        not null,
  tipo             text        not null,
  titulo           text        not null,
  descricao        text        not null default '',
  dados_extras     jsonb       default '{}',
  criado_por_nome  text        not null,
  criado_por_tipo  text        not null,
  criado_por_email text        not null,
  created_at       timestamptz not null default now()
);

-- Tabela 5: atividades_log (auditoria completa de ações)
create table atividades_log (
  id               uuid        primary key default gen_random_uuid(),
  usuario_nome     text        not null,
  usuario_tipo     text        not null,
  tipo_acao        text        not null,
  sessao_id        uuid        references sessoes(id) on delete set null,
  sale_id          text,
  descricao        text        not null,
  dados_anteriores jsonb,
  dados_novos      jsonb,
  created_at       timestamptz not null default now()
);

-- Tabela 6: solicitacoes_reembolso
-- status: 'pendente' | 'aprovado' | 'rejeitado'
create table solicitacoes_reembolso (
  id                      uuid        primary key default gen_random_uuid(),
  sale_id                 text        not null,
  paciente_nome           text        not null,
  paciente_email          text        not null default '',
  sessoes_ids             text[]      not null default '{}',
  sessoes_numeros         int[]       not null default '{}',
  valor_reembolso         numeric     not null default 0,
  motivo                  text        not null,
  solicitado_por_nome     text        not null,
  solicitado_por_tipo     text        not null,
  solicitado_por_email    text        not null,
  status                  text        not null default 'pendente',
  aprovado_por_nome       text,
  aprovado_por_email      text,
  justificativa_rejeicao  text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- Tabela 7: remarcacoes_historico (histórico de cada remarcação de sessão)
create table remarcacoes_historico (
  id                    uuid        primary key default gen_random_uuid(),
  sessao_id             uuid        not null references sessoes(id) on delete cascade,
  sale_id               text        not null,
  paciente_nome         text        not null,
  remarcado_por_nome    text        not null,
  remarcado_por_tipo    text        not null,
  solicitado_por        text        not null,
  motivo                text        not null default '',
  data_anterior         timestamptz not null,
  data_nova             timestamptz not null,
  created_at            timestamptz not null default now()
);

-- Índices do módulo Terapeutas
create index idx_sessoes_sale_id       on sessoes(sale_id);
create index idx_sessoes_terapeuta_id  on sessoes(terapeuta_id);
create index idx_sessoes_data          on sessoes(data_agendada);
create index idx_ocorrencias_sale_id   on ocorrencias_prontuario(sale_id);
create index idx_atividades_sale_id    on atividades_log(sale_id);
create index idx_solicitacoes_status       on solicitacoes_reembolso(status);
create index idx_remarcacoes_sessao_id    on remarcacoes_historico(sessao_id);
create index idx_remarcacoes_sale_id      on remarcacoes_historico(sale_id);
```

**Lógica de comissão do terapeuta** (em `lib/terapeutas-auth.ts`):
```typescript
// Imposto fixo de 12,85% sobre valor_liquido
imposto = valor_liquido * 0.1285
base    = valor_liquido - imposto
comissao_total      = base * (percentual / 100)
comissao_por_sessao = comissao_total / numero_sessoes
```

**Inferência do número de sessões** pelo nome do produto:
- "8 sess" → 8 sessões
- "4 sess" → 4 sessões
- "2 sess" → 2 sessões
- qualquer outro → 1 sessão

**Tabela de reembolso parcial** (valores fixos por terapeuta):
- Pedro: 1 sessão = R$1.300 · 2 = R$1.550 · 4 = R$2.860 · 8 = R$5.280
- Denise: 1 sessão = R$550 · 2 = R$790 · 4 = R$1.400 · 8 = R$2.640

---

## 5. Configuração Crítica Pós-Schema

### 5.1 Desativar RLS (Row Level Security) — OBRIGATÓRIO

> **Este é o passo mais fácil de esquecer e que trava tudo silenciosamente.**

Projetos novos no Supabase têm RLS ativado por padrão em todas as tabelas. Com RLS ligado e sem policies, todas as queries via `anon key` retornam 0 linhas — sem erros, sem avisos. O app carrega normalmente mas mostra apenas os dados mock do fallback JSON.

**Os webhooks continuam funcionando** (usam `service_role_key` que ignora RLS), mas as telas ficam vazias.

Execute este SQL no **SQL Editor do Supabase** logo após criar as tabelas:

```sql
-- Desativar RLS em todas as tabelas do projeto principal
alter table projects          disable row level security;
alter table products          disable row level security;
alter table sales             disable row level security;
alter table fixed_costs       disable row level security;
alter table variable_costs    disable row level security;
alter table meta_ads          disable row level security;
alter table closings          disable row level security;
alter table cashflow          disable row level security;

-- Desativar RLS nas tabelas do módulo Terapeutas
alter table terapeutas              disable row level security;
alter table usuarios_sistema        disable row level security;
alter table sessoes                 disable row level security;
alter table ocorrencias_prontuario  disable row level security;
alter table atividades_log          disable row level security;
alter table solicitacoes_reembolso  disable row level security;
alter table remarcacoes_historico   disable row level security;
```

### 5.2 Criar o Primeiro Usuário Admin do Módulo Terapeutas — OBRIGATÓRIO

A tabela `usuarios_sistema` começa vazia. Sem um admin cadastrado, a tela `/terapeutas/login` nunca passa. Execute este SQL para criar o primeiro admin:

```sql
-- Senha: spr2026 (SHA256 com salt 'spr-terapeutas-salt-2026')
-- Para gerar outro hash: node -e "const c=require('crypto'); console.log(c.createHash('sha256').update('SUA_SENHA'+'spr-terapeutas-salt-2026').digest('hex'))"
insert into usuarios_sistema (nome, email, senha_hash, tipo, permissoes, ativo)
values (
  'Rafael',
  'rafael@spr.com',
  'c9b71560a8d2432d3e7a57fc4b7d0a6c5e2f8b1234567890abcdef1234567890',  -- substitua pelo hash correto
  'admin',
  '{}',
  true
);
```

**Para gerar o hash correto da sua senha**, rode no terminal (com Node.js):
```bash
node -e "const c=require('crypto'); console.log(c.createHash('sha256').update('SUA_SENHA_AQUI'+'spr-terapeutas-salt-2026').digest('hex'))"
```

### 5.3 Regra de Nomenclatura de Produtos — Módulo Terapeutas

O dashboard e a tela de vendas do módulo Terapeutas filtram automaticamente vendas cujo nome do produto contenha **`Pedro | Denise`**. Este filtro está hardcoded em:
- `app/api/terapeutas/dashboard/route.ts`
- `app/api/terapeutas/vendas/route.ts`

```typescript
.ilike('produto', '%Pedro | Denise%')
```

**Todo produto cadastrado no Kiwify/Hubla que for de terapia deve conter "Pedro | Denise" no nome** para aparecer no módulo. Exemplo: `"Sessão de Terapia - Pedro | Denise - 4 sessões"`.

O número de sessões é inferido pelo nome do produto:
- "8 sess" no nome → 8 sessões agendadas
- "4 sess" no nome → 4 sessões agendadas
- "2 sess" no nome → 2 sessões agendadas
- Qualquer outro nome → 1 sessão

---

## 6. Arquivos de Configuração

### `tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts",
    "**/*.mts"
  ],
  "exclude": ["node_modules", "scripts"]
}
```

O alias `@/*` mapeia para a raiz do projeto. Todo import usa `@/lib/...`, `@/components/...`, `@/types`, etc. **Nunca usar caminhos relativos** (`../../`) no projeto.

### `postcss.config.mjs`
```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

Tailwind v4 usa o plugin PostCSS em vez do arquivo `tailwind.config.js`. Não existe `tailwind.config.js` neste projeto — toda customização vai no `globals.css` com `@import "tailwindcss"`.

### `next.config.ts`
```ts
import type { NextConfig } from "next";
const nextConfig: NextConfig = {};
export default nextConfig;
```

Sem configurações especiais. App Router padrão do Next.js 16.

---

## 7. Variáveis de Ambiente

Crie um arquivo `.env.local` na raiz do projeto:

```env
# ── Supabase ──────────────────────────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# ── Meta Ads API ───────────────────────────────────────────────────────────
META_ACCESS_TOKEN=EAABsbCS...
META_AD_ACCOUNT_IDS=839071654129606,634349981641861,648308663489123,414167410861240,1400409620438158

# ── Webhooks ───────────────────────────────────────────────────────────────
KIWIFY_WEBHOOK_TOKEN=seu_token_kiwify
HUBLA_WEBHOOK_SECRET=seu_secret_hubla

# ── Usuários do sistema (autenticação própria sem Supabase Auth) ───────────
NEXT_PUBLIC_USER1_EMAIL=rafael@spr.com
NEXT_PUBLIC_USER1_PASSWORD=spr2026
NEXT_PUBLIC_USER1_NAME=Rafael
NEXT_PUBLIC_USER1_ROLE=admin

NEXT_PUBLIC_USER2_EMAIL=pedro@spr.com
NEXT_PUBLIC_USER2_PASSWORD=spr2026
NEXT_PUBLIC_USER2_NAME=Pedro Roncada
NEXT_PUBLIC_USER2_ROLE=gestor

# Usuário 3 (opcional)
# NEXT_PUBLIC_USER3_EMAIL=outro@spr.com
# NEXT_PUBLIC_USER3_PASSWORD=senha123
# NEXT_PUBLIC_USER3_NAME=Nome Completo
# NEXT_PUBLIC_USER3_ROLE=financeiro
```

**Onde encontrar cada credencial:**
- `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Painel Supabase → Project Settings → API
- `SUPABASE_SERVICE_ROLE_KEY`: Painel Supabase → Project Settings → API → Service Role (nunca expor no cliente)
- `META_ACCESS_TOKEN`: Meta Business Manager → System Users → token de sistema com permissão `ads_read`
- `META_AD_ACCOUNT_IDS`: IDs das contas de anúncio no Business Manager (sem prefixo `act_`)
- `KIWIFY_WEBHOOK_TOKEN`: Configurado no painel Kiwify ao criar o webhook
- `HUBLA_WEBHOOK_SECRET`: Configurado no painel Hubla ao criar o webhook

---

## 8. Instalação do Zero (Passo a Passo)

### Pré-requisitos
- Node.js 20+
- npm 10+
- Git
- Conta Supabase
- Conta Vercel (para deploy)

### Passo 1 — Clonar o repositório
```bash
git clone https://github.com/darlanrafael/spr-digital.git
cd spr-digital
```

### Passo 2 — Instalar dependências
```bash
npm install
```

### Passo 3 — Configurar variáveis de ambiente
```bash
cp .env.example .env.local  # ou criar manualmente
# Preencher todas as variáveis conforme seção 7 deste documento
```

### Passo 4 — Criar o banco de dados no Supabase
1. Acessar painel Supabase → SQL Editor
2. Copiar e executar o **primeiro bloco SQL** da seção 4 (tabelas principais)
3. Em seguida, executar o **segundo bloco SQL** da seção 4 (tabelas do módulo Terapeutas)
4. Verificar que as 15 tabelas foram criadas na aba Table Editor (8 principais + 7 terapeutas)

### Passo 5 — Popular dados iniciais (opcional)
> **Pré-requisito:** Execute o Passo 5 da seção anterior (desativar RLS) **antes** do seed — caso contrário o script falha silenciosamente pois usa a anon key.
```bash
npx tsx scripts/seed.ts  # popula projetos e produtos de exemplo
```

### Passo 6 — Rodar em desenvolvimento
```bash
npm run dev
# Acesso em http://localhost:3000
```

### Passo 7 — Build de produção
```bash
npm run build
npm run start
```

---

## 9. Deploy na Vercel

### Primeira vez
1. Push para o GitHub (já está em https://github.com/darlanrafael/spr-digital)
2. Acessar vercel.com → Add New Project → importar o repositório
3. Framework: Next.js (detectado automaticamente)
4. Em **Environment Variables**, adicionar todas as variáveis da seção 5
5. Clicar em Deploy

### Atualizar deploy
```bash
git add .
git commit -m "descrição da alteração"
git push origin main
# Vercel faz deploy automático via webhook do GitHub
```

### URLs dos webhooks em produção
Após deploy, configurar nas plataformas:
- **Kiwify:** `https://SEU-DOMINIO.vercel.app/api/webhooks/kiwify?token=KIWIFY_WEBHOOK_TOKEN`
- **Hubla:** `https://SEU-DOMINIO.vercel.app/api/webhooks/hubla`

---

## 10. Autenticação

O projeto usa **autenticação própria via localStorage**, sem Supabase Auth. Isso foi uma decisão deliberada para simplicidade — o sistema tem poucos usuários internos.

**Funcionamento:**
- Credenciais hardcoded via variáveis de ambiente `NEXT_PUBLIC_USER*`
- Login salva o usuário em `localStorage` na chave `spr_session`
- `ProtectedRoute` verifica a sessão; se não houver, redireciona para `/login`
- Logout remove o item do localStorage

**Arquivo:** [lib/auth.ts](lib/auth.ts)

**Papéis disponíveis:**
| Role | Permissões |
|---|---|
| `admin` | Acesso total — pode editar custos, criar fechamentos, ver todos os projetos |
| `gestor` | Acesso restrito ao seu `projetoId` — não pode editar custos |
| `financeiro` | Acesso a todos os projetos mas sem edição de custos |

**Seletor de projeto:** Gestores (`role: 'gestor'`) são automaticamente fixados no `projetoId` configurado na variável de ambiente. Admins e financeiros veem todos os projetos.

> **Limitação conhecida:** O `projetoId` do usuário 2 (gestor) está **hardcoded** como `'proj_1'` diretamente em `lib/auth.ts:26` — não há variável de ambiente para controlá-lo. Se precisar vincular o gestor a outro projeto, editar `lib/auth.ts` diretamente.

---

## 11. Arquitetura de Dados — AppContext

**Arquivo:** [contexts/AppContext.tsx](contexts/AppContext.tsx)

O `AppContext` é o coração do app. Provê estado global para todos os componentes:
- `user` — usuário autenticado
- `selectedProject` — projeto ativo (padrão: `proj_1`)
- `projects` / `products` — lista de projetos e produtos
- `sales` — todas as vendas do projeto selecionado
- `costs` — custos fixos + variáveis + Meta Ads
- `closings` — fechamentos financeiros
- `cashflow` — extrato de caixa
- `isDark` / `toggleTheme` — tema dark/light

**Estratégia de dados:** Ao inicializar, tenta carregar do Supabase. Se falhar ou retornar vazio, usa os arquivos JSON de fallback da pasta `data/`. Isso garante que o app funciona mesmo sem conexão com o banco.

**Reload manual:** `reloadData(projectId?)` recarrega todos os dados do Supabase para o projeto especificado.

---

## 12. Telas e Funcionalidades

### `/` — Dashboard Principal
- **Filtro de período:** Hoje / Ontem / Esta semana / Este mês / Personalizado
- **Cards de métricas:** Faturamento Bruto, Faturamento Líquido, Investimento Meta Ads (busca ao vivo na API Meta), ROAS
- **Detalhamento do faturamento:** por produto ou por plataforma (tabela com impostos e taxas)
- **Custos Fixos:** listagem inline com CRUD (apenas admins podem editar)
- **Custos Variáveis:** lançamento via modal com data
- **Mês de referência dos custos (06/07/2026):** os dois quadrantes (Fixos e Variáveis) compartilham um seletor de mês/ano (`<input type="month">`) que controla o que aparece E pra qual mês um lançamento novo é gravado — pensado pra quando os custos são lançados com atraso (a cada 45-60 dias, por exemplo), permitindo atribuir cada lançamento ao mês certo em vez de tudo cair no "hoje". Custos Fixos deixou de ser um "molde sempre ativo" (coluna `ativo`, sem data) e virou um lançamento por mês, igual Custos Variáveis já era (coluna `data`, dia sempre `01`). Ver seção 4 (schema) e nota técnica abaixo sobre o bug real que isso corrigiu no DRE.
- **Balanço Financeiro:** resultado = Bruto - Impostos - Meta Ads - Fixos - Variáveis (toggle "Sem custos fixos")
- **Aba "Melhores dias e horários":** análise de horários de pico de vendas com comparação entre dois períodos

### `/vendas` — Vendas
- Duas abas: **Aprovadas** e **Reembolsos** (`status` in `reembolsada`/`chargeback`/`cancelada`/`em_protesto`)
- Tabela completa de vendas com filtros de data, plataforma e status (filtros de busca/produto/data só aparecem na aba Aprovadas)
- Busca por nome/email/produto
- **Filtro "Todos os produtos":** lista os nomes reais de produto que aparecem nas vendas (não a tabela `products`/catálogo mock — mesmo bug e mesmo fix da seção `/fechamentos` acima, corrigido em 02/07/2026)
- **Paginação:** 12 linhas por página em cada aba (componente [Pagination.tsx](components/Pagination.tsx)), controles "← Anterior · Página X de Y · Próxima →". Cada aba guarda sua própria página independentemente — trocar de aba não reseta a página da outra. Buscar ou mudar filtro reseta a página das duas abas para 1.
- **Ordenação:** Aprovadas ordena por `data_hora` (data da compra) decrescente. Reembolsos ordena por `data_reembolso` (data do reembolso, **não** a da compra original) decrescente, com fallback pra `data_hora` se `data_reembolso` estiver ausente — uma venda antiga reembolsada hoje aparece no topo. Ver `app/vendas/page.tsx` (`filtered` useMemo).
- Ações: marcar como reembolsada/chargeback/cancelada
- Exportação (pendente)

### `/dre` — DRE Mensal
- Demonstrativo dos últimos 6 meses em colunas
- **Aba DRE:** Receita bruta → Impostos → Taxas plataforma → Receita líquida → Meta Ads → Custos fixos → Outros → Resultado
- **Aba Fluxo de Caixa:** Entradas - Impostos - Meta Ads - Fixos - Variáveis = Saldo final
- Campo "Outros" editável inline por mês (para despesas fora do padrão)
- **Bug corrigido em 06/07/2026:** a linha de Custos Fixos usava sempre o total dos custos fixos "ativos" no momento, igual em TODOS os 6 meses da tabela (não olhava pra data nenhuma, porque Custos Fixos não tinha data até essa correção). Agora filtra por mês (`c.data.startsWith(month)`), igual Custos Variáveis já fazia. Meses anteriores a 07/2026 mostram R$0 em Custos Fixos até que sejam lançados manualmente pra reconstruir o histórico (a migração não pôde inventar valores de meses passados).

### `/fechamentos` — Fechamentos Financeiros
- **Wizard em 4 passos:**
  1. Definir período + produtos incluídos
  2. Calcular faturamento, impostos, taxas, custos
  3. Distribuir entre sócios (percentuais configuráveis)
  4. Confirmar e salvar
- **Produtos incluídos (step 2):** lista de botões com os nomes reais de produto que aparecem nas vendas do projeto (`Array.from(new Set(sales.map(s => s.produto)))`, ordenado). **Não** usa a tabela `products` (catálogo mock antigo, ids `prod_1`/`prod_2`/etc — nunca bate com o texto gravado pelo webhook) — bug corrigido em 02/07/2026, ver seção 13.
- **Histórico:** lista de fechamentos passados com detalhe por produto, sócios e alertas (reembolsos/chargebacks). Quando não há nenhum fechamento real, mostra corretamente "Nenhum fechamento realizado ainda" (ver correção do fallback abaixo).
- **Alertas de reembolso/chargeback no Step 4 (Confirmar):** vêm de `closings[closings.length - 1].alertas` — o último fechamento real. **Cuidado:** antes da correção de 02/07/2026, se `closings` estivesse vazio o app usava o fallback mock (`data/closings.json`, que tem um reembolso fictício de exemplo — "Bruno Ferreira", R$1.497) como se fosse o último fechamento real, e esse valor fictício seria descontado do repasse de um fechamento de verdade. Corrigido — ver seção 18.
- Geração automática de entrada no fluxo de caixa ao confirmar fechamento
- Sócios fixos: `SPR DIGITAL LTDA` e `Pedro Roncada`
- **02/07/2026:** histórico de fechamentos e caixa zerados no Supabase (9 fechamentos + 13 entradas de caixa apagados — eram 1 registro de seed/mock e o resto testes duplicados por clique duplo no botão confirmar). Projeto começou o uso "de verdade" a partir dessa data.
- **Custo de Tráfego (Step 1 — Custos, adicionado em 05/07/2026):** terceiro quadrante ao lado de Custos Fixos e Custos Variáveis. Tem período próprio (início/fim, independente do período de vendas escolhido no Step 2) e um ou mais "termos de filtro" adicionados como chips — o sistema busca o gasto do Meta Ads de toda campanha cujo nome contenha (case-insensitive) qualquer um dos termos digitados, somando ao Total de Custos. Reaproveita `getProjectInvestment()` de `lib/meta.ts` (a mesma função usada no Dashboard), só que aqui os termos vêm do usuário em vez da nomenclatura fixa por projeto. Endpoint novo: `GET /api/meta/custo-trafego?dateStart=...&dateEnd=...&termos=...&termos=...`. O valor é persistido no fechamento (`custos_trafego_total`, `custos_trafego_periodo_inicio/fim`, `custos_trafego_termos`, `custos_trafego_campanhas` — colunas novas em `closings`, migration `20260705_add_custo_trafego_closings.sql`) e aparece no Histórico de Fechamento como uma linha "Custo de tráfego" com o período e os termos usados.
  - **08/07/2026:** a lista "Ver campanhas" pagina em 8 por página (reaproveita `components/Pagination.tsx`, o mesmo componente de Vendas), em vez de listar tudo de uma vez — reseta pra página 1 a cada nova busca. O total de tráfego passou a somar **+13,85%** sobre o gasto bruto retornado pela Meta API (`trafego.total = totalBruto * 1.1385`) antes de entrar no Total de Custos e ser persistido no fechamento.
- **Mês de referência dos custos (Step 1, adicionado em 06/07/2026):** novo seletor "De / Até" em mês/ano no topo do Step 1, antes dos quadrantes de Custos Fixos e Variáveis. Filtra quais lançamentos entram no fechamento (`c.data.slice(0,7)` dentro do intervalo De-Até) — o preview dos dois quadrantes já reflete o período escolhido, antes de avançar pra próxima etapa. **Corrige um bug real:** antes disso, `varTotal` somava TODOS os custos variáveis já lançados no banco, de qualquer mês, sempre — sem filtro nenhum. Agora só entram os lançamentos cujo mês de referência cai no intervalo selecionado (default: mês atual em ambos).
- **Múltiplos períodos por produto (Step 2, adicionado em 08/07/2026):** pensado pro caso de funil perpétuo (ex: imersão toda segunda/terça às 20h, com captação de ingresso pra próxima edição já começando terça, logo depois da imersão anterior) — sem isso, fechar "esta edição" com um único período puxava venda de ingresso da edição seguinte junto. Na tela "Produtos incluídos", botão "+ Adicionar período" cria quantos períodos adicionais quiser, cada um com data início/fim própria e uma lista de produtos atribuídos (um produto só pode estar num período por vez — os chips ficam desabilitados nos outros grupos depois de atribuído). Produtos não atribuídos a nenhum período adicional continuam usando o Período do Fechamento principal. Persistido em `closings.produtos_periodos` (jsonb) e exibido no Histórico de Fechamento.
  - **Como funciona (esclarecido em 08/07/2026 após confusão do usuário):** clicar num produto dentro de um período adicional já atribui na hora — não existe um botão "confirmar"/"lançar" separado, é o mesmo padrão do toggle de "Produtos incluídos". Não há duplicação: o quadro "Produtos incluídos" decide **quais** produtos entram no fechamento; o período (principal ou adicional) só decide **qual data usar** pra cada um — uma venda é contada uma única vez, com a data efetiva certa (`produtoParaGrupo[produto]?.periodo ?? periodo principal`). Produtos com período próprio ganham um ícone de relógio + tooltip no quadro "Produtos incluídos" de cima, pra ficar visível sem precisar rolar até "Períodos adicionais".
  - **08/07/2026 (2ª rodada de ajuste):** a confusão persistiu porque a seleção de produtos usava a convenção "lista vazia = todos incluídos" — todos os chips apareciam destacados mesmo sem nenhuma ação do usuário, dando a impressão de que nada tinha sido "confirmado". Trocado por seleção explícita: todos os produtos vêm marcados (✓) por padrão ao carregar, com botões "Selecionar todos" / "Nenhum" e um resumo ao vivo logo abaixo ("X de Y produtos selecionados · Z vendas encontradas no período") pra dar feedback imediato sem precisar rolar até "Detalhamento de Faturamento". Também corrigido um bug real nessa mesma leva: `periodSales` retornava lista vazia por completo se o Período do Fechamento principal estivesse em branco — mesmo que um produto já tivesse período próprio definido em "Períodos adicionais". Agora cada produto usa seu período efetivo (próprio, se houver; senão o principal) individualmente, então produtos com período próprio funcionam mesmo sem preencher o período principal.
  - **08/07/2026 (3ª rodada — dois bugs reais):** (1) o "Detalhamento de Faturamento" desaparecia por completo da tela sempre que `byProduct` estivesse vazio (0 produtos selecionados, período em branco, ou sem vendas no filtro) — agora a seção **nunca some**, mostra uma mensagem específica explicando qual dos três motivos causou o vazio. (2) Período do Fechamento principal passou a vir preenchido por padrão (1º dia do mês atual até hoje) em vez de vazio. (3) atribuir um produto a um período em "Períodos adicionais" **não** marcava ele em "Produtos incluídos" automaticamente — como é essa lista de cima que decide o que entra no fechamento, o produto ficava com data customizada só que de fora do fechamento, sem aparecer em lugar nenhum. `toggleProdutoNoGrupo` agora adiciona o produto a `selectedProducts` automaticamente ao atribuí-lo a um período (não remove ao desatribuir — isso continua manual, via "Produtos incluídos").

### `/caixa` — Fluxo de Caixa
- Extrato cronológico com saldo acumulado
- Tipos de entrada: `entrada_manual`, `entrada_automatica`, `saida_reembolso`, `saida_manual`
- Lançamentos manuais + entradas automáticas geradas pelos fechamentos

### `/analises` — Análises
- Análises avançadas de performance (métricas consolidadas por período)

### `/terapeutas` — Módulo Terapeutas (submódulo separado)
Sistema independente dentro do mesmo projeto para gestão de atendimentos psicológicos/terapêuticos da SPR Digital.

- **Login próprio** (`/terapeutas/login`) — autenticação via tabela `usuarios_sistema` com senha SHA256
- **Dashboard admin** — métricas de sessões, faturamento, comissões
- **Agenda** — sessões agendadas com status (aguardando/em atendimento/concluída/cancelada/remarcada)
- **Lista de terapeutas** — cadastro com percentual de comissão
- **Vendas** — vendas vinculadas a terapeutas
- **Aprovações** — novas sessões aguardando aprovação admin (badge no header)
- **Admin** — gestão de terapeutas e usuários do sistema
- **Painel do próprio terapeuta (`/terapeutas/[id]`, redesenhado em 05-06/07/2026):** quando quem loga é o próprio terapeuta (sessão `terapeutas_session` com `tipo === 'terapeuta'`), a tela mostra quatro abas próprias — **Overview**, **Vendas**, **Agenda** e **Fechamentos** — espelhando as telas que o CEO já usa (`/terapeutas`, `/terapeutas/vendas`, `/terapeutas/agenda`), só que escopadas para este terapeuta:
  - **Overview:** filtro de período (Hoje/Ontem/7 dias/Este mês/Personalizado) + 5 cards focados na comissão do próprio terapeuta: Sessões vendidas (total), Sessões entregues, Sessões futuras, Faturamento líquido (comissão sobre TODAS as sessões vendidas no período, pagas ou não — campo novo `comissao_total_vendida` em `GET /api/terapeutas/dashboard?terapeutaId=<id>`), e Comissão gerada (entregues e ainda não pagas — some/zera automaticamente depois de um fechamento de comissão). Abaixo, **Consultas de Hoje** (atualiza a cada 60s) com botões Iniciar/Concluir/Anular atendimento do dia — reaproveita o mesmo `PATCH /api/terapeutas/sessoes` e os modais já usados na visão admin. **Sem** Agendar/Remarcar — o terapeuta não mexe na agenda futura, só inicia/conclui o que já está marcado pra hoje. (Os 10 cards "estilo CEO" da primeira versão do redesenho — bruto, SPR 70%, impostos, ticket médio — foram removidos: não fazem sentido pro terapeuta, só pra visão consolidada da empresa.)
  - **Vendas:** filtros de busca/formato/período iguais aos do CEO, com 3 abas — **Pacientes Ativos** / **Concluídos** / **Reembolsados**. Pacientes agrupados por e-mail (não por venda); um paciente é "ativo" se tiver qualquer sessão `pendente`/`agendada` em qualquer uma de suas compras — se um paciente concluído comprar de novo, volta pra "Ativos" automaticamente (recalculado a cada load, sem lógica extra). Colunas iguais à tabela do CEO: Data da compra, Paciente, Qtd. Sessões, Sessões Feitas, Fat. Bruto, Líquido, Vendedor, Progresso, Ver prontuário. "Reembolsados" lista as vendas com status de reembolso/chargeback/cancelamento (mesmas colunas do CEO), sem agrupamento por paciente.
  - **Agenda (novo, 06/07/2026):** calendário mensal (mesmo visual da tela `/terapeutas/agenda` do CEO), mostrando todas as consultas marcadas no mês pra esse terapeuta, com navegação entre meses (← mês anterior / próximo mês →) e um modal de detalhe ao clicar numa consulta (paciente, sessão X de Y, status, data/hora, comissão, link do Meet). Usa os dados já carregados na tela (`sessoes`), sem precisar de um endpoint novo.
  - **Fechamentos (novo, 06/07/2026):** histórico somente leitura dos fechamentos de comissão já confirmados pelo admin (ver abaixo) — cada linha expande mostrando exatamente quais sessões/pacientes compuseram aquele valor.
  - **Prontuário** (mesmo modal usado pelo CEO): dados do paciente (venda mais recente) + histórico de sessões de todas as compras do paciente + ocorrências — **sem** os botões de Iniciar/Concluir/Anular/Remarcar nem pedido de reembolso ali dentro (essas ações de agenda ficaram só na aba Overview, restritas a hoje). **Mantido:** registrar Nota/Observação (reaproveita `POST /api/terapeutas/vendas`).
  - A visão do admin ao inspecionar um terapeuta pela lista (`/terapeutas/lista` → `/terapeutas/[id]`) **não mudou**.
  - Nota técnica: o filtro "Personalizado" do Overview reusa o mesmo formato de data que a tela `/terapeutas` do CEO já usa (`dateEnd + 'T26:59:59.000Z'`) — esse formato é logicamente inválido (hora 26 não existe) e já existia antes desta mudança; funciona para os presets prontos (Hoje/Ontem/7 dias/Este mês), mas o preset "Personalizado" pode não filtrar corretamente. Bug pré-existente, não introduzido agora — sinalizado aqui caso vire prioridade corrigir depois.
- **Fechamento de comissão dos terapeutas (`/terapeutas/fechamentos`, admin, 06/07/2026):** tela nova, separada dos fechamentos financeiros da empresa (`/fechamentos`) — não tem custos fixos/variáveis nem sócios, é só pra pagar a comissão dos terapeutas. Fluxo: escolhe o terapeuta no dropdown (só ativos) → o sistema já busca automaticamente o preview (todas as sessões `entregue` com `comissao_paga = false` desse terapeuta, sem filtro de data — pega tudo que está pendente, mesmo sessão antiga) → soma o total → "Confirmar fechamento" (senha obrigatória) marca essas sessões como pagas e grava um registro em `fechamentos_terapeutas` com o snapshot de cada sessão/paciente incluído (pra auditoria — "de onde saiu essa comissão"). Funciona corretamente mesmo quando o paciente comprou um pacote de várias sessões e só uma foi entregue até agora (cada sessão tem sua própria comissão calculada, então paga só a parte entregue). Endpoint `GET/POST /api/terapeutas/fechamentos`; o POST rejeita com 403 se `usuario_tipo === 'terapeuta'` (só admin/comercial confirma). Depois de confirmado, o card "Comissão gerada" do terapeuta zera automaticamente no próximo carregamento, e o fechamento aparece no histórico tanto da tela do admin quanto na aba "Fechamentos" do próprio terapeuta.

---

## 13. Integrações Externas

### Meta Ads API

**Arquivo:** [lib/meta.ts](lib/meta.ts) | **Rota:** [app/api/meta/insights/route.ts](app/api/meta/insights/route.ts)

- Busca gasto de campanhas via `graph.facebook.com/v19.0`
- Filtra campanhas por **nomenclatura** configurada por projeto: `proj_1` → `['[F01-IRM', '[PF01_RC']`
- Busca em múltiplas contas simultaneamente (IDs em `META_AD_ACCOUNT_IDS`)
- Suporta `date_preset` (today, yesterday, last_7d, this_month) e datas customizadas
- Cache de 300 segundos (`revalidate = 300`)
- O card Meta Ads no dashboard busca ao vivo e tem botão de refresh manual

**Configuração de nomenclaturas:** Editar `PROJECT_NOMENCLATURAS` em `app/api/meta/insights/route.ts` para adicionar novos projetos.

### Kiwify Webhook

**Rota:** `POST /api/webhooks/kiwify`

Eventos tratados:
- `order_approved` → cria venda com status `aprovada`
- `order_refunded` / `chargeback` → atualiza status da venda

Validação de token: aceita SHA1 válida da Kiwify OU token em `?token=` na URL OU header `x-kiwify-token`.

Deduplicação: primeiro tenta pelo `order_id`, depois por `email + produto + plataforma`.

**Como configurar na Kiwify:**
1. Painel Kiwify → Configurações → Webhooks
2. URL: `https://SEU-DOMINIO.vercel.app/api/webhooks/kiwify?token=SEU_TOKEN`
3. Eventos: `order_approved`, `order_refunded`

### Hubla Webhook

**Rota:** `POST /api/webhooks/hubla`

**IMPORTANTE — como a Hubla realmente dispara webhooks em pedidos com order bump (bundle):** ela manda **dois formatos de evento por produto**, descobertos analisando payloads reais em 01-02/07/2026 (ver seção "Histórico de investigação" abaixo):
- **Formato "simples":** `invoice.id` sem sufixo (ex: `2caad2ff-...`). Se a fatura tem múltiplos itens, `invoice.childInvoiceIds` vem preenchido com a lista dos filhos e `amount.subtotalCents` traz a **soma inflada de todos os itens** da fatura — não o valor individual. Esse evento é **ignorado** pelo guard `hasChildInvoices && !hasParentInvoice` (`app/api/webhooks/hubla/route.ts:43-48`), senão gravaria o valor inflado.
- **Formato "offer":** `invoice.id` com sufixo `-offer-N` (ex: `2caad2ff-...-offer-6`), um por item da fatura. `amount.subtotalCents` traz o **valor individual correto** desse item. Esse é o formato autoritativo — usado pra gravar/corrigir a venda.

Eventos tratados:
- `invoice.payment_succeeded` → cria venda (fatura "simples" com filhos é ignorada; cada evento "offer" vira uma linha)
- `invoice.refunded` → atualiza status para reembolsada

Validação: header `x-hubla-token`, `x-hubla-signature` ou `Authorization: Bearer`.

**Chave de deduplicação (`order_id`):** `{canonicalParentId}-{productId}`, onde `canonicalParentId` é o `invoice.id` sem o sufixo `-offer-N`, e `productId` é o `offers[].id` aninhado (`event.products[0].offers[0].id`) quando presente, com fallback pro `product.id` do topo. **Por quê usar o `offers[].id` e não `product.id`:** o mesmo produto-base do catálogo (`product.id`) pode ser vendido como **dois offers diferentes na mesma fatura** (ex: duas cohorts/datas de um mesmo order bump — "Gravação... 13 e 14 Julho"). Usar só `product.id` faz a segunda compra colidir com a primeira e sumir (o código trata a segunda como "correção de valor" da primeira, via `isOfferFormat`, em vez de criar uma linha nova). Bug real encontrado e corrigido em 02/07/2026 — ver histórico abaixo.

`produto` é gravado com `.trim()` — a Hubla às vezes manda `product.name` com espaço no final e às vezes sem, o que duplicava linha na tabela "Detalhamento do Faturamento" antes do trim.

**Como configurar na Hubla:**
1. Painel Hubla → Configurações → Webhooks
2. URL: `https://SEU-DOMINIO.vercel.app/api/webhooks/hubla`
3. Secret: valor de `HUBLA_WEBHOOK_SECRET`

#### Histórico de investigação (02/07/2026) — leia antes de mexer no webhook Hubla de novo

Usuário reportou que quantidade e faturamento líquido não batiam com o painel da Hubla. Investigação (com auditoria fatura-por-fatura contra exports reais da Hubla) encontrou:

1. **Maio/2026 quase todo ausente do banco — não é bug.** O projeto só existe desde 10/06/2026 (primeiro commit do repo) e o webhook só ficou estável em 25/06-30/06. Vendas de maio nunca tiveram webhook pra capturá-las. Em 01/07/2026 alguém importou manualmente um backfill parcial: as 31 vendas de "Mentoria Particular" de 10-31/05 (conferidas, 100% corretas) e as 767 vendas Kiwify do mês inteiro. **Ainda faltam ~51 faturas Hubla de maio** ("O RESGATE" + "Formação de Terapeutas em Restauração de Casamento") nunca importadas.
2. **Junho-julho reconciliam quase perfeito.** Com o webhook estável, comparação fatura-a-fatura de 630 faturas Hubla (01/06 a 01/07) bateu 100% depois dos fixes abaixo.
3. **Bug real encontrado:** colisão de `order_id` quando o mesmo produto-base é vendido 2x como offers diferentes na mesma fatura (ex: fatura do Stenio Reis Pereira, `2caad2ff-10ea-45bd-8bbb-8111fa9524fd`, comprou "Gravação - Imersão A reaproximação" duas vezes com offers distintos — a 2ª sumiu do banco). Corrigido usando `offers[].id` em vez de `product.id` na chave do `order_id` (commit `3454b5d`, 02/07/2026). A venda perdida do Stenio foi inserida manualmente depois da correção.
4. **Bug secundário:** nome de produto sem `.trim()` duplicava linha na tabela por produto quando a Hubla mandava o nome com espaço inconsistente. Corrigido no mesmo commit. 582 linhas históricas da Hubla foram normalizadas (trim) direto no banco.
5. **Kiwify:** `data_hora` é gravado como **hora de Brasília com sufixo `+00:00` (não é UTC real)** — diferente da Hubla, que grava UTC real. Ver `lib/services.ts` (`kiwifyBrtRange` vs `brtDayRangeToUTC`) — qualquer filtro de data manual (fora do app) precisa considerar essa diferença por plataforma, senão sub-conta ou super-conta registros de Kiwify perto da virada do dia.
6. **08/07/2026 — mesmo tipo de bug (#4), agora numa venda Kiwify:** usuário reportou 85 vendas no Fechamento vs 86 na Kiwify pro produto "🥝 O Que fazer Após a traição?  OB - Imersão" (12/05-22/06). Investigação (comparando linha a linha um export xlsx completo da Kiwify contra o banco, por e-mail) achou: a venda de `caiocamelo1988@gmail.com` (20/06/2026 09:43:49, `order_id` Kiwify `OJgVt6k`) **existia no banco**, só que gravada com **um espaço a menos** no nome do produto ("traição? OB" em vez de "traição?  OB") — sobra do backfill manual de 01/07/2026 mencionado no item 1. Isso a fazia aparecer como uma linha própria (qtd. 1) no Detalhamento em vez de somar nas outras 85. Corrigido normalizando o nome dessa linha pra bater com as demais (86 = 86 depois do fix). Varredura em todo `sales` do proj_1 não achou outro caso igual — foi isolado.
7. **08/07/2026 — bug crítico e sistêmico encontrado logo em seguida:** depois de corrigir o item 6, usuário conferiu OUTROS produtos OB contra a Kiwify e nada batia mais (Combo 246 vs 247, Guia prático 149 vs 150, Gravação 106 vs 108) — mesmo com uma sessão 100% nova, sem cache. Causa raiz: `getSales()` (`lib/services.ts`) pagina em lotes de 1000 usando `created_at` como cursor (`created_at < cursor da página anterior`). O backfill de 01/07/2026 inseriu vendas em lote, e **dezenas de linhas compartilham o mesmo `created_at` exato** (confirmado: grupos de até 50 linhas com timestamp idêntico ao milissegundo). Quando o corte de uma página (1000 em 1000) cai no meio de um desses grupos, não existe critério de desempate — o Postgres retorna um subconjunto arbitrário das linhas empatadas, e o cursor da próxima página já avança para além daquele valor, **descartando pra sempre** as linhas do grupo que não vieram na página anterior. Isso não é um bug de UI/cache — afeta `getSales()` diretamente, então **toda tela que lista vendas** (Fechamentos, Vendas, DRE, Dashboard) podia estar sub-contando. **Corrigido** trocando o cursor de `created_at` para `id` (chave única, texto UUID — nunca duplicado), eliminando qualquer possibilidade de empate na paginação. Verificado depois do fix contra o export completo da Kiwify (592 linhas, 4 produtos OB, período 12/05-22/06): os 4 produtos bateram exatamente (antes do fix, 3 dos 4 estavam sub-contados). Commit `a3fb963`.
8. **08/07/2026 — vendas Kiwify em dólar gravadas como se fossem BRL.** Durante a reconciliação, usuário notou que a Kiwify permite checkout em outras moedas (USD) pra clientes internacionais, e o webhook (`app/api/webhooks/kiwify/route.ts`) grava `commissions.charge_amount` e `commissions.my_commission` direto em `valor_pago_cliente`/`valor_liquido` sem nenhuma noção de moeda — não existe coluna de moeda na tabela `sales`. Varredura heurística (`valor_pago_cliente / preco_base < 0.4`, já que `preco_base` = `product_base_price` é sempre o preço de catálogo em BRL e não varia por moeda) achou **27 vendas** entre 18/05 e 20/06/2026 ("Como convencer seu cônjuge", "🥝 Combo: Primeiros Passos da Restauração", "IImersão - A Reaproximação - Oficial") com `valor_pago_cliente` e `valor_liquido` em USD gravados como BRL — confirmado comparando a razão `valor_liquido/preco_base` dessas linhas (~0,15-0,22) contra vendas normais do mesmo produto no mesmo período (~0,78-0,94), e verificando que valores convertidos batem com o padrão doméstico. Não foi possível recuperar o payload original de nenhuma delas (Kiwify só guarda histórico de webhook por 7 dias, e a Kiwify não tem opção de simular venda em dólar na ferramenta de teste). **Corrigido** aproximando o valor original: convertidas as 27 linhas usando a cotação PTAX (Banco Central) do dia de cada venda (compra/venda em fins de semana usa a sexta anterior), aplicada em `valor_pago_cliente`, `valor_com_juros` e `valor_liquido`; `preco_base` não foi alterado (já estava correto). **Blindagem:** o webhook agora loga um `console.warn` (visível nos logs da Vercel) sempre que uma venda Kiwify chegar com essa mesma razão suspeita, pra pegar a próxima ocorrência em tempo real em vez de descobrir meses depois. Ainda em aberto: descobrir o campo de moeda real do payload (só será possível na próxima venda em dólar ao vivo, inspecionando os logs da Vercel).
9. **08/07/2026 — 3 vendas de "Mentoria Particular" atribuídas ao terapeuta errado, e uma conta duplicada da Denise achada no processo.** Usuário identificou (numa planilha própria de acompanhamento de pacientes) que 3 vendas gravadas como produto "Mentoria Particular - Pedro Roncada" (Marianna Cardoso Siqueira Kadamus, Noeli da Silva Ianke, Janayna Walescka de Lima Pereira, 23-25/05/2026) eram na verdade da Denise, não do Pedro sozinho — corrigido o campo `produto` das 3 vendas para "Mentoria Particular - Pedro | Denise" (nome já usado por outras 7 vendas do mesmo combo). Ao lançar as sessões dessas 3 vendas pra Denise em `sessoes`, descoberto um bug separado e mais sério: existem **dois registros na tabela `terapeutas` para a mesma pessoa** — um ativo (`c3d598b0-...`, é o que o login dela em `usuarios_sistema` realmente aponta) e um inativo (`15612d8e-...`, órfão). 3 sessões reais já entregues/agendadas (Gislaine, Fabio Nery, Jaqueline) estavam gravadas com o `terapeuta_id` **inativo** — ou seja, **invisíveis no painel dela**, que consulta pelo id ativo. Corrigido realocando essas 3 sessões pro `terapeuta_id` ativo. Também foram criadas (e depois removidas a pedido do usuário, por serem provisórias/placeholder) 3 sessões novas para Marianna/Noeli/Janayna — o usuário prefere lançar essas 3 manualmente pelo fluxo real de agendamento, com data e horário verdadeiros, em vez de manter os placeholders. Painel da Denise ficou só com as 3 sessões reais pré-existentes (Gislaine, Fabio Nery, Jaqueline). O registro `terapeutas` inativo duplicado (`15612d8e-...`) foi apagado depois de confirmar que não havia mais nenhuma sessão presa nele.
10. **08/07/2026 — `/terapeutas/[id]` tinha dois layouts diferentes: um para a terapeuta logada (redesenho com 5 cards + abas Overview/Vendas/Agenda/Fechamentos) e outro, bem mais antigo e simples (4 cards + tabela plana), para quando o admin/CEO acessava o mesmo perfil.** Usuário notou a diferença ao comparar as duas visões da Denise e pediu pra unificar, espelhando exatamente o que a terapeuta vê. **Corrigido**: removida a view antiga do admin em `app/terapeutas/[id]/page.tsx` (a busca de `vendas`/`ocorrencias`/`remarcacoes`, o Overview via `/api/terapeutas/dashboard`, e o histórico de fechamentos deixaram de ser condicionados a `isTerapeutaSession` — agora carregam sempre, para os dois tipos de sessão). `isTerapeutaSession` continua existindo só pro que é genuinamente diferente: o link "Voltar para lista" (só admin) e o rótulo `usuario_tipo` gravado no log de auditoria (`terapeuta` vs `admin`). Como a tela antiga tinha um "Remarcar" em qualquer sessão (não só as de hoje) que a tela nova não tinha, foi adicionado um botão Iniciar/Concluir/Anular/Remarcar no modal de detalhe da Agenda (clicar num dia) — disponível tanto pro admin quanto pra própria terapeuta, sem duplicar a tabela antiga. De quebra, achado e corrigido um bug pré-existente no filtro "Personalizado" do Overview: a data final gerava `...T26:59:59.000Z` (hora inválida, `26:59:59` não existe), fazendo o Postgres rejeitar a query e os cards silenciosamente zerarem sempre que esse filtro era usado — corrigido calculando o fim do dia em Brasília (23:59:59 BRT = 02:59:59 UTC do dia seguinte).
11. **08/07/2026 — cruzamento da planilha "Resumo Denise ate 01_07.xlsx" do usuário contra o banco achou mais uma fragmentação de nome de produto e uma lacuna real na inferência de quantidade de sessões.** (a) **Samile Francies** (17/06/2026) estava gravada com produto **"Mentoria - Individual Pedro Roncada"** — uma 3ª variação de nome pro mesmo produto de mentoria (além de "Mentoria Particular - Pedro Roncada" e "Mentoria Particular - Pedro | Denise"). Varredura achou **14 vendas** com esse nome fragmentado (12/05 a 04/07/2026); todas normalizadas pra "Mentoria Particular - Pedro Roncada" (o nome canônico do Pedro), e só a da Samile movida em seguida pra "Mentoria Particular - Pedro | Denise" (confirmado pela planilha que é cliente dela). Denise ficou com **11 vendas** no total. (b) A planilha revelou que os pacotes de mentoria têm 1/2/4/8 sessões (códigos "F1 Única", "F/2 Sessões", "F2/4 Sessões", "F3/8 Sessões" — os mesmos valores de `tabelaDenise`/`tabelaPedro` já usados em `calcularReembolso`, `lib/terapeutas-auth.ts`), mas o **nome do produto nunca diferencia isso** — `inferirNumeroSessoes()` só reconhece "2 sess"/"4 sess"/"8 sess" no nome do produto, então sempre assumia 1 sessão pra qualquer venda de mentoria, e a tela de agendar (`app/terapeutas/vendas/page.tsx`) não tinha como sobrescrever isso manualmente. **Corrigido**: adicionado campo "Quantidade de sessões" editável no modal de agendamento (valor inferido continua como sugestão inicial), e `POST /api/terapeutas/sessoes/agendar` passou a aceitar um `numero_sessoes` opcional que, se enviado, tem prioridade sobre `inferirNumeroSessoes()`. Nenhuma sessão tinha sido criada ainda pra essas vendas com contagem errada — o usuário vai lançar manualmente conferindo a planilha.
12. **08/07/2026 — o mesmo bug de data inválida (`T26:59:59`) do item 10 também existia em `app/terapeutas/page.tsx` e `app/terapeutas/vendas/page.tsx`** (cada tela tinha sua própria cópia da lógica de filtro "Personalizado"). Corrigido nos dois com o mesmo cálculo de fim-de-dia-Brasília.
13. **08/07/2026 — produtos de mentoria passaram a não entrar na Reserva de Caixa (30%) do Fechamento.** A pedido do usuário: o lucro de produtos de mentoria (nome contendo "mentoria") vai 100% pro Lucro Real em vez de reservar 30%, já que a comissão do terapeuta é tratada à parte pelo módulo de Fechamentos de Terapeutas. `lucroBruto` (Faturamento líquido − Custos) continua igual; só a base da reserva/divisão 30/70 passou a excluir o `faturamentoLiquido` dos produtos de mentoria, que soma 100% direto no `lucroReal`. Testado: R$43.219,13 de lucro bruto com R$21.624,88 de mentoria → reserva de R$6.478,27 (30% só dos R$21.594,25 restantes) e lucro real de R$36.740,85 — bateu exato.

---

## 14. Lógica de Negócio — Regras Importantes

### Cálculo de impostos
```typescript
// lib/formatters.ts
function getAliquotaByPreco(preco: number): number {
  return preco <= 167 ? 3 : 12.85
}
```
Produtos com preço base até R$ 167 → alíquota 3% (Simples). Acima → 12,85%. A faixa é decidida por `preco_base` (sem juros).

**Base de cálculo do imposto (desde 01/07/2026):**
```typescript
// lib/formatters.ts
function getImpostoBase(sale: Sale): number {
  return sale.valor_com_juros ?? sale.valor_pago_cliente
}
// imposto da venda = getImpostoBase(sale) * (aliquota / 100)
```
O imposto passou a ser calculado sobre o valor **com juros de parcelamento** (não mais sobre `preco_base`/`valor_pago_cliente` sem juros) — só a faixa de alíquota (3%/12,85%) continua decidida pelo `preco_base`. Vendas antigas sem `valor_com_juros` caem no fallback `valor_pago_cliente`.

**Coluna "Líquido Pós-Impostos"** (dashboard, DRE, fechamentos): `valor_liquido - imposto_da_venda`. É diferente da coluna "Fat. Líq. Plataforma" (= soma de `valor_liquido`, sem esse desconto extra) — "Fat. Líq. Plataforma" é o mesmo conceito de "líquido" que a própria Hubla/Kiwify mostra no painel delas; "Líquido Pós-Impostos" desconta em cima disso o imposto simulado da SPR Digital (Simples Nacional), que a plataforma de pagamento não conhece. **Ao comparar números do dashboard com o painel da Hubla/Kiwify, compare com "Fat. Líq. Plataforma", não com "Líquido Pós-Impostos".**

### Faturamento bruto por plataforma
```typescript
function getSaleBruto(sale: Sale): number {
  return sale.plataforma === 'hubla' ? sale.valor_pago_cliente : sale.preco_base
}
```
Kiwify → usa `preco_base`. Hubla → usa `valor_pago_cliente` (porque Hubla já desconta taxas internamente de forma diferente).

### Conversão de timezone

**Isso é diferente por plataforma, e já causou um bug sério — leia antes de mexer aqui de novo.**

- **Hubla** grava `data_hora` em **UTC real**.
- **Kiwify** grava `data_hora` já em **horário de Brasília**, só com o sufixo `+00:00` por convenção — não é UTC de verdade.

`normTs()` (`lib/services.ts`) é quem converte o timestamp bruto do Supabase pro formato usado no app (`Sale.data_hora`). Ela recebe um segundo parâmetro `isKiwify` — só subtrai 3h (UTC→Brasília) quando a venda **não** é Kiwify. Antes de 04/07/2026 essa função aplicava a subtração de 3h em **todas** as vendas, achando que todo `data_hora` era UTC real — isso empurrava qualquer venda Kiwify feita entre **00:00 e 02:59 (horário de Brasília)** pro dia anterior em todo filtro de período (Vendas, Fechamentos, DRE, Análises), fazendo vendas reais sumirem silenciosamente dessas telas. Corrigido no commit `de0faac`.

Esse mesmo cuidado (Hubla = UTC real, Kiwify = BRT-como-UTC) já existia em outro lugar do código (`kiwifyBrtRange` vs `brtDayRangeToUTC` em `lib/services.ts`, usado no filtro de banco de `getSales`) — o bug era especificamente em `normTs()`, que não seguia essa mesma regra.

**Se for mexer em qualquer lógica de data/hora nova:** sempre pergunte "essa venda é Hubla ou Kiwify?" antes de decidir se precisa converter de UTC pra Brasília.

### IDs das entidades
Todos os IDs são strings manuais (`proj_1`, `prod_1`, `sale_001`, `cf_timestamp`, `cv_timestamp`). Não usar UUIDs automáticos para manter controle explícito.

### Sócios do fechamento
Hardcoded em `app/fechamentos/page.tsx`:
```typescript
const SOCIO_NAMES = ['SPR DIGITAL LTDA', 'Pedro Roncada']
```
Percentuais de divisão são configurados manualmente em cada fechamento (padrão 50/50).

---

## 15. Componentes Reutilizáveis

### `Header.tsx`
Navegação top fixa com:
- Logo SPR Digital
- Nav links: Dashboard / Vendas / DRE / Fechamentos / Caixa / Análises
- Seletor de projeto (dropdown)
- Toggle dark/light
- Avatar + logout

Em rotas `/terapeutas/*`, exibe nav alternativa com links do módulo terapeutas. Se o admin acessar terapeutas, aparecem links Admin e Aprovações (com badge de pendências).

### `ProtectedRoute.tsx`
Verifica `getSession()` no localStorage. Se não houver sessão, redireciona para `/login`. Usado em todas as páginas protegidas.

### `MobileNav.tsx`
Barra de navegação inferior para mobile (fixa no bottom).

### `Modal.tsx`
Modal genérico com overlay, título e tamanho configurável (`sm`, `md`, `lg`).

### `PlatformBadge.tsx`
Badge colorido para `kiwify` (verde) ou `hubla` (roxo).

### `BestTimesPanel.tsx`
Análise de melhores horários e dias de venda. Permite comparar dois períodos diferentes.

### `Pagination.tsx`
Componente presentacional puro (sem estado próprio) pra navegação entre páginas: botões "← Anterior"/"Próxima →" (desabilitados nas pontas via prop) + texto "Página X de Y". Props: `currentPage`, `totalPages`, `onPrevious`, `onNext`. Usado em `/vendas` (12 linhas/página, ver seção 12); reutilizável em qualquer lista paginada futura.

---

## 16. Serviços de Dados — `lib/services.ts`

Todas as operações no Supabase passam por este arquivo. Funções principais:

| Função | Descrição |
|---|---|
| `getProjects()` | Lista projetos ativos |
| `getProducts(projectId)` | Produtos do projeto |
| `getSales(projectId, start?, end?, status[])` | Vendas com paginação por cursor (1000/página, `created_at` como cursor — não é offset/`.range()`, ver nota abaixo) |
| `addSale(sale)` | Insere/upsert venda |
| `updateSaleStatus(id, status, dataReembolso?)` | Atualiza status da venda |
| `findSaleByPlatformId(platformId, plataforma)` | Busca por ID da plataforma (deduplicação webhook) |
| `getFixedCosts()` | Custos fixos ativos |
| `addFixedCost(cost)` | Adiciona custo fixo |
| `updateFixedCost(id, patch)` | Edita custo fixo |
| `deleteFixedCost(id)` | Remove custo fixo |
| `getVariableCosts(projectId, start?, end?)` | Custos variáveis filtrados |
| `addCost(cost)` | Adiciona custo variável |
| `getMetaAds(projectId, start?, end?)` | Gastos Meta Ads por mês |
| `upsertMetaAds(projectId, mes, valor)` | Atualiza gasto Meta Ads |
| `getClosings(projectId)` | Fechamentos do projeto |
| `addClosing(closing, projectId)` | Salva fechamento |
| `getCashflow(projectId)` | Extrato de caixa |
| `addCashflowEntry(entry, projectId)` | Adiciona lançamento |

**Paginação de `getSales` — por que é por cursor e não por offset (04/07/2026):** a tabela `sales` recebe inserts o tempo todo via webhook (produção tem ~5000 linhas, ou seja, sempre mais de uma página de 1000). Com paginação por offset (`.range(from, from+999)`), uma venda nova entrando bem no meio de uma busca de várias páginas empurra a ordenação inteira, e uma linha que já existia antes da busca começar pode "cair" entre duas janelas de offset e sumir do resultado — silenciosamente, sem erro nenhum. Isso já causou vendas reais sumirem em Fechamentos/Vendas/DRE. A correção ancora cada página no `created_at` da última linha da página anterior (`WHERE created_at < cursor`), que é imune a esse deslocamento porque não depende de posição numérica — só de um valor real já visto. **Qualquer nova função de busca paginada no projeto deve seguir esse mesmo padrão, não usar `.range()` num range mutável.**

---

## 17. Clientes Supabase — `lib/supabase.ts`

**Dois clientes distintos:**

1. **`getSupabaseClient()`** — usa `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Para leitura no cliente (browser). Singleton.
2. **`getSupabaseAdmin()`** — usa `SUPABASE_SERVICE_ROLE_KEY`. Para operações nos webhooks e APIs server-side que precisam bypassar RLS. Nunca expor no browser.

Se as variáveis de ambiente não estiverem configuradas, `getSupabaseClient()` retorna `null` e o app usa os dados JSON de fallback.

---

## 18. Dados de Fallback (Mock)

A pasta `data/` contém JSONs com dados de exemplo, usados **somente quando o Supabase não está configurado** (`getSupabaseClient()` retorna `null` — sem `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` no ambiente):

- `projects.json` — exemplo: `[{ "id": "proj_1", "nome": "Projeto Principal", ... }]`
- `products.json` — produtos de exemplo por projeto
- `sales.json` — vendas de exemplo
- `costs.json` — custos fixos, variáveis e Meta Ads de exemplo
- `closings.json` — fechamentos de exemplo (inclui um reembolso fictício de "Bruno Ferreira")
- `cashflow.json` — extrato de exemplo

Isso permite rodar o app localmente mesmo sem configurar o Supabase, apenas para visualizar o layout.

**Correção importante (02/07/2026):** até essa data, `contexts/AppContext.tsx` trocava pelo fallback mock **qualquer lista vazia**, mesmo com Supabase configurado e funcionando — não só quando `getSupabaseClient()` era `null`. Resultado: assim que uma tabela real ficasse genuinamente vazia (ex: `closings` depois de um reset de histórico), o app injetava o dado de exemplo como se fosse real — incluindo o fechamento fake de R$28.450 e o reembolso fictício do "Bruno Ferreira" sendo descontado de um repasse real (ver seção 12, `/fechamentos`). Corrigido: o fallback agora só entra quando `getSupabaseClient()` é `null`; uma lista vazia vinda de uma consulta bem-sucedida fica vazia mesmo.

---

## 19. Design e Estilo

**Tema:** Dark mode como padrão. Toggle opcional para light mode.

**Cores principais:**
- Fundo body: `#030712` (gray-950)
- Cards: `bg-gray-900` com `border border-white/10`
- Destaque: `indigo-600` (#6366f1)
- Sucesso/positivo: `emerald-400`
- Erro/negativo: `red-400`
- Texto principal: `text-white`
- Texto secundário: `text-gray-400`

**Tipografia:** System font stack (`-apple-system, BlinkMacSystemFont, Segoe UI, Roboto`).

**Layout:** Max-width `max-w-screen-xl` (1280px), padding `px-4 py-6`.

**Scrollbar:** Customizada via CSS, 6px, thumb `#374151`.

**Responsividade:** Grid adaptativo com breakpoints Tailwind (`md:`, `lg:`). Mobile navigation via `MobileNav.tsx` com barra inferior.

**Nota:** Não usa Tailwind v4 com Turbopack (sem problemas de `grid-cols` aqui), mas se surgir problema de grid, usar `style={{ gridTemplateColumns: 'repeat(N, minmax(0, 1fr))' }}` inline.

---

## 20. Contexto para Futuros Chats

### O que já está pronto
- Dashboard completo com todas as telas funcionando
- Webhooks Kiwify e Hubla com deduplicação, incluindo tratamento correto de order bump/offers da Hubla (seção 13, "Histórico de investigação")
- Imposto calculado sobre valor com juros de parcelamento + coluna "Líquido Pós-Impostos" separada de "Fat. Líq. Plataforma" (seção 14)
- Paginação (12 linhas/página) nas abas Aprovadas/Reembolsos de `/vendas`, com página independente por aba e ordenação por data de reembolso na aba Reembolsos (seção 12)
- Filtro/seleção de produto em `/vendas` e `/fechamentos` usa nomes reais das vendas, não o catálogo mock desatualizado (seção 12)
- Botão "Atualizar dados" no Header, com horário do último carregamento (seção 15, `Header.tsx`)
- Login pelo formulário carrega os dados corretamente (antes ficava vazio até um F5)
- `normTs()` converte timezone corretamente por plataforma (Kiwify não sofre mais a dupla conversão de -3h) e `getSales()` pagina por cursor, não por offset — nenhuma venda desaparece mais de Vendas/Fechamentos/DRE por causa de horário ou paginação (seção 14, "Conversão de timezone" e seção 16)
- Integração Meta Ads API com filtro por nomenclatura de campanha
- Módulo Terapeutas completo (login, agenda, comissões, aprovações)
- Autenticação com 3 papéis (admin, gestor, financeiro)
- DRE mensal automático dos últimos 6 meses
- Fechamentos financeiros com distribuição por sócio
- Fluxo de caixa com lançamentos automáticos e manuais
- Dados mock de fallback para desenvolvimento sem Supabase

### Pendências conhecidas
- **Tabela `products` (catálogo, ids `prod_1`/`prod_2`/etc) está desconectada da realidade** — não corresponde a nenhum produto vendido de fato (esses vêm como texto puro em `sales.produto`, direto do webhook). Hoje só serve de fallback de exibição em alguns lugares (`productMap[s.produto]?.nome ?? s.produto`). Considerar aposentar essa tabela ou repopulá-la com os produtos reais, se algum fluxo futuro precisar dela de verdade (preço/aliquota cadastrados, etc — hoje nada real usa esses campos).
- **~51 faturas Hubla de maio/2026 nunca importadas** ("O RESGATE" + "Formação de Terapeutas em Restauração de Casamento", 10-31/05) — ver seção 13. Mentoria e Kiwify de maio já foram importados e conferidos.
- **Kiwify dias 10-11/05/2026** sem planilha de referência pra conferir (150 vendas no banco, não auditadas linha a linha — provavelmente ok, só não verificado)
- Auditoria fatura-a-fatura da Hubla foi feita só pra 01/06-01/07/2026; não repetida pros outros meses além de maio
- Exportação PDF/Excel das telas
- Relatório de debrief de lançamento
- Adicionar mais usuários sem precisar de redeployment (hoje requer variáveis de ambiente)
- RLS no Supabase (hoje usa service_role_key como bypass)
- Testes automatizados (projeto não tem nenhum framework de teste configurado — verificação é sempre `npm run build` + teste manual)
- Notificações por email em fechamentos

### Comandos úteis
```bash
npm run dev          # Servidor de desenvolvimento em :3000
npm run build        # Build de produção
npm run lint         # ESLint
npx tsx scripts/seed.ts  # Popular banco com dados iniciais
```

### Arquivos mais tocados no dia a dia
- `app/page.tsx` — Dashboard principal (mais complexo)
- `app/fechamentos/page.tsx` — Wizard de fechamentos
- `contexts/AppContext.tsx` — Estado global
- `lib/services.ts` — Queries Supabase
- `app/api/meta/insights/route.ts` — Filtro de campanhas Meta

---

*Documentação gerada em 30/06/2026 com base na leitura completa do código do repositório `darlanrafael/spr-digital`. Revisada e completada com schema de terapeutas, colunas faltantes em `sales`, e arquivos de configuração.*

*Atualizada em 02/07/2026: coluna `valor_com_juros`, imposto sobre valor com juros + "Líquido Pós-Impostos", paginação em `/vendas` (componente `Pagination.tsx`) com ordenação por data de reembolso, e reescrita da seção do webhook Hubla com o mecanismo real de order bump (simples vs. offer) e o histórico da investigação/correção de bugs de 02/07/2026.*

*Atualizada novamente em 02/07/2026: fix do bug de listagem de produtos em `/vendas` e `/fechamentos` (comparava com o catálogo mock `products` em vez do nome real da venda — corrigido nos dois lugares). Histórico de fechamentos e caixa zerados no Supabase (9 fechamentos + 13 entradas de caixa, entre seed e testes duplicados) para começar o uso real a partir desta data.*

*Atualizada em 04/07/2026: corrigido bug crítico em `AppContext.tsx` onde qualquer lista vazia do Supabase (não só quando não configurado) acionava o fallback mock — chegou a injetar um reembolso fictício ("Bruno Ferreira", R$1.497) como dedução real no primeiro fechamento de verdade após o reset do histórico. Ver seção 18.*

*Atualizada novamente em 04/07/2026: botão "Atualizar dados" no Header; fix do login pelo formulário não carregando dados; e os dois bugs mais sérios encontrados até agora — `normTs()` aplicando a conversão de UTC→Brasília também nas vendas da Kiwify (que já vêm em horário de Brasília), fazendo vendas entre 00:00-02:59 sumirem pro dia anterior em todo filtro de período; e `getSales()` paginando por offset (`.range()`) numa tabela que recebe inserts o tempo todo, fazendo vendas já existentes somem aleatoriamente da busca. Os dois corrigidos no commit `de0faac`, confirmados batendo exato com consulta direta no banco. Ver seção 14 e seção 16.*
