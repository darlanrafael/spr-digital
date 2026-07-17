-- O corte por terapeuta precisa de hora, não só data — "sistema zerado a
-- partir de ontem às 22h30" é diferente de "a partir do dia inteiro de
-- ontem". Também formaliza a regra nova: o corte agora esconde TUDO daquele
-- terapeuta anterior à data em qualquer tela (sessões, pacientes ativos,
-- agenda, overview) — não só as vendas pendentes de agendamento. Histórico
-- antigo continua no banco, só para de aparecer; o paciente é relançado
-- manualmente quando tiver sessão futura marcada de verdade.
alter table terapeutas
  alter column vendas_a_partir_de type timestamptz using vendas_a_partir_de::timestamptz;
