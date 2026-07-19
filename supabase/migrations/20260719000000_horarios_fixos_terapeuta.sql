-- Lista de horários fixos de atendimento por terapeuta (ex: Pedro atende só
-- em horários específicos do dia, não numa faixa livre contínua). Vazio
-- (padrão) = comportamento atual, sem mudança nenhuma — a Agenda do Dia só
-- entra no modo "horário fixo" quando essa lista tem pelo menos 1 item.
alter table terapeutas
  add column if not exists horarios_fixos text[] not null default '{}';
