-- 'empurrar_seguintes' (rota /api/terapeutas/sessoes/empurrar-seguintes, Task 9
-- do Diagnóstico Guiado) faltava na allow-list - mesmo problema silencioso já
-- corrigido antes em 20260718010000 e 20260723000000: o insert em
-- atividades_log falha com 23514 (check constraint), registrarAtividade não
-- confere o retorno do insert e a rota não confere o retorno de
-- registrarAtividade, então as sessões são movidas normalmente mas nenhum
-- rastro fica no log de auditoria.
alter table atividades_log drop constraint if exists atividades_log_tipo_acao_check;
alter table atividades_log add constraint atividades_log_tipo_acao_check
  check (tipo_acao = any (array[
    'agendamento', 'remarcacao', 'confirmacao_entrega', 'cancelamento', 'reembolso',
    'cadastro_usuario', 'edicao_usuario', 'desativacao_usuario',
    'iniciar', 'lancamento_manual', 'fechamento_comissao',
    'reembolso_aprovado', 'reembolso_rejeitado', 'nota', 'solicitacao_reembolso',
    'compromisso_criado', 'compromisso_apagado',
    'orientacao_sessao', 'orientacao_sessao_editada', 'paciente_editado',
    'empurrar_seguintes'
  ]));
