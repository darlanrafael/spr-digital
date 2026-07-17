-- Corte de data por terapeuta: vendas anteriores a essa data param de contar
-- automaticamente (Pendentes de Agendamento, métricas de faturamento/sessões
-- vendidas no Overview) — usado quando um terapeuta tem um histórico grande
-- demais pra reconciliar 1:1 contra o sistema (ex: Pedro, calendário já em
-- andamento fora daqui). Pacientes anteriores ao corte são lançados
-- manualmente (venda + sessões) em vez de reaproveitar a venda antiga
-- importada, evitando duplicidade. NULL = sem corte, comportamento normal.
alter table terapeutas
  add column if not exists vendas_a_partir_de date;
