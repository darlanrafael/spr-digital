# Agenda — Horários Fixos, Preview no Mês, Recorrência e Edição Individual — Design

## Objetivo

Quatro ajustes na Agenda (do terapeuta e do fluxo de agendamento comercial),
levantados depois de usar a Agenda do Dia na prática:

1. Terapeutas com **horário fixo de atendimento** (ex: Pedro) devem ver só
   os horários reais em que atendem, não uma faixa livre contínua.
2. O calendário de mês deve dar um **preview de vagos** em cada dia, sem
   precisar abrir a Agenda do Dia.
3. Lançar um compromisso pessoal **recorrente** (ex: toda sexta 14h,
   gravação de conteúdo) numa tacada só, em vez de repetir manualmente
   toda semana.
4. Na tela de agendar sessões, o comercial precisa **editar o horário de
   uma sessão específica** quando ela sai da regra padrão de 7 em 7 dias
   (raro, mas acontece).

## Por que

- Sem horário fixo, a Agenda do Pedro mostra "livre" em horários que ele
  na prática nunca atende (fora da grade real dele) — informação errada
  pro comercial que consulta isso pra saber se dá pra encaixar alguém.
- Sem preview no mês, o comercial precisa abrir dia por dia pra achar um
  horário vago — lento quando está procurando encaixe rápido.
- Sem recorrência, bloquear "toda sexta às 14h" pelos próximos 2 meses
  significa clicar e confirmar senha 8 vezes.
- A regra de 7 em 7 dias continua sendo o padrão (não muda) — só precisa
  de uma via de escape pontual pra quando a sessão real não cai nela.

## 1. Horários fixos por terapeuta

### Dados

```sql
alter table terapeutas
  add column if not exists horarios_fixos text[] not null default '{}';
```

Formato: strings `"HH:MM"` (ex: `{'09:40','10:30','11:20','12:10','12:40','13:30','14:10','16:00','17:30','18:15','19:00','19:30','20:20','21:10'}`).
Lista vazia (padrão) = comportamento atual, agenda contínua livre — não
muda nada pra Denise nem pra terapeutas futuros até alguém configurar essa
lista. Sem UI de admin por enquanto (mesmo padrão de `vendas_a_partir_de`
e `duracao_sessao_minutos` — ajuste direto no banco; UI de configuração
fica pra depois, se algum dia for preciso trocar com frequência).

Pedro recebe os 14 horários do print anexado pelo usuário nesta sessão de
trabalho.

### Comportamento na Agenda do Dia

Novo prop opcional em `AgendaDiaTerapeuta`: `horariosFixos?: string[]`.

Quando não vazio, a timeline muda de modo:
- **Não** calcula/renderiza intervalos livres contínuos (`livres` some).
- Para cada horário da lista, verifica se alguma sessão ou compromisso já
  ocupa aquele intervalo (`[horário, horário + duracaoSessaoMinutos)`).
  Se sim, o próprio bloco da sessão/compromisso já cobre visualmente
  aquele ponto — nada extra a desenhar. Se não, desenha um marcador
  "livre" na altura exata do horário fixo (não uma faixa livre) — clicável,
  abre o mesmo fluxo de lançar compromisso, com início/fim pré-preenchidos
  nesse horário exato.
- O espaço entre horários fixos fica neutro: sem cor, sem clique — é fora
  da grade de atendimento dele.

Terapeuta sem `horarios_fixos` configurado continua no modo atual
(intervalos livres contínuos, sem mudança nenhuma nesta seção).

## 2. Preview de vagos no card do mês

O grid de mês em `app/terapeutas/[id]/page.tsx` já lista até 3 sessões por
dia + "+N mais". Abaixo disso, uma linha extra de resumo:
- Terapeuta com horário fixo: `"X vagos de Y"` (Y = tamanho de
  `horarios_fixos`, X = quantos desses horários não estão ocupados
  naquele dia).
- Terapeuta sem horário fixo: reaproveita `calcularIntervalosLivres` (já
  existe em `AgendaDiaTerapeuta.tsx`, só precisa ser exportado) somando a
  duração total livre no dia, formatado como `"Xh livre"` (reaproveita
  `fmtDuracao`, também precisa ser exportado).

Isso exige que o cálculo de ocupação (sessões + compromissos do dia)
esteja disponível também na visão de mês — hoje só `sessoes` é usado ali;
`compromissos` (já carregado em `loadData()` pra Agenda do Dia) passa a
entrar no mesmo cálculo pro grid de mês.

## 3. Compromisso recorrente

No formulário "Lançar compromisso": um checkbox "Repetir semanalmente" que,
quando marcado, mostra um campo numérico "Por quantas semanas" (padrão 8,
máximo 52 — trava simples pra evitar lançar anos de compromisso por
engano). O restante do formulário (título, categoria, horário) não muda.

Confirmar com senha uma vez cria todas as ocorrências (mesmo dia da
semana e horário, a cada 7 dias, a partir da data escolhida) numa única
chamada — sem senha repetida por ocorrência. `POST
/api/terapeutas/compromissos` ganha um campo opcional
`repetir_semanas?: number`: quando presente e maior que 1, insere N linhas
em vez de uma, mantendo o restante da lógica de validação idêntica.
Resposta passa a incluir a contagem criada (mensagem final tipo "8
compromissos criados").

Sem checagem de conflito por ocorrência — não há como saber a agenda de
semanas futuras a partir do estado carregado na tela hoje. É só avisado
depois, na mensagem de sucesso, sem bloquear a criação.

## 4. Editar horário individual ao agendar sessões

Em `app/terapeutas/vendas/page.tsx`, o preview "Datas das N sessões" (hoje
texto read-only, calculado de `agendarDataPrimeira` + intervalo de 7 dias)
vira uma lista de campos `<input type="datetime-local">`, um por sessão,
pré-preenchidos com o valor calculado pela regra padrão. O comercial pode
editar qualquer um individualmente antes de confirmar — sem afetar os
demais. Mudar `agendarDataPrimeira` ou a quantidade de sessões recalcula a
lista inteira do zero (perde edições manuais feitas antes disso — aceitável,
é o mesmo tipo de reset que já acontece hoje nesses campos).

`POST /api/terapeutas/sessoes/agendar` ganha um campo opcional
`datas_sessoes?: string[]` (mesmo formato datetime-local de
`data_primeira_sessao`, um item por sessão). Quando presente e com o
tamanho certo, usa essas datas exatas em vez de calcular a sequência de 7
em 7 dias. A regra padrão continua sendo o comportamento quando esse campo
não é enviado — nenhuma mudança pro fluxo atual quando ninguém edita nada.

## Fora de escopo

- UI de admin pra configurar `horarios_fixos` por terapeuta — ajuste
  direto no banco por enquanto.
- Checagem de conflito para compromissos recorrentes.
- Horários fixos variando por dia da semana (ex: segunda diferente de
  sexta) — a lista vale igual todo dia.
