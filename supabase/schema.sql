-- ============================================================
-- SPR Digital — Schema Supabase (v2)
-- ATENÇÃO: Use TEXT como PK para manter compatibilidade com
-- os IDs do app (proj_1, prod_1, sale_001, etc.)
-- Execute no SQL Editor do painel Supabase.
-- DROP TABLE incluso para re-execução segura.
-- ============================================================

-- Drop em ordem reversa de dependência
drop table if exists cashflow cascade;
drop table if exists closings cascade;
drop table if exists meta_ads cascade;
drop table if exists variable_costs cascade;
drop table if exists fixed_costs cascade;
drop table if exists sales cascade;
drop table if exists products cascade;
drop table if exists projects cascade;

-- ============================================================
-- Tabela 1: projects
-- ============================================================
create table projects (
  id          text        primary key,
  nome        text        not null,
  descricao   text        not null default '',
  ativo       boolean     not null default true,
  gestor_id   text        not null default '',
  cor         text        not null default '#6366f1',
  created_at  timestamptz not null default now()
);

-- ============================================================
-- Tabela 2: products
-- ============================================================
create table products (
  id          text        primary key,
  project_id  text        not null references projects(id) on delete cascade,
  nome        text        not null,
  plataforma  text        not null,
  preco       numeric     not null default 0,
  aliquota    numeric     not null default 0,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- Tabela 3: sales
-- produto (text) armazena o ID do produto (ex: "prod_1")
-- ============================================================
create table sales (
  id                  text        primary key,
  project_id          text        not null references projects(id) on delete cascade,
  nome                text        not null,
  email               text        not null default '',
  telefone            text        not null default '',
  produto             text        not null,
  plataforma          text        not null,
  preco_base          numeric     not null default 0,
  valor_pago_cliente  numeric     not null default 0,
  valor_liquido       numeric     not null default 0,
  data_hora           timestamptz not null,
  utm_source          text        not null default '',
  utm_medium          text        not null default '',
  utm_campaign        text        not null default '',
  utm_content         text        not null default '',
  utm_term            text        not null default '',
  status              text        not null default 'aprovado',
  data_reembolso      date,
  created_at          timestamptz not null default now()
);

-- ============================================================
-- Tabela 4: fixed_costs (custos fixos são globais, sem projeto)
-- ============================================================
create table fixed_costs (
  id          text        primary key,
  descricao   text        not null,
  valor       numeric     not null default 0,
  ativo       boolean     not null default true,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- Tabela 5: variable_costs
-- ============================================================
create table variable_costs (
  id          text        primary key,
  project_id  text        references projects(id) on delete set null,
  descricao   text        not null,
  valor       numeric     not null default 0,
  data        date        not null,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- Tabela 6: meta_ads
-- ============================================================
create table meta_ads (
  id          uuid        primary key default gen_random_uuid(),
  project_id  text        not null references projects(id) on delete cascade,
  mes         text        not null,
  valor       numeric     not null default 0,
  created_at  timestamptz not null default now(),
  unique(project_id, mes)
);

-- ============================================================
-- Tabela 7: closings (JSONB para socios, compradores, alertas)
-- ============================================================
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

-- ============================================================
-- Tabela 8: cashflow
-- ============================================================
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

-- ============================================================
-- Índices
-- ============================================================
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
