-- Sessão de verdade no módulo de terapeutas.
--
-- Até aqui não existia "estar logado" no servidor: o /api/terapeutas/login
-- conferia e-mail + senha e devolvia o usuário, mas o `terapeutas_session`
-- ficava só no localStorage e o servidor nunca o via. Por isso cada ação
-- (iniciar consulta, concluir, lançar compromisso...) reenviava a senha em
-- texto puro no body — a senha não era uma confirmação em cima de um login,
-- ela ERA a autenticação inteira.
--
-- O token abaixo é emitido no login e passa a valer como credencial nas
-- ações operacionais, pro usuário não digitar a senha o dia todo. Guardado
-- no banco (e não assinado tipo JWT) de propósito: a verificação fica igual
-- à da senha (uma consulta nesta mesma tabela, trocando a coluna comparada),
-- sem introduzir gestão de secret nova, e fica revogável — limpar a coluna
-- derruba o acesso na hora se a máquina da pessoa sumir.
alter table usuarios_sistema
  add column if not exists session_token text,
  add column if not exists session_token_expira_em timestamptz;

-- Quem pode agir sem digitar senha. `false` pra todo mundo por padrão: sem
-- esta flag ligada o comportamento continua exatamente o de hoje (senha
-- exigida em toda ação), mesmo que a pessoa tenha um token válido.
-- Ligado só pro Pedro — ver UPDATE no fim deste arquivo.
alter table usuarios_sistema
  add column if not exists dispensa_senha_nas_acoes boolean not null default false;

-- A verificação por token busca pela coluna, não pela PK.
create index if not exists idx_usuarios_sistema_session_token
  on usuarios_sistema(session_token);

-- Pedro Roncada é sócio e atende várias consultas por dia, digitando a senha
-- em cada iniciar/concluir com paciente esperando. Ele é perfil `terapeuta`,
-- então já fica travado no próprio painel (header sem menu) e não enxerga a
-- aba Fechamentos (comissão 0%) — as telas financeiras não são alcançáveis
-- por ele, e os endpoints financeiros continuam exigindo senha de qualquer
-- forma. Ver docs/superpowers/specs/2026-08-06-acoes-sem-senha-pedro-design.md
update usuarios_sistema
   set dispensa_senha_nas_acoes = true
 where email = 'pedroroncadapr@outlook.com';
