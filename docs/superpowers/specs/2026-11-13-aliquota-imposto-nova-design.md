# Alíquota de imposto nova, etapa 1 (desenho aprovado em conversa)

Pedido e decisões do dono em 13/11/2026. Levantamentos nos itens 146 e 147 do `spr-digital.md`.

## Por quê

A alíquota de imposto da empresa mudou e o dono precisa fazer o fechamento de novembro já com a alíquota nova.
O que já foi fechado continua como foi fechado. A avaliação do DRE achou um erro de conta (o resultado não
desconta o imposto), que entra nesta etapa. O resto da avaliação do DRE é a etapa 2.

## Decisões do dono (13/11/2026)

- **Alíquotas:** produto com preço até R$ 167: **3,8%** (antes 3%). Acima de R$ 167: **8,71%** (antes 12,85%). A faixa
  continua pelo preço do produto (`preco_base`): exatamente R$ 167 fica em 3,8%. A base do imposto continua a mesma
  (`getImpostoBase`: o maior entre valor com juros e valor pago).
- **Performance de Funis:** Como Ser Perdoado **8,71%** (antes 12,85%); Imersão **3,8%** (antes 3,85%).
- **Acréscimo de 13,85% da Meta: não muda.**
- **No Fechamento:** "toda venda que não tiver em nenhum fechamento, aplica-se as regras novas". Não é por data: um
  fechamento confirmado em 19/10 pode ter apurado só até 02/10. Vale para vendas de qualquer data, inclusive as antigas
  que nunca entraram em fechamento.
- **No DRE:** independente dos fechamentos. Por data da venda: vendas de **20/10/2026** em diante usam a regra nova;
  anteriores, a antiga. "Somente lá isso fica fixo."
- **Comissionamento dos terapeutas não muda, em lugar nenhum:** "não muda, fica igual".
- **Erro do DRE corrigido nesta etapa:** o "Resultado líquido" passa a descontar o imposto.
- Etapa 2 (depois, fora daqui): 13,85% da Meta no DRE, mês de referência nos custos lançados no Fechamento e esses
  custos no DRE, repasse dos terapeutas no DRE, termos de campanha do DRE, Fluxo de Caixa.

## 1. Fechamento (`app/fechamentos/page.tsx`)

- **Regra por venda:** regra antiga para a venda cujo `id` está nos compradores (`closings.compradores[].id`) de um
  fechamento **calculado pela regra antiga**; regra nova para todas as outras.
- **Fechamento calculado pela regra antiga = fechamento sem a marca de regra nova.** Todo fechamento confirmado pelo
  código novo grava `regraImposto: 'nova-2026-11'` em cada item de `by_product` (JSON que já existe no banco: sem
  coluna e sem migração). Não depende de horário: cobre os 21 fechamentos de hoje e até um confirmado depois da
  publicação por uma aba aberta com o código antigo (ele gravou valores da regra antiga, então suas vendas seguem
  antigas). Venda fechada pelo código novo nunca volta para a regra antiga.
- **Lista de todos os projetos:** os ids vêm de TODOS os fechamentos, não só do projeto selecionado (hoje os 21 são
  do `proj_1`). Enquanto a lista não carregou ou se a busca falhou, o Fechamento não calcula imposto com lista vazia:
  mostra carregando/erro e não deixa confirmar.
- **Por que os compradores:** os 21 fechamentos guardam o `id` de cada venda. Conferido em 13/11 contra a regra que
  hoje decide "já fechada" por produto, período e horário (`lib/vendas-ja-fechadas.ts`): batem em todas as vendas
  aprovadas desde agosto; as únicas 64 diferenças são vendas que estão nos compradores e depois foram reembolsadas.
- **Imposto e totais:** imposto de cada venda pela regra dela; total de impostos, faturamento líquido, lucro e divisão
  entre sócios seguem como hoje.
