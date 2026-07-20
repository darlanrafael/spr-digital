-- Suporte pra automação de lembretes via WhatsApp (n8n + Z-API).
-- grupo_whatsapp_id null = automação desligada pra esse terapeuta até
-- alguém configurar o ID do grupo dele (formato "xxxxxxxxxx-xxxxxxxxxx@g.us").
alter table terapeutas
  add column if not exists grupo_whatsapp_id text;

-- Cada coluna rastreia se aquele tipo específico de lembrete já foi
-- enviado pra aquela sessão — evita mensagem duplicada se o n8n reprocessar
-- ou o cron rodar em cima do horário duas vezes.
alter table sessoes
  add column if not exists lembrete_grupo_vespera_enviado_em timestamptz,
  add column if not exists lembrete_paciente_vespera_enviado_em timestamptz,
  add column if not exists lembrete_grupo_30min_enviado_em timestamptz,
  add column if not exists lembrete_paciente_30min_enviado_em timestamptz;
