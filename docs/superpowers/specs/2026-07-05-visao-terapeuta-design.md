# Visão do Terapeuta (`/terapeutas/[id]`) — Design

## Objetivo

Quando quem está logado é o próprio terapeuta (sessão `terapeutas_session`
com `tipo === 'terapeuta'`), a página `/terapeutas/[id]` deve mostrar uma
visão diferente da atual: métricas agregadas, lista de pacientes (ativos
e concluídos) e o prontuário completo de cada paciente — mas **sem**
acesso a ações de agenda (iniciar/concluir/anular/remarcar sessão) nem a
uma listagem detalhada de sessões pendentes soltas.

A visão do admin/CEO ao inspecionar um terapeuta pela lista
(`isTerapeutaSession === false`) **não muda** — continua exatamente como
hoje (tabela de sessões com as ações de agenda).

## Por que

Hoje o terapeuta logado cai na mesma tela que o admin usa para gerenciar
a agenda de qualquer terapeuta (iniciar/concluir/anular/remarcar sessões).
Isso dá ao terapeuta controle sobre agendamento que deveria ficar só com
quem organiza a agenda. O que o terapeuta precisa no dia a dia é
acompanhar quantas sessões vendeu, quantas entregou, quanto já gerou e vai
gerar de comissão, e consultar o prontuário de cada paciente seu — sem
poder mexer em status de consulta ou remarcar.

## Arquitetura

Mantém o padrão já usado nesta página: busca direto via
`getSupabaseClient()` no client, sem endpoint novo. Quando
`isTerapeutaSession` é true, `loadData()` passa a buscar, além das
`sessoes` já buscadas hoje (`eq('terapeuta_id', id)`):

1. `sales` — todas as vendas referenciadas pelos `sale_id` únicos das
   sessões do terapeuta (`nome, email, telefone, produto, plataforma,
   valor_pago_cliente, valor_liquido, data_hora, status`).
2. `ocorrencias_prontuario` — todas as ocorrências dos mesmos `sale_id`s
   (para exibir notas já registradas).
3. `remarcacoes_historico` — todas as remarcações das `sessao_id`s do
   terapeuta (somente para exibição no histórico, leitura).

O POST de nova ocorrência (tipo `nota`) reaproveita o endpoint já
existente `/api/terapeutas/vendas` (aceita `sale_id`, `tipo: 'nota'`,
`titulo`, `descricao`, `senha`, `usuario_*` — não depende do filtro de
produto do GET, então funciona para qualquer sale_id).

## Componentes / UI

### 1. Cards de métricas (topo)

Substituem os 4 cards atuais por 5:

| Card | Cálculo |
|---|---|
| Sessões vendidas | `sessoes.length` (todas as sessões do terapeuta, qualquer status) |
| Sessões entregues | `sessoes.filter(s => s.status === 'entregue').length` (já existe) |
| Sessões futuras | `sessoes.filter(s => s.status === 'pendente' \|\| s.status === 'agendada').length` (já existe) |
| Comissão gerada | soma de `comissao_valor` das entregues não pagas (já existe) |
| Comissão futura | soma de `comissao_valor` das futuras não pagas (já existe) |

### 2. Agrupamento por paciente

```ts
type PacienteAgrupado = {
  email: string
  nome: string
  saleIds: string[]
  sessoes: Sessao[]              // todas as sessões de todas as vendas deste paciente
  ativo: boolean                  // true se QUALQUER venda tiver sessão pendente/agendada
}
```

Construído a partir de `sessoes` (já filtradas por `terapeuta_id`),
agrupando por `paciente_email`. Um paciente é **ativo** se pelo menos uma
de suas sessões tem status `pendente` ou `agendada`; caso contrário é
**concluído** (todas entregues, ou entregues+canceladas). Isso já
resolve naturalmente o caso "paciente concluiu e comprou de novo": a
nova venda cria novas sessões com status `pendente`, então o paciente
volta a ter uma sessão não-finalizada e reaparece em "Ativos" — mesmo
agrupamento, recalculado a cada load.

### 3. Abas "Pacientes ativos" / "Concluídos"

Duas listas simples (cards ou linhas), cada uma mostrando por paciente:
nome, e-mail, "X de Y sessões entregues" (soma de todas as vendas dele),
e botão "Ver prontuário".

### 4. Modal de prontuário (reaproveitado, restrito)

Mesma estrutura visual do modal em `app/terapeutas/vendas/page.tsx`
(Seção 1 — Informações do paciente; Seção 2 — Histórico de sessões;
Seção 3 — Ocorrências), mas:

- Se o paciente tiver mais de uma venda (`saleIds.length > 1`), a Seção
  2 mostra o histórico de sessões de TODAS as vendas dele juntas,
  ordenado por data da venda e depois número da sessão — não só de uma
  venda isolada. Seção 1 (dados do paciente) mostra os dados da venda
  mais recente.
- **Removido**: botões "Iniciar consulta", "Concluir consulta", "Anular
  sessão", "Remarcar" dentro do histórico de sessões.
- **Mantido**: histórico de remarcações já feitas (somente leitura, sem
  botão de ação).
- Seção 3 (Ocorrências): mantém a opção "Nota / Observação" (com senha,
  igual ao fluxo atual). **Removidas** as opções "Remarcar Consulta" e
  "Solicitação de Reembolso Parcial" — ficam fora do escopo do
  terapeuta.

### 5. O que é removido da tela atual

- A tabela de sessões com colunas Data agendada / Ações.
- Os botões Iniciar / Concluir / Anular / Remarcar (em qualquer lugar
  da tela do terapeuta).
- Qualquer listagem solta de sessões pendentes fora do agrupamento por
  paciente.

## Casos de borda

- Paciente com todas as sessões `cancelada` (nenhuma entregue, nenhuma
  pendente) → conta como "concluído" (não há nada pendente de ação).
- Paciente sem nenhuma sessão `pendente`/`agendada` mas com uma venda
  recente sem sessões ainda geradas → não aparece (esta tela só agrupa
  a partir de `sessoes` existentes; sessões são criadas em outro fluxo
  já existente, fora de escopo aqui).
- Dois pacientes com o mesmo nome mas e-mails diferentes → tratados
  como pacientes distintos (agrupamento é por e-mail).
- Registrar nota continua exigindo senha (via `SenhaModal`), igual ao
  padrão já usado em todo o módulo de terapeutas.

## Fora de escopo

- Não altera a página `/terapeutas/vendas` (visão do CEO) nem o
  endpoint `/api/terapeutas/vendas` GET.
- Não altera a visão do admin ao inspecionar um terapeuta pela lista
  (`/terapeutas/lista` → `/terapeutas/[id]` sem sessão de terapeuta).
- Não cria uma tabela normalizada de "pacientes" — continua usando
  `paciente_email`/`paciente_nome` denormalizados em `sessoes`, como já
  é feito em todo o módulo hoje.
- Não muda a navegação (`MobileNav`) — o terapeuta já é redirecionado
  para `/terapeutas/[id]` por qualquer outra rota, então os demais
  itens do menu nunca são realmente acessados por ele.