- **Coluna de alíquota por produto:** se todas as vendas da linha com base maior que zero tiveram a mesma alíquota,
  mostra essa alíquota exata (8,71%, 3,8%, 12,85%, 3%); se tiveram alíquotas diferentes, mostra a efetiva (imposto ÷
  base) com duas casas; base zero (cortesia), 0%. O valor gravado em `by_product[].aliquota` segue a mesma regra.
- **Repasse do terapeuta:** a conta de hoje fica igual. Base própria do repasse, calculada sempre com a regra antiga
  (3% / 12,85%), separada do `liquido_pos_impostos` (que passa a ter o imposto real da empresa). Diagnóstico e
  Mentoria por sessão já têm regra fixa por sessão e não mudam. O texto do detalhe do repasse percentual diz que a base
  usa a regra antiga.

## 2. DRE (`app/dre/page.tsx`)

- **Imposto por data:** venda com data (BRT, a mesma `data_hora` que o DRE já usa para o mês) `>= 2026-10-20` usa a
  regra nova; antes, a antiga. Não olha fechamentos. Vale nas abas DRE e Fluxo de Caixa.
- **Correção da conta:**
  - "(-) Taxas plataforma" passa a ser `bruto - valor_liquido` (sem subtrair o imposto).
  - "= Receita líquida" = bruto - impostos - taxas (= líquido das plataformas - impostos).
  - "= Resultado líquido" parte dessa receita, então passa a descontar o imposto.
  - Só a correção (regra antiga), outubro/2026: resultado R$ 212.931,90 -> R$ 161.587,29; taxas -R$ 32.495,66 ->
    R$ 18.848,95. Com a correção e o corte de 20/10 juntos, ver números de conferência na seção 6.
  - A linha "= Líquido Pós-Impostos" fica (nome que o dono conhece), com o mesmo valor da Receita líquida.
- Fluxo de Caixa: só a alíquota por data. O resto do Fluxo é etapa 2.

## 3. Dashboard (início, `app/page.tsx`)

- Imposto e alíquota por produto pela mesma regra por data do DRE (é uma tela de período, como o DRE).

## 4. Performance de Funis (`lib/funis/funis-config.ts`)

- CSP 0.0871 e Imersão 0.038. Os Funis só contam desde 23/10/2026, depois de 20/10, então a troca direta segue a regra
  do DRE.

## 5. Uma regra, um lugar

- Funções testadas e separadas: alíquota da regra antiga (renomeada para deixar claro que é a antiga; usada no repasse
  do terapeuta e nas vendas antigas), alíquota da regra nova, regra por venda do Fechamento (recebe o conjunto de ids
  da regra antiga) e regra por data do DRE/Dashboard. Nenhum lugar esquecido troca de regra sem querer.

## 6. Contratos técnicos (revisão Codex + Gemini do desenho final, 13/11)

- **Lista da regra antiga:** busca própria de TODOS os fechamentos (só `id`, `by_product`, `compradores`, paginada),
  que LANÇA erro sem cliente do banco ou com erro da consulta (não usa o `[]` silencioso nem os dados de exemplo do
  `AppContext`). Estado próprio carregando / pronto / erro. Não substitui a lista de fechamentos do projeto que o
  Fechamento já usa para "já fechada", alertas e estornos (essa continua como está).
- **Predicado:** fechamento é da regra nova se algum item de `by_product` tem `regraImposto === 'nova-2026-11'`;
  senão é da antiga. O campo é carimbo do fechamento, não diz qual alíquota cada linha usou.
- **Tipos:** `ClosingProductRow` ganha `regraImposto?: 'nova-2026-11'` e `aliquotaEfetiva?: boolean`; `addClosing` já
  grava `by_product` inteiro (conferir no plano com teste).
