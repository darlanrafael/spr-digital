-- Hoje um custo fixo/variável não tem nenhuma marcação de "já incluído num
-- fechamento" — o Dashboard, o assistente de Fechamento e o DRE filtram os
-- mesmos registros por mês, de forma independente. Isso permite que o mesmo
-- custo continue aparecendo no Dashboard depois de já ter sido pago num
-- fechamento, e até seja incluído duas vezes em fechamentos diferentes se os
-- períodos se sobrepuserem.
--
-- fechamento_id marca em qual fechamento aquele custo foi de fato incluído.
-- NULL = ainda não usado em nenhum fechamento (continua aparecendo no
-- Dashboard e disponível pro próximo fechamento).
alter table fixed_costs
  add column if not exists fechamento_id text references closings(id) on delete set null;

alter table variable_costs
  add column if not exists fechamento_id text references closings(id) on delete set null;

create index if not exists idx_fixed_costs_fechamento on fixed_costs(fechamento_id);
create index if not exists idx_variable_costs_fechamento on variable_costs(fechamento_id);

-- Tabela nova pra persistir o ajuste manual "Outros" do DRE por mês/projeto —
-- hoje esse campo só existe em estado local do React e some ao atualizar a
-- página.
create table if not exists dre_ajustes (
  id          uuid        primary key default gen_random_uuid(),
  project_id  text        not null references projects(id) on delete cascade,
  mes         text        not null, -- formato "YYYY-MM"
  valor       numeric     not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique(project_id, mes)
);
