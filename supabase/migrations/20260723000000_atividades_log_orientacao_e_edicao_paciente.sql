-- orientacao_sessao/orientacao_sessao_editada (feature de 22/07) e
-- paciente_editado (edição de dados do paciente no prontuário) faltavam na
-- allow-list — mesmo problema silencioso já corrigido antes em
-- 20260718010000_expand_atividades_log_tipo_acao.sql: o insert falha sem
-- quebrar a ação, só sem deixar rastro de auditoria.
alter table atividades_log drop constraint if exists atividades_log_tipo_acao_check;
alter table atividades_log add constraint atividades_log_tipo_acao_check
  check (tipo_acao = any (array[
    'agendamento', 'remarcacao', 'confirmacao_entrega', 'cancelamento', 'reembolso',
    'cadastro_usuario', 'edicao_usuario', 'desativacao_usuario',
    'iniciar', 'lancamento_manual', 'fechamento_comissao',
    'reembolso_aprovado', 'reembolso_rejeitado', 'nota', 'solicitacao_reembolso',
    'compromisso_criado', 'compromisso_apagado',
    'orientacao_sessao', 'orientacao_sessao_editada', 'paciente_editado'
  ]));