- **Confirmação só segue se a gravação deu certo:** hoje o erro de gravar o fechamento é só registrado e a tela segue
  (marca custos, lança caixa). Como a marca depende dessa gravação, a confirmação passa a parar com erro visível se
  gravar o fechamento falhar, sem marcar custos nem lançar caixa. (Defeito que já existia; entra porque a regra nova
  depende dele.)
- **Formato da alíquota (Fechamento e Dashboard):** uniforme = até duas casas sem zero sobrando (3%, 3,8%, 8,71%,
  12,85%); efetiva = sempre duas casas; base zero = 0%. O Dashboard usa a mesma conta de linha do Fechamento.
- **Taxas do DRE:** `bruto - valor_liquido` com sinal (sem forçar zero; venda com líquido maior que o bruto já existe e
  fica visível). `= Líquido Pós-Impostos` recebe o mesmo valor da `= Receita líquida` (sem segunda soma).
- **Repasse:** texto do detalhe do percentual: "N% sobre R$ X (imposto pela regra antiga)". Caso de aceitação:
  mentoria com base R$ 1.000, líquido R$ 900, comissão 30%, venda sem fechamento acima de R$ 167: imposto da empresa
  R$ 87,10; repasse R$ 231,45 (30% de 900 - 128,50); sobra R$ 581,45 antes dos outros custos.
- **Corte do DRE:** comparar o dia `data_hora.slice(0, 10)` (já em BRT) com `'2026-10-20'`, numa função testada; R$ 167
  fica na faixa baixa e R$ 167,01 na alta.
- **Funis:** comentário em `DATA_CORTE_FUNIS` avisando que desligar a trava passaria vendas antigas para 8,71%/3,8%.
- **Números de conferência do DRE (banco e Meta lidos em 13/11; a Meta muda ao vivo):**
  setembro imposto R$ 60.488,03 (igual), resultado R$ 260.141,80 -> R$ 199.653,77; outubro imposto R$ 51.344,61 ->
  R$ 43.152,90, taxas R$ 18.848,95, resultado R$ 212.931,90 -> R$ 169.779,00; novembro (até 13/11) imposto
  R$ 13.469,34 -> R$ 9.579,40, resultado R$ 53.189,14 -> R$ 43.609,74.
- Conferido: não existe fluxo que apague fechamento; estorno de reembolso não recalcula imposto
  (`lib/alertas-reembolso.ts`); `getAliquotaByPreco` só é usada em Dashboard, DRE e Fechamento.

## O que não muda

- Fechamentos já confirmados (imposto gravado).
- Módulo dos terapeutas inteiro (`lib/terapeutas-auth.ts`, `app/api/terapeutas/*`, `app/terapeutas/*`).
- Acréscimo de 13,85% da Meta.
- `scripts/converter-venda-em-moeda-estrangeira.ts` (só imprime simulação com 12,85%; pendência registrada).

## Riscos aceitos

- Venda apagada e recriada com outro id perde o vínculo com o fechamento antigo (não há fluxo do sistema que faça
  isso).
- O Fechamento continua decidindo "já fechada" por produto, período e horário; o imposto usa os ids dos compradores.
  Hoje coincidem.
- DRE e Fechamento podem mostrar imposto diferente para a mesma venda antiga sem fechamento (ex.: Imersão de 10/10:
  3% no DRE, 3,8% no Fechamento). É a consequência das duas regras que o dono escolheu.

## Efeito esperado (banco lido em 13/11/2026)

- Fechamento: as 1.504 vendas sem fechamento anteriores a 20/10 (quase todas Imersão de 03/10 a 19/10) vão com a regra
  nova (+R$ 332,69 de imposto); vendas de 20/10 em diante, regra nova.
- DRE: meses até setembro só mudam pela correção da conta do resultado; outubro muda pela correção e pelas vendas de
  20/10 a 31/10; novembro com a regra nova.

## Fica para o construtor

- Onde as funções moram, nomes e testes; como o Fechamento recebe os fechamentos de todos os projetos; formato exato da
  alíquota efetiva.
