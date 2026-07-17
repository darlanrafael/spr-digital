# Agenda do Dia por Terapeuta — Design

## Objetivo

A aba Agenda de `/terapeutas/[id]` hoje só tem um calendário de mês (grid
7 colunas, até 3 sessões visíveis por dia + "+N mais"). Pedro Roncada vai
usar essa agenda como sua agenda pessoal do dia inteiro — não só sessões
de paciente, mas também compromissos como almoço, gravação de conteúdo
etc. Ele precisa enxergar o dia por horário, distinguir visualmente
sessão vs. compromisso pessoal vs. horário livre, e lançar um compromisso
pessoal pra travar um horário.

O calendário de mês continua existindo como está — vira só o ponto de
entrada. Clicar num dia abre a nova Agenda do Dia no lugar do que abre
hoje.

Vale pra qualquer terapeuta ativo (não é uma view exclusiva do Pedro).

## Por que

Sem isso, o Pedro não tem onde registrar "não me agende nada das 12h às
13h, é almoço" — e sem essa marcação, o admin/comercial não tem como saber,
olhando a agenda, que aquele horário não está livre pra oferecer a um
paciente. O calendário de mês também não mostra os horários "vagos" —
só sessões existentes, sem noção de quanto do dia está livre pra
encaixe ou venda de sessão avulsa.

## Dados novos

### Tabela `compromissos_terapeuta`

```sql
create table compromissos_terapeuta (
  id uuid primary key default gen_random_uuid(),
  terapeuta_id uuid not null references terapeutas(id),
  titulo text not null,
  inicio timestamptz not null,
  fim timestamptz not null,
  criado_por_nome text not null,
  criado_por_tipo text not null,
  criado_por_email text not null,
  created_at timestamptz not null default now()
);
create index idx_compromissos_terapeuta_id_inicio on compromissos_terapeuta(terapeuta_id, inicio);
```

Sem edição — corrigir um compromisso é apagar e relançar (mesmo padrão
simplificado que o resto do sistema já usa em vez de reinventar um fluxo
de edição só pra isso).

### Coluna nova em `terapeutas`

```sql
alter table terapeutas add column duracao_sessao_minutos int not null default 60;
```

Usada só para desenhar o tamanho do bloco da sessão na timeline (não
existe hoje um horário de término armazenado em `sessoes`, só
`data_agendada`). Pedro = 50, resto = 60 (padrão). Deliberadamente **não**
é inferida pelo nome do terapeuta (produto/nome ambíguo já causou dois
bugs nesta mesma sessão de trabalho) — é um campo direto na tabela.

## Arquitetura

Novo componente `DayView` (dentro de `app/terapeutas/[id]/page.tsx` ou
extraído para `components/`, decisão de implementação) que substitui o
que abre ao clicar um dia no calendário de mês atual. Mantém o padrão já
usado nesta página: busca direto via `getSupabaseClient()` no client.

Dados que o `DayView` precisa, para a data selecionada:
- `sessoes` do dia — já vem do state `sessoes` existente (filtra por
  `data_agendada` caindo no dia), sem query nova.
- `compromissos_terapeuta` do dia — query nova, `eq('terapeuta_id', id)`
  + range do dia.
- `duracao_sessao_minutos` do terapeuta — já disponível em `terapeuta`
  (adiciona ao select existente da página).

Novo endpoint `app/api/terapeutas/compromissos/route.ts`:
- `POST` — cria um compromisso. Body: `terapeuta_id, titulo, inicio, fim,
  usuario_nome, usuario_tipo, usuario_email, senha`. Valida senha via
  `verificarSenhaUsuario` (mesmo padrão de toda ação de escrita do
  sistema — sem checagem extra de "é dono daquele terapeuta_id", o
  sistema inteiro já funciona só com a senha válida em
  `usuarios_sistema`, não vou inventar uma regra nova só aqui).
- `DELETE` — apaga um compromisso por `id`, mesma validação de senha.

## Componentes / UI

### Timeline do dia

- Janela fixa 08:00–21:00, layout de linha do tempo contínua (posição e
  altura do bloco proporcional ao horário/duração exata em pixels — não
  slots discretos de 30min). Blocos de sessão do Pedro (50min) e de outro
  terapeuta (60min) aparecem com a duração real, sem sobra nem falta.
- Estilo: barra de destaque colorida de 3px à esquerda de cada bloco +
  fundo translúcido (sessão = indigo, compromisso = cinza-pedra), sem
  preenchimento sólido pesado. Aprovado no companion visual desta sessão
  ("versão 3").
- Linha vermelha marcando o horário atual — só quando o dia visualizado
  é hoje.
- Trecho sem sessão nem compromisso = horário livre: sem preenchimento
  por padrão; no hover mostra "Xh livre" + botão "+".

### Clique em sessão

Reaproveita o modal `agendaDetalhe` que já existe hoje (ver/iniciar/
concluir/anular/remarcar) — sem mudança de comportamento, só passa a
abrir a partir do bloco na timeline do dia em vez do card do mês.

### Clique em compromisso

Abre confirmação de apagar (senha via `SenhaModal`, mesmo componente já
usado no resto do app). Sem edição (ver "Dados novos" acima).

### Clique em horário livre (hover → "+")

Abre modal "Lançar compromisso": campo `título` (texto, obrigatório) e
`início`/`fim` (datetime, pré-preenchidos com o intervalo do horário
clicado, editáveis). Confirmar pede senha (`SenhaModal`). **Não** oferece
atalho de agendar paciente pendente ali — isso continua exclusivamente
pelo fluxo já existente (Vendas → Pendentes → Agendar).

### Navegação

Dia anterior/próximo com setas (igual à navegação de mês já existente),
mais um jeito de voltar pro calendário de mês (breadcrumb ou botão
"‹ Mês").

## Fora de escopo (YAGNI, explicitamente adiado)

- Compromissos recorrentes (ex: "almoço todo dia às 12h") — cada
  compromisso é um lançamento único.
- Edição de compromisso — apaga e relança.
- Atalho de "agendar paciente pendente" a partir do horário livre —
  fluxo de agendamento continua só pela tela de Vendas.
- Horário de trabalho configurável por terapeuta — janela 08h–21h fixa
  pra todo mundo.
- Visão de dia na página `/terapeutas/agenda` (agenda organizacional, com
  todos os terapeutas de uma vez) — essa spec cobre só a Agenda dentro da
  página individual do terapeuta (`/terapeutas/[id]`).
