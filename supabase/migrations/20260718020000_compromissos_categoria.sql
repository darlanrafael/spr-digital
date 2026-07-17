-- Categoria escolhida no lançamento do compromisso decide a cor do bloco na
-- Agenda do Dia: "sessao" usa a mesma cor das sessões de paciente reais,
-- "compromisso" usa a cor padrão de compromisso pessoal. Não cria linha em
-- `sessoes` — é só uma escolha visual no registro de compromissos_terapeuta.
alter table compromissos_terapeuta
  add column if not exists categoria text not null default 'compromisso'
    check (categoria in ('sessao', 'compromisso'));
