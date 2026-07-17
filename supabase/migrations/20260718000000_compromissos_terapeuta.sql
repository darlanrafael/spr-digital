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
