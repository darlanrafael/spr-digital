# Varredura diária de inconsistências - design

**Data:** 14/08/2026
**Status:** aprovado pelo usuário, pronto para implementação

## Por que existe

Em 13-14/08/2026 uma sessão de investigação achou cerca de R$ 6 mil em erros de faturamento: um bug que apagava venda paga, reembolsos nunca devolvidos aos sócios, e duas vendas sem respaldo na plataforma. Todos foram encontrados porque o usuário conferiu à mão contra Hubla e Kiwify. O sistema estava calado.

As correções daquela sessão são reativas: impedem que aqueles erros específicos se repitam. A varredura é a resposta preventiva, e o achado que a justifica é o da Cristiane (R$ 2.860), que apareceu numa varredura rodada por precaução, sem ninguém estar procurando.

Enquanto ela não existir, a próxima classe de erro aparece do mesmo jeito: o usuário notando um número estranho semanas depois.

## Escopo

**Entra:** verificações que rodam só com o nosso banco e com a tabela `webhook_events`.

**Fica de fora:** comparação com export das plataformas. Venda que existe na Hubla ou Kiwify e nunca chegou até nós é invisível daqui, e cobrir isso exigiria API de consulta das plataformas. Continua sendo conferência manual, agora documentada como risco 2 da seção 0 do `spr-digital.md`.

## Arquitetura

`GET /api/varredura/diaria`, protegido pelo `WHATSAPP_CRON_SECRET` via header `x-whatsapp-cron-secret`, no mesmo padrão de `app/api/whatsapp/pendentes-30min`.

O endpoint devolve JSON com o resultado estruturado e um campo `mensagem` já formatado. **O envio fica no n8n**, que é o padrão do projeto: nenhum código daqui fala com a Z-API. O n8n chama o endpoint às 21:30, pega `mensagem` e envia para `5511973759529` pela mesma conexão que já usa no projeto dos terapeutas.

A lógica de cada verificação mora em módulo puro em `lib/varredura/`, com teste próprio. O endpoint só orquestra, formata e persiste.

## Janela

**26 horas** para as verificações sobre vendas recentes. As janelas de execuções consecutivas se encaixariam exatamente com 24h, sem buraco; as 2h de folga existem para que uma execução falha (n8n fora do ar, deploy em andamento) seja coberta pela execução seguinte. A mensagem diz "últimas 24 horas", que é o que interessa ao leitor.

Exceções:
- Reembolso de venda já fechada ainda não deduzido: histórico inteiro (é barato e o atraso importa).
- Integração parada: últimas 12 horas.

## As 8 verificações

Cada uma mira uma classe de erro que já aconteceu de verdade neste projeto.

| # | Verificação | Sinal | Origem |
|---|---|---|---|
| 1 | Venda não-aprovada sem evento de reembolso correspondente em `webhook_events` | possível vítima do bug de estorno em massa | item 29 |
| 2 | Evento de reembolso recebido sem venda marcada | webhook processado e perdido | inverso do 1 |
| 3 | `valor_pago_cliente / preco_base < 0,4` | venda em moeda estrangeira gravada como BRL | itens 8 e 28 |
| 4 | `valor_liquido > valor_pago_cliente` | campos em bases diferentes | item 28 |
| 5 | Duplicata: mesma fatura + produto em duas linhas, ou mesma compra com `order_id` em formatos diferentes | dedup falhou | item 30 |
| 6 | Venda sem `order_id` | cai no dedup frágil por e-mail+produto | item 24 |
| 7 | Reembolso de venda já fechada, ainda não deduzido | dinheiro repassado e não devolvido | item 31 |
| 8 | Nenhum webhook recebido nas últimas 12h | integração quebrada | preventivo |

## As três etapas

A redundância que dá confiança não vem de repetir a mesma consulta. Vem de olhar por ângulos independentes e de reconferir cada candidato individualmente antes de reportar.

**Etapa 1 - varredura ampla.** As 8 verificações rodam sobre o conjunto e levantam candidatos. Rápida e abrangente, sujeita a falso positivo.

**Etapa 2 - verificação individual.** Cada candidato é reconsultado sozinho, por consulta direta e por ID, confirmando um sinal de cada vez. Candidato que não sobrevive é descartado antes de virar mensagem.

Esta etapa existe por causa de dois falsos positivos reais produzidos em 14/08, ambos por conclusão tirada de contagem agregada: um cliente com três compras do mesmo produto teve a compra certa marcada como estornada, e a contagem por e-mail+produto acusou erro onde não havia. Abrir as linhas teria resolvido em segundos. Ver lição 7 da seção 13 do `spr-digital.md`.

