# Ações sem senha para o Pedro — token de sessão do módulo de terapeutas

## Contexto e problema

Hoje **não existe sessão no servidor** no módulo de terapeutas. O
`/api/terapeutas/login` confere e-mail + senha e devolve o usuário; o
`terapeutas_session` fica no `localStorage` e **o servidor nunca o vê**. Não
há `middleware.ts`, cookie nem token em lugar nenhum do projeto.

Por isso cada ação reenvia a senha em texto puro no body, e os 10 endpoints
chamam `verificarSenhaUsuario()` como única trava. A senha não é uma
confirmação em cima de um login — **ela é a autenticação inteira**.

O Pedro atende várias consultas por dia e digita a senha em cada
iniciar/concluir/lançar compromisso, com paciente esperando. Pedido: tirar a
senha das ações dele.

**Por que não basta desligar a checagem:** sem outra prova de identidade, os
endpoints passariam a aceitar qualquer requisição que dissesse
`usuario_email: pedroroncadapr@outlook.com`. São URLs públicas — qualquer um
poderia concluir sessões, remarcar pacientes e apagar compromissos da agenda
dele. Guardar a senha no `localStorage` resolveria a UX sem abrir os
endpoints, mas deixaria em texto puro uma senha que também abre o financeiro.

## Objetivo

O Pedro entra uma vez com e-mail e senha; dali em diante nenhuma ação dentro
do painel dele pede senha. Nada fica sem credencial no servidor.

## Escopo — quem e o quê

**Somente o Pedro.** A Denise (e qualquer usuário futuro) continua exatamente
como está hoje.

Isso é possível sem conflito porque o Pedro, sendo perfil `terapeuta`, já é
travado por duas regras existentes:

- `Header.tsx` dá a ele um header simplificado **sem menu** — ele não navega
  pra fora do próprio painel.
- A aba Fechamentos **não aparece** pra quem tem `percentual_comissao === 0`,
  que é o caso dele.

Ou seja, as telas financeiras não são alcançáveis por ele. "Tudo que o Pedro
faz sem senha" e "financeiro só o Darlan" não se contradizem.

| Aceita token (tudo que o Pedro alcança) | Só com senha digitada |
|---|---|
| `sessoes` PATCH — iniciar, concluir, anular, não compareceu | `aprovacoes` — aprovar/rejeitar reembolso |
| `sessoes/confirmar` | `fechamentos` — pagar comissão |
| `sessoes/agendar`, `sessoes/remarcar` | `vendas/lancamento-manual` |
| `compromissos` POST/DELETE | |
| `vendas` POST/PUT, `vendas/editar-paciente` — prontuário | |

Os três da direita movem dinheiro e só são alcançáveis pelas telas de admin.
Continuam exigindo senha — a do Darlan.

O Pedro segue podendo **solicitar** reembolso parcial pelo prontuário (sem
senha); quem **aprova** é o Darlan, com senha. A separação atual se mantém.

## Modelo de dados

```sql
alter table usuarios_sistema
  add column session_token text,
  add column session_token_expira_em timestamptz,
  add column dispensa_senha_nas_acoes boolean not null default false;

create index idx_usuarios_sistema_session_token
  on usuarios_sistema(session_token);
```

**Token guardado no banco, não assinado (HMAC).** Dois motivos: a verificação
fica idêntica ao que o código já faz (uma consulta na mesma tabela, trocando
`senha_hash` por `session_token`), sem introduzir gestão de secret nova; e
fica **revogável** — apagar a coluna derruba o acesso na hora, útil se a
máquina dele sumir.

`dispensa_senha_nas_acoes` é o que restringe tudo isso ao Pedro. `true` só
pra ele; editável pelo `/terapeutas/admin`, sem deploy.

## Fluxo

1. **Login** (`/api/terapeutas/login`): ao validar a senha, gera
   `crypto.randomUUID()` duas vezes concatenado, grava em `session_token`
   com `session_token_expira_em = now + 7 dias`, devolve no payload.
2. **Cliente**: guarda o token no `terapeutas_session` que já existe.
3. **Ação**: se o usuário tem `dispensa_senha_nas_acoes`, a UI manda `token`
   e **não abre o `SenhaModal`**. Senão, comportamento atual inalterado.
4. **Servidor**: helper novo `verificarAcesso({ usuario_email, senha, token })`
   em `lib/terapeutas-auth.ts`:
   - com `senha` → `verificarSenhaUsuario()`, como hoje;
   - com `token` → busca por `session_token`, exige `ativo = true`,
     `dispensa_senha_nas_acoes = true` e `session_token_expira_em > now`;
   - sem nenhum dos dois → 401.
5. **Expirado**: 401 com `{ error: 'Sessão expirada' }`; a tela limpa o
   `terapeutas_session` e manda pro login.

`verificarSenhaUsuario()` **continua existindo e não muda** — os três
endpoints financeiros seguem chamando ela direto, sem passar pelo helper
novo. Assim é impossível um token virar credencial financeira por descuido.

## Registro de auditoria

`registrarAtividade()` já grava `usuario_nome`/`usuario_tipo` em toda ação, e
isso não muda: o log continua idêntico com ou sem senha. Vale registrar que
o token identifica a mesma linha de `usuarios_sistema` que a senha
identificaria — o "quem fez" no `atividades_log` continua correto.

## Escopo explicitamente fora

- Não mexe no login do dashboard principal (`usuarios_dashboard`,
  `spr_session`) — outro sistema de auth, propositalmente separado.
- Não implementa refresh de token. Expirou em 7 dias, faz login de novo.
- Não implementa RLS nem troca o `service_role_key` — segue como está.

## Riscos

- **Token vazado dá acesso às ações operacionais do Pedro** (concluir
  sessão, remarcar, mexer no prontuário) até expirar ou ser revogado. É uma
  redução de exposição frente às alternativas descartadas, não sua
  eliminação: com senha por ação, um vazamento de senha dá o mesmo acesso
  **mais** o financeiro, e sem expiração.
- **Ordem da migration importa**: `dispensa_senha_nas_acoes` precisa existir
  com `default false` antes do deploy do código, senão a query de token
  quebra pra todo mundo.

## Verificação

Sem framework de teste no projeto. `npm run build` + teste manual, com
usuário descartável antes de tocar na conta real do Pedro:

1. Login do Pedro → `terapeutas_session` tem token; iniciar/concluir/lançar
   compromisso não abre o modal de senha e a ação grava.
2. Login da Denise → tudo continua pedindo senha, exatamente como hoje.
3. `curl` nos 5 endpoints operacionais com o e-mail do Pedro e **sem** token
   nem senha → 401.
4. `curl` em `aprovacoes`/`fechamentos`/`lancamento-manual` com o token do
   Pedro → 401 (token não vale pro financeiro).
5. Token expirado à mão no banco → ação devolve "Sessão expirada" e a tela
   cai no login.
6. `atividades_log` das ações sem senha continua com nome e tipo corretos.
