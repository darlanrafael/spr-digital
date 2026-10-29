-- 27/10/2026 - o botao "Paciente nao compareceu" dava erro pra todo terapeuta.
-- O PATCH /api/terapeutas/sessoes grava status_consulta = 'nao_compareceu'
-- (lib/falta-comissao.ts), mas o check constraint da coluna nunca recebeu esse
-- valor: o update batia em 23514 e a tela mostrava o erro. Nenhuma falta tinha
-- sido gravada no banco ate aqui. Ver item 134 do spr-digital.md.
-- Aplicar com: supabase db query --linked -f <este arquivo> (NUNCA db push).
begin;
alter table sessoes drop constraint sessoes_status_consulta_check;
alter table sessoes add constraint sessoes_status_consulta_check
  check (status_consulta = any (array['aguardando','em_atendimento','concluida','cancelada','remarcada','nao_compareceu']));
commit;