**Etapa 3 - comparação com a execução anterior.** O resultado de cada noite fica gravado. Achado que aparece hoje e some amanhã é marcado como instável em vez de reportado como fato.

**Classificação:** dois ou mais sinais independentes concordando = ALERTA. Um só = conferir.

## Persistência

Tabela nova `varreduras`:

| coluna | tipo | conteúdo |
|---|---|---|
| `id` | text | identificador da execução |
| `executada_em` | timestamptz | quando rodou |
| `vendas_analisadas` | int | tamanho da janela analisada |
| `candidatos` | int | levantados na etapa 1 |
| `descartados` | int | mortos na etapa 2 |
| `achados` | jsonb | os que sobreviveram, com sinais e classificação |
| `erros` | jsonb | verificações que falharam |

Serve para a etapa 3 e para auditoria posterior.

## Mensagem

Dia limpo:

```
Boa noite, Darlan! 👋

Fiz a varredura completa do sistema a fim de encontrar qualquer
inconsistência, e *tudo passou limpo*.

Conferi *47 vendas* das últimas 24 horas em 8 verificações
independentes:

✅ *Estornos* - todos com evento correspondente da plataforma
✅ *Valores* - nenhuma venda em moeda estrangeira nem líquido acima do pago
✅ *Duplicatas* - nenhuma venda repetida
✅ *Identificação* - todas as vendas com order_id
✅ *Fechamentos* - nenhum reembolso pendente de devolução aos sócios
✅ *Integração* - último webhook recebido há 12 minutos

Nada exige sua atenção hoje. 🌙
```

Quando a etapa 2 descartou candidatos, a linha aparece antes do fecho:

```
3 pontos foram levantados e reconferidos um a um; *todos se explicaram*.
```

Dia com problema:

```
Boa noite, Darlan!

Fiz a varredura completa do sistema e *encontrei 2 pontos* que
precisam da sua atenção.

🔴 *ALERTA - Estorno sem evento correspondente*
Fulano de Tal · Imersão · *R$ 39,90*
Marcada como reembolsada em 13/08, mas nenhum evento de reembolso
chegou da plataforma. O cliente tem outra compra na mesma
plataforma, que é exatamente o padrão do bug que apagava venda paga.
➡️ _Confira no painel da Kiwify se essa venda está como paga._

🟡 *Conferir - Venda sem identificador*
Beltrano de Souza · O RESGATE · *R$ 697,00*
Chegou sem order_id, então depende do casamento por e-mail e
produto, que pode descartar uma segunda compra do mesmo produto.

O restante passou limpo: valores, duplicatas, fechamentos e
integração sem novidade.

_Total sob suspeita: R$ 736,90_
```

Três decisões de texto, deliberadas:

1. **Sempre listar o que foi conferido**, mesmo no dia limpo. Sem isso, "tudo certo" vira ruído em duas semanas e o usuário para de ler, que é o risco de mandar mensagem todo dia.
2. **Todo alerta diz o que fazer.** Avisar sem indicar onde conferir não resolve.
3. **Valor sob suspeita no fim**, para medir urgência em dois segundos.

Sem travessão longo em nenhum texto, por preferência explícita do usuário.

## Tratamento de erro

Verificação que lança exceção não derruba as outras. O erro é capturado, registrado em `erros`, e a mensagem reporta qual falhou:

```
⚠️ A verificação de duplicatas falhou nesta execução e será
refeita amanhã.
```

Uma varredura que morre calada seria pior que não ter varredura.

Se o endpoint inteiro falhar, o n8n não recebe nada e não envia mensagem. O silêncio total é o sinal de que algo quebrou, e é por isso que a mensagem diária existe mesmo em dia limpo: a ausência dela é informação.

## Testes

Cada verificação em módulo puro com teste próprio, no padrão dos quatro módulos criados em 13/08 (`npm test`, runner nativo do Node via `tsx`, sem dependência nova).

Cobertura mínima por verificação: um caso que dispara, um que não dispara, e o caso real que originou aquela classe de erro (Cristiane para a 1, Juliana para a 5, e assim por diante). Os casos reais valem mais que os sintéticos: se alguém reintroduzir o bug, o teste quebra com o nome do cliente que sofreu.

A formatação da mensagem também tem teste, comparando texto gerado contra o esperado nos dois cenários.

## Fora de escopo, registrado para não se perder

- Comparação com export das plataformas (risco 2 da seção 0)
- Gravar o `order_ref` da Kiwify, que hoje impede reconciliação por ID daquele lado (risco 7)
- Corrigir o fuso da tela de fechamento (risco 1), que é problema separado e mais grave
