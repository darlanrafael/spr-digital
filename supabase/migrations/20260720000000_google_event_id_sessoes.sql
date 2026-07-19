-- Id do evento no Google Calendar por sessão — necessário pra cancelar o
-- evento certo quando a sessão é remarcada (cancela + cria de novo, não
-- só atualiza o horário do existente).
alter table sessoes
  add column if not exists google_event_id text;
