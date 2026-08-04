-- supabase/migrations/20260803020000_ocorrencias_tipo_nao_compareceu.sql
-- Adiciona 'nao_compareceu' ao check constraint de `tipo`, para a nova ação
-- "Não compareceu" (Overview + Prontuário) poder registrar a ocorrência.
alter table ocorrencias_prontuario
  drop constraint ocorrencias_prontuario_tipo_check;

alter table ocorrencias_prontuario
  add constraint ocorrencias_prontuario_tipo_check
  check (tipo = any (array[
    'nota'::text,
    'remarcacao'::text,
    'confirmacao_entrega'::text,
    'solicitacao_reembolso'::text,
    'reembolso_aprovado'::text,
    'reembolso_rejeitado'::text,
    'orientacao_sessao'::text,
    'nao_compareceu'::text
  ]));
