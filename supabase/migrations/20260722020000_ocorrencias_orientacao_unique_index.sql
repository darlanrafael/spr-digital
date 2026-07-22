-- supabase/migrations/20260722020000_ocorrencias_orientacao_unique_index.sql
-- Enforces at the DB level that only one 'orientacao_sessao' occurrence can
-- exist per sessao_id, closing the race window left by the app-level
-- check-then-insert in app/api/terapeutas/vendas/route.ts (two near-
-- simultaneous requests could both pass the SELECT before either INSERT
-- completes). Partial index — only rows with tipo = 'orientacao_sessao' are
-- constrained, so 'nota'/'remarcacao'/etc. can still share a sessao_id freely.
create unique index if not exists idx_ocorrencias_prontuario_orientacao_unica
  on ocorrencias_prontuario(sessao_id)
  where tipo = 'orientacao_sessao';
