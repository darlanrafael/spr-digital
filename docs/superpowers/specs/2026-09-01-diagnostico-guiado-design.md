# Diagnóstico Guiado - design

**Data:** 01/09/2026
**Status:** aprovado pelo usuário, pronto para implementação

## O que é

Produto novo, já vendendo. Um programa de acompanhamento individual entregue em
sessões divididas entre **dois** terapeutas: o Pedro faz as primeiras, a Denise
faz o restante. Três formatos:

| Formato | Preço de catálogo | Sessões | Pedro | Denise |
|---|---|---|---|---|
| 1 | R$ 4.997,00 | 9 | 1ª e 2ª | 3ª a 9ª |
| 2 | R$ 2.497,00 | 4 | 1ª | 2ª a 4ª |
| 3 | R$ 1.697,00 | 2 | 1ª | 2ª |

O Pedro **sempre** começa. As sessões ficam a 7 dias uma da outra, sem exceção,
inclusive na virada do Pedro para a Denise.

Quatro vendas já existem (3 no Formato 1, 1 no Formato 3), todas na Hubla,
esperando agendamento. São 29 sessões: 7 do Pedro e 22 da Denise.

## Por que quebra o modelo atual

O sistema hoje assume **um terapeuta por venda**. `POST /api/terapeutas/sessoes/agendar`
recebe um `terapeuta_id` e cria as N sessões todas com ele.

E encontra as vendas de cada terapeuta pelo **nome dele dentro do nome do
produto**:

```ts
.ilike('produto', `%${primeiroNome}%`)
```

Isso funciona para "Mentoria Particular - **Pedro** Roncada". O Diagnóstico se
chama "Diagnóstico Guiado: Programa de acompanhamento Individual" e não tem o
nome de ninguém, então **nunca apareceria em Pendentes de Agendamento**. Foi
por isso que alguém recorreu ao lançamento manual para a Rafaela: era o único
jeito de fazer o pacote aparecer.

## Identificação: pela OFERTA, nunca por preço ou nome

Decisão do usuário, e ela é a base de tudo.

**Por que não o nome:** os três formatos têm nome idêntico na Hubla.

**Por que não o preço:** `valor_pago_cliente` varia com parcelamento e juros. Nas
vendas reais: Francisco pagou R$ 6.201,72 e Bruno R$ 4.997,00 no mesmo formato.
O `preco_base` é estável hoje, mas cupom ou promoção o quebram.

**A oferta é estável.** Na Hubla o `order_id` é `{idDaFatura}-{idDaOferta}`:

| Oferta | Formato |
|---|---|
| `WXwmPZfJxGqeXerA6dkO` | 1 |
| `qVvads7GKaI7lN1Kctrr` | 3 |
| *a descobrir* | 2 |

**Oferta desconhecida deste produto não vira palpite.** A venda fica pendente com
um aviso pedindo a associação. O Formato 2 ainda não vendeu; na primeira venda o
sistema pede o vínculo e o usuário associa uma vez.

A tabela aceita **vários IDs por formato**: uma oferta nova (promoção, outra
turma) nasce com ID diferente e precisa caber sem trocar código.

## Módulo

`lib/diagnostico-guiado.ts`, puro e testável:

- `formatoDaVenda(sale)` → `{ formato, totalSessoes, sessoesPedro } | null`
- `montarPacote({ formato, primeiraDataISO, terapeutas })` → lista de
  `{ numero_sessao, terapeuta_id, data_agendada, comissao_valor }`

Nada de I/O. Recebe a venda e devolve o pacote. É o que os testes exercitam.

## Agendamento: uma tela, uma ação

A venda aparece em **Pendentes de Agendamento do Pedro**, marcada como pacote
conjunto. Ele sempre começa, então é o lugar natural. Na tela da Denise o
paciente só aparece depois de agendado, já com as sessões dela.

O comercial informa **uma data**. O sistema cria o pacote inteiro: terapeuta
certo em cada sessão, 7 dias entre todas.

**Conflito é checado por sessão, contra a agenda do terapeuta daquela sessão.**
Hoje `buscarConflitosAgenda` recebe um `terapeuta_id` e valida todas as datas
contra ele; passa a receber pares `{terapeuta_id, dataISO}`.

**Tudo ou nada.** Qualquer conflito recusa o pacote inteiro, sem criar nada.
Agendar metade deixaria um pacote quebrado que alguém precisa lembrar de fechar
Esse é o comportamento que a rota já tem hoje e que se mantém.

## Pagamento da Denise: R$ 95,00 por sessão

Regra **do produto**, não da terapeuta. Nos demais produtos ela segue com os 30%
cadastrados. Assim um produto novo amanhã pode ter outro valor sem mexer no
cadastro dela.

Grava em `sessoes.comissao_valor`, como já acontece hoje, então o fechamento de
comissão não muda.

O Pedro fica em zero, por ser sócio.

## Prontuário

O prontuário já agrupa por e-mail e mostra as sessões de todas as compras do
paciente. O Diagnóstico entra como **mais um bloco**, identificado pela etiqueta,
ao lado das compras anteriores da mesma pessoa. Histórico clínico único, que é o
que interessa a quem atende.

Vale para quem já comprou avulsas antes: nada é separado, só identificado.

## Etiqueta

Mostrando formato e posição: **"Diagnóstico Guiado · Formato 1 · sessão 3 de 9"**.

Em cinco lugares, todos pedidos pelo usuário:

1. Agenda de cada terapeuta
2. Prontuário do paciente
3. Lista de pacientes do comercial
4. Mensagem de WhatsApp do lembrete
5. Tela de atendimentos do dia e do dia seguinte

## Remarcação

Ao remarcar uma sessão do meio, o sistema **avisa que o intervalo de 7 dias vai
quebrar** e oferece as duas saídas:

- mover só aquela sessão
- empurrar as seguintes, mantendo a régua

O comercial decide. Não há default silencioso, porque as duas escolhas têm custo real:
uma quebra o intervalo terapêutico, a outra mexe em consultas já combinadas com
o paciente.

## Testes

Módulo puro com teste próprio, no padrão dos criados em 13/08 (`npm test`,
runner nativo do Node via `tsx`, sem dependência nova).

Cobertura mínima:

- os três formatos montam a quantidade certa de sessões
- o Pedro pega sempre as primeiras, a Denise o resto
- 7 dias entre todas, inclusive na virada de terapeuta
- a Denise recebe R$ 95,00 por sessão dela e o Pedro zero
- oferta desconhecida devolve `null` em vez de adivinhar
- venda sem `order_id` (lançamento manual) devolve `null`
- as quatro vendas reais que já existem, como casos nomeados

Os casos reais valem mais que os sintéticos: se alguém quebrar a regra, o teste
falha com o nome do paciente.

## O que fica de fora

- **Lançamento manual continua existindo.** Serve ao caso original (paciente que
  já estava em atendimento fora do sistema, 35 registros legados). Depois desta
  entrega ninguém precisa dele para o Diagnóstico, que era o uso indevido.
- **ID da oferta do Formato 2**, que ainda não vendeu. O sistema pede o vínculo
  na primeira venda.
- **Os 19 pacientes com bruto R$ 0,00** na tela do terapeuta (item 35): efeito de
  lançamento manual sem venda real amarrada à sessão. Problema separado.
