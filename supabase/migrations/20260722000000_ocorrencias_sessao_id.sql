-- supabase/migrations/20260722000000_ocorrencias_sessao_id.sql
alter table ocorrencias_prontuario
  add column sessao_id uuid references sessoes(id);

create index if not exists idx_ocorrencias_prontuario_sessao_id
  on ocorrencias_prontuario(sessao_id);
