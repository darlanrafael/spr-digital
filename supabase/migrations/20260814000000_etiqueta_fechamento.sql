-- Etiqueta de identificação do fechamento.
--
-- O histórico lista os fechamentos só por período ("06/07/2026 → 14/08/2026"),
-- e como a operação roda vários funis em paralelo (Imersão, Resgate, Mentoria),
-- períodos parecidos ficam indistinguíveis. A etiqueta é escrita pelo usuário
-- na hora de fechar ("IAR Julho", "Resgate Agosto") e ganha uma cor escolhida
-- por ele, para bater o olho e achar.
--
-- Ambas opcionais: fechamentos antigos continuam válidos sem etiqueta.

alter table closings add column if not exists etiqueta      text;
alter table closings add column if not exists etiqueta_cor  text;

comment on column closings.etiqueta     is 'Nome curto do fechamento, escrito pelo usuário. Ex: "IAR Julho"';
comment on column closings.etiqueta_cor is 'Chave da cor escolhida na paleta: azul, verde, roxo, ambar, rosa, ciano';
