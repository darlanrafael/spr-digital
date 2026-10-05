-- Fase 2A - Performance de Funis: identidade de produto + cadastro de funil.

-- Catálogo de produtos (uma linha por produto-base por plataforma).
create table if not exists produtos_catalogo (
  id            uuid primary key default gen_random_uuid(),
  plataforma    text not null,
  produto_id    text not null,
  nome_exibicao text not null default '',
  nomes         text[] not null default '{}',
  project_id    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (plataforma, produto_id)
);

-- Código do produto na venda (null = não capturado; resolve-se pelo nome).
alter table sales add column if not exists produto_id text;
create index if not exists idx_sales_produto_id on sales (plataforma, produto_id);

-- Funil: grupo nomeado de produtos + termos de campanha (vazio = orgânico).
create table if not exists funis (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  project_id      text,
  termos_campanha text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Produtos dentro de cada funil (por par plataforma+produto_id).
create table if not exists funil_produtos (
  funil_id   uuid not null references funis(id) on delete cascade,
  plataforma text not null,
  produto_id text not null,
  primary key (funil_id, plataforma, produto_id)
);
