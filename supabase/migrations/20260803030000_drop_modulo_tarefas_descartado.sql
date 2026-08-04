-- supabase/migrations/20260803030000_drop_modulo_tarefas_descartado.sql
-- O módulo de Gestão de Tarefas/Projetos (ClickUp-style) foi construído e
-- testado numa branch isolada (feature/modulo-tarefas), mas o usuário
-- decidiu descartar o trabalho (visual não ficou bom). O código já foi
-- descartado junto com a branch; essas tabelas e o bucket de Storage
-- ficaram órfãs no banco (a migration de schema já tinha sido aplicada
-- antes do descarte). Só continham dados de teste.
drop table if exists tarefas_atividades;
drop table if exists tarefas_anexos;
drop table if exists tarefas_comentarios;
drop table if exists tarefas_checklist_itens;
drop table if exists tarefas_tarefas;
drop table if exists tarefas_listas;
drop table if exists tarefas_pastas;
drop table if exists tarefas_projetos;
drop table if exists tarefas_usuarios;

delete from storage.buckets where id = 'tarefas-arquivos';
