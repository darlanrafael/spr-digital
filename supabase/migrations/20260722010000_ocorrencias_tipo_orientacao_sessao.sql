-- supabase/migrations/20260722010000_ocorrencias_tipo_orientacao_sessao.sql
-- Task 2 descobriu em verificação manual que o check constraint de `tipo`
-- (criado antes das migrations serem versionadas neste repo) não incluía
-- 'orientacao_sessao' — todo insert desse tipo falhava com
-- "violates check constraint ocorrencias_prontuario_tipo_check" em produção.
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
    'orientacao_sessao'::text
  ]));
