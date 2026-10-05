# Performance de Funis — Fase 2A (Desenho)

> Sub-fase da Fase 2 do painel "Performance de Funis". A 2A entrega **só a
> fundação de dados + as telas de configuração**. Nenhum número real de métrica
> é calculado aqui — isso é 2B em diante.

## Intenção (o que o dono quer)

Hoje o painel Performance de Funis é um protótipo visual com dados fictícios
(aprovado, não está em produção). O dono quer ligar dados reais. Antes disso,
o sistema precisa (1) saber de forma confiável de qual produto é cada venda e
(2) deixar o dono montar/salvar "funis" (grupos de produtos + campanhas).

Decisões já tomadas na conversa (05/10/2026):
- Um **funil** é um grupo nomeado que contém **vários produtos** e puxa
  investimento em ads por **termo de nomenclatura de campanha** (contém). Há
  funis **orgânicos** (sem termos de campanha, sem investimento).
- Produtos são identificados por **código (ID da plataforma)** com **nome de
  reserva** para o histórico (opção escolhida pelo dono).
- A **lista de nomes** que cada produto já teve **aparece na tela** (visível).

## Contexto de dados (provado rodando em 05/10/2026)

- `sales` guarda **só o nome** do produto (`produto`), não o código. Tem UTMs
  ricas (`utm_campaign` = nome|id da campanha, `utm_content` = criativo|ad id,
  etc.) — relevante para a 2D, não para a 2A.
- O **código do produto existe no payload cru** dos dois webhooks:
  - Hubla: `event.product.id` (e `event.products[].offers[].id` = oferta).
  - Kiwify: `Product.product_id` (e `Product.product_offer_id`).
- Os payloads crus são logados em `webhook_events`, mas **só desde 04/08/2026**.
  Vendas vão até **02/05/2026**. Total: 12.054 vendas, 6.352 eventos logados.
  → Vendas de **mai–ago/2026 não têm como recuperar o código**; só o nome.
- Não existe tabela de catálogo de produtos real. A tabela `products` é só
  dado de demonstração antigo (ignorar). `funis` ainda não existe.

## Escopo

**Dentro da 2A:**
1. Passo 1 — Identidade de produto (catálogo + código na venda + resolução).
2. Passo 2 — Cadastro de funil (tabela `funis` + CRUD + telas de config).

**Fora da 2A (2B+):** puxar números reais da Meta, somar vendas/faturamento no
funil, cascata financeira, criativos, atribuição por UTM/ad id. A 2A não exibe
nenhum número de performance — só configuração.

---

## Passo 1 — Identidade de produto

### 1.1 Tabela nova: `produtos_catalogo`

Uma linha por produto real (por plataforma):

| coluna | tipo | papel |
|---|---|---|
| `id` | uuid (PK) | chave surrogate |
| `plataforma` | text | `'hubla'` \| `'kiwify'` |
| `produto_id` | text | o código do produto na plataforma |
| `nome_exibicao` | text | nome "bonito" mostrado nas telas (editável) |
| `nomes` | text[] | todos os nomes que o produto já teve nas vendas (visível na tela) |
| `project_id` | text (nullable) | projeto (herdado das vendas quando houver) |
| `created_at` / `updated_at` | timestamptz | |

Único: `(plataforma, produto_id)`.

### 1.2 Coluna nova em `sales`: `produto_id`

`produto_id text null` — o código do produto na plataforma. (A coluna
`plataforma` já existe em `sales`.) O par `(plataforma, produto_id)` liga a
venda ao catálogo.

### 1.3 Semeadura do catálogo (a partir dos payloads logados)

Script único (`scripts/`): varre `webhook_events` (Hubla + Kiwify), extrai de
cada payload o `(plataforma, produto_id, nome_do_produto)` e agrupa:
- cria/atualiza a linha de `produtos_catalogo` por `(plataforma, produto_id)`;
- acumula em `nomes` cada nome visto (sem duplicar; preserva a grafia original,
  inclusive variações com espaço/caixa);
- `nome_exibicao` começa com o nome mais frequente (o dono ajusta depois).

Produtos que só aparecem em vendas antigas (sem payload) **não** entram pela
semeadura automática — entram pelo nome de reserva (1.5) e podem ser
cadastrados/ajustados à mão na tela do catálogo se necessário.

### 1.4 Captura do código nas vendas novas (ingestão)

Nos webhooks `app/api/webhooks/hubla/route.ts` e `.../kiwify/route.ts`: ao
criar a venda, gravar `produto_id` a partir do payload (campos acima) e
atualizar o catálogo (upsert por `(plataforma, produto_id)`, acrescentando o
nome a `nomes` se for novo). Sem o código no payload, grava `null` (comportamento
de hoje) — nada quebra.

### 1.5 Preenchimento do histórico + resolução por nome

