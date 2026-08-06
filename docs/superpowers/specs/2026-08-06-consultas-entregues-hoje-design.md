# Consultas Entregues (hoje) no Overview do Terapeuta — Design

## Contexto e problema

O Overview de `/terapeutas/[id]` tem dois quadrantes: **Consultas de Hoje** e
**Próximas Consultas**. Ambos vêm de `/api/terapeutas/dashboard` e filtram
`status in ('agendada','pendente')`.

Consequência: no instante em que o terapeuta clica em "Concluir", a sessão
vira `status = 'entregue'` e **desaparece** de Consultas de Hoje. No fim do
dia o quadro fica vazio, como se ninguém tivesse sido atendido. Não existe
nenhuma tela onde o terapeuta veja o que ele já entregou no dia.

O filtro foi deliberado (comentário em `dashboard/route.ts`: *"Já entregue
não precisa mais de ação hoje — só polui a lista com linhas sem nada a fazer
além de Anular"*). O problema não é o filtro — é a falta do outro lado da
moeda.

Sintoma colateral: o botão "Anular" em `app/terapeutas/[id]/page.tsx` só
renderiza quando `status === 'entregue'`, mas a API nunca devolve linha
entregue naquela lista. É código morto desde que o filtro entrou.

## Objetivo

Um terceiro quadrante, **Consultas Entregues — hoje**, posicionado entre os
dois existentes:

```
Consultas de Hoje (3)              ← agendada/pendente, hoje
Consultas Entregues — hoje (5)     ← NOVO
Próximas Consultas (12)            ← agendada/pendente, depois de hoje
```

Mesmo layout de card/tabela dos outros dois — nada de padrão visual novo.

## Critério de "entregue hoje"

**União de dois critérios**, deduplicada por `id`:

- **(a)** `data_agendada` cai hoje **e** `status = 'entregue'` — o espelho
  exato de Consultas de Hoje: o que estava lá de manhã e foi concluído ao
  longo do dia.
- **(b)** `data_entrega` cai hoje **e** `status = 'entregue'` — inclui a
  regularização retroativa (sessão antiga lançada manualmente com data de
  entrega informada à mão).

Nenhum dos dois sozinho basta: (a) perde o lançamento retroativo, e (b)
perde a sessão atendida hoje cuja `data_entrega` foi informada com outra
data. Ambos os intervalos usam `brasiliaStartUTC`/`brasiliaEndUTC`, os
mesmos helpers já usados no quadrante de hoje.

Ordenação: `data_entrega` decrescente — o atendimento mais recente primeiro,
que é a leitura natural de "o que eu já fiz hoje".

## Mudanças na API — `app/api/terapeutas/dashboard/route.ts`

1. `SessaoHojeRow` ganha `data_entrega` e `entregue_confirmado_por`; os três
   `.select()` de sessão passam a trazer essas colunas (o mapper é
   compartilhado, então todos precisam).
2. Duas queries novas, (a) e (b), com os mesmos filtros de `sale_id in
   saleIds` e `terapeuta_id` já aplicados nas outras — sem isso, sessão
   pré-corte de `vendas_a_partir_de` reapareceria aqui depois de ter sumido
   do resto da tela.
3. Merge por `id` num `Map`, ordenação por `data_entrega` desc.
4. `mapSessaoHoje` ganha dois campos derivados: `entregue_as` (hora em
   Brasília, ou `—`) e `entregue_confirmado_por`.
5. Resposta ganha `consultas_entregues_hoje`.

## Mudanças na tela — `app/terapeutas/[id]/page.tsx`

- Tipo `ConsultaHoje` ganha `data_entrega`, `entregue_as`,
  `entregue_confirmado_por` — todos opcionais, porque os outros dois
  quadrantes usam o mesmo tipo e não trazem esses campos.
- Estado `ovConsultasEntreguesHoje`, alimentado tanto no `loadOverview()`
  quanto no auto-refresh de 60s (os dois lugares — senão o quadro novo
  congela enquanto os outros atualizam).
- Bloco novo entre os dois existentes, copiando a estrutura de card e tabela
  de Próximas Consultas. Ícone `CheckCircle` verde, seguindo a cor que o card
  "Sessões entregues" já usa.

Colunas: **Horário · Paciente · Entregue às · Duração · Confirmado por ·
Ações**.

Fora "Link Meet" (link de consulta que já acabou não serve pra nada) e
"Status Consulta" (seria sempre "Concluída" — a coluna não distinguiria
nada). No lugar entram os dados que só fazem sentido aqui: a que horas foi
entregue, quanto durou, e quem confirmou (terapeuta, comercial ou admin).

### Duração — decisão deliberada de deixar vazia

`Duração` é o intervalo entre `iniciado_em` e `concluido_em`: o tempo entre
clicar "Iniciar consulta" e "Concluir consulta". Quando um dos dois falta,
mostra `—`.

Isso deixa a coluna vazia na maioria das linhas hoje, e é intencional. Nos
dados reais, **2 de 81** sessões entregues do Pedro têm `iniciado_em` — o
botão "Iniciar" quase nunca é usado, vão direto pro "Concluir". As duas que
têm marcam 1 minuto (os dois cliques em seguida).

As alternativas foram descartadas por serem mentira estatística:
`duracao_sessao_minutos` do cadastro (50 min) encheria a coluna com uma
constante, e o fallback "real, senão cadastrada" misturaria medição com
estimativa sem o leitor conseguir distinguir. Coluna vazia é informação —
diz que o cronômetro não está sendo usado.

Ações: ver prontuário + **Anular**. É o que ressuscita o botão morto — ele já
existe e já está escrito pra `status === 'entregue'`, só nunca tinha uma
lista onde aparecer.

## Paginação de Próximas Consultas (mudança acoplada)

O mesmo Overview tinha um problema mais sério que o scroll: a query de
Próximas Consultas terminava em `.limit(20)`. O Pedro tem **104 sessões
futuras** — 84 delas nunca chegavam na tela, sem nenhum aviso. Um corte
silencioso lê como "só tenho 20 consultas marcadas".

- `.limit(20)` **removido** da query. A lista vem inteira.
- A tela pagina de **8 em 8** com o `Pagination.tsx` já existente (mesmo
  componente de `/vendas` e `/fechamentos`), e o contador do título continua
  mostrando o **total** (104), não a página.
- `currentPage` é clampado contra `totalPages`, seguindo o padrão de
  `/vendas`: o auto-refresh de 60s pode encurtar a lista (uma consulta vira
  entregue e sai daqui) sem passar por reset de página, o que deixaria a
  tela numa página inexistente.

O quadrante de entregues **não** é paginado — um terapeuta não entrega
dezenas de sessões num dia.

## Escopo explicitamente fora

- Não mexe no filtro de status de Consultas de Hoje nem de Próximas
  Consultas.
- Não altera período: o quadrante é sempre "hoje", independente do filtro de
  preset do Overview — igual aos outros dois.

## Verificação

O projeto não tem framework de teste. Verificação é `npm run build` +
conferência manual na tela com dados reais:

1. Concluir uma sessão agendada pra hoje → some de Consultas de Hoje e
   aparece em Consultas Entregues, com a hora certa. (critério **a**)
2. Anular pelo quadrante novo → volta pra Consultas de Hoje.
3. Concluir uma sessão **antiga** (agendada semanas atrás) informando data de
   entrega = hoje → aparece no quadrante. (critério **b**)
4. Concluir uma sessão antiga informando data de entrega **de outro dia** →
   não aparece em lugar nenhum do Overview de hoje. É trabalho de outro dia.
5. Sessão agendada pra hoje e concluída com data de entrega retroativa →
   aparece **uma vez só**, não duplicada (bate nos dois critérios).
6. Terapeuta sem nenhuma entrega hoje → estado vazio, sem quebrar layout.
7. Próximas Consultas: título mostra o total (104), tabela mostra 8, e o
   rodapé "Página 1 de 13". Navegar até a última página chega na consulta
   mais distante — nada some.
8. Terapeuta com 8 futuras ou menos → paginação não aparece.