- **Backfill** (script único): para as vendas que **têm** payload logado
  (casar por `order_id`), preencher `sales.produto_id`.
- **Resolução por nome** (função pura, testável) — `resolverProdutoId(venda, catalogo)`:
  1. se `venda.produto_id` existe → usa ele;
  2. senão, procura no catálogo a linha cuja `nomes` contenha o `venda.produto`
     comparando **normalizado** (trim + caixa-insensível) e com a mesma
     `plataforma` → devolve seu `(plataforma, produto_id)`;
  3. senão → `null` (venda não resolvida; fica de fora dos funis, contabilizada
     como "não classificada").

A resolução por nome roda em consulta (2B+); na 2A só entregamos a função + testes.

### 1.6 Tela do catálogo (Passo 1 visível)

Uma view "Produtos" dentro de Performance de Funis:
- lista os produtos do catálogo: `nome_exibicao`, plataforma, código, e a
  **lista de `nomes`** (visível);
- permite **editar o `nome_exibicao`** (e, se preciso, criar/ajustar uma linha à
  mão para um produto antigo). Edição via API (1.7).

### 1.7 API do catálogo

`app/api/funis/produtos/route.ts` (ou pasta equivalente): `GET` lista o catálogo;
`PATCH` edita `nome_exibicao` (e `nomes`/linha manual). Admin do dashboard.

---

## Passo 2 — Cadastro de funil

### 2.1 Tabela nova: `funis`

| coluna | tipo | papel |
|---|---|---|
| `id` | uuid (PK) | |
| `nome` | text | nome do funil |
| `project_id` | text (nullable) | projeto |
| `termos_campanha` | text[] | termos "contém" das campanhas na Meta; **vazio = orgânico** (sem investimento) |
| `created_at` / `updated_at` | timestamptz | |

### 2.2 Tabela de ligação: `funil_produtos`

| coluna | tipo |
|---|---|
| `funil_id` | uuid (FK → funis.id, on delete cascade) |
| `plataforma` | text |
| `produto_id` | text |

Único: `(funil_id, plataforma, produto_id)`. Cada linha = um produto do catálogo
dentro do funil.

### 2.3 API de funis (CRUD)

`app/api/funis/route.ts` + `app/api/funis/[id]/route.ts`: `GET` (lista/um),
`POST` (cria), `PATCH` (edita nome / termos / produtos), `DELETE` (exclui;
cascade em `funil_produtos`). Admin do dashboard.

### 2.4 Tela de funis

View "Funis" dentro de Performance de Funis:
- lista os funis criados (nome, nº de produtos, se tem termos de campanha);
- "Novo funil" / editar: campo **Nome**; **multiseleção de produtos** da lista
  limpa do catálogo; campo de **termos de campanha** (lista de termos; vazio =
  orgânico);
- **Excluir** funil (com confirmação).

Nenhum número de performance nesta tela — só configuração.

---

## Isolamento / padrões

- Segue o padrão de módulo do projeto: lógica em `lib/funis/*`, rotas em
  `app/api/funis/*`, telas em `app/performance-funis/*`. `lib/funis/*` importa
  só de si e de `@/lib/supabase`. Tabelas novas: `produtos_catalogo`, `funis`,
  `funil_produtos` (e a coluna `sales.produto_id`).
- Credenciais já existentes; nada novo. Token da Meta não é usado na 2A.

## Erros / bordas

- Payload sem código → venda com `produto_id = null`; cai no nome de reserva.
- Nome de venda que não bate em nenhum catálogo → venda "não classificada"
  (fora dos funis). Será mostrada como % não classificada na 2D.
- Colisão teórica de código entre plataformas → resolvida por `(plataforma, produto_id)`.
- Exclusão de funil não apaga nada de venda/produto — só o funil e seus vínculos.

## Testes (2A)

- `resolverProdutoId` (1.5): por código; por nome normalizado (trim/caixa);
  nome com espaço a mais; plataforma diferente não casa; não encontrado → null.
- Normalização de nome (função pura).
- Montagem do catálogo a partir de uma amostra de payloads (função pura que
  recebe eventos e devolve linhas de catálogo).
- Validação de funil (nome obrigatório; termos/produtos opcionais; orgânico ok).
- CRUD de funis: testes de rota onde fizer sentido (ou funções puras de validação).

## O que a 2A entrega (critério de pronto)

1. Catálogo semeado + visível, com nomes e nome_exibicao editável.
2. `sales.produto_id` capturado nas vendas novas e preenchido no histórico
   possível (ago/2026+).
3. Função de resolução por nome provada por teste.
4. Telas de "Produtos" e "Funis" funcionando (criar/editar/excluir funil,
   escolher produtos, definir termos de campanha).
5. Deploy em produção, com testes verdes.
