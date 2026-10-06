# Performance de Funis — Fase 2B (Desenho)

> Sub-fase da Fase 2. A 2B liga os **dados reais da Meta** aos funis cadastrados
> na 2A e mostra a performance de anúncios (topo do funil + criativos).
> **Compras / faturamento / ROAS NÃO entram aqui** — são a 2C (dados reais do
> banco). O funil da 2B vai até os **checkouts**.

## Intenção (o que o dono quer)

Para cada funil cadastrado na 2A, ver como ele performa nos anúncios, com os
números reais da Meta, filtrando as campanhas pelos termos do funil (ex.: `CSP`,
`IAR`). Decisões tomadas (05/10/2026):
- **Navegação:** visão geral (lista de funis com números resumidos) + detalhe ao
  clicar (gráficos daquele funil). Opção 3 da conversa.
- **Período:** atalhos (Hoje / 7 / 30 dias) + intervalo personalizado.
- **Fim do funil na 2B:** Impressões → Cliques → Visitas → Checkouts. "Comprou"
  e faturamento ficam pra 2C (venda real do banco; o número do pixel engana).

## Contexto já provado rodando (05/10/2026)

- Conexão Meta existe (`lib/meta.ts`, `META_ACCESS_TOKEN`, 5 contas, Graph v19.0).
  Hoje só puxa `spend`.
- **Por campanha** retornam: `spend, impressions, reach, clicks, inline_link_clicks, unique_clicks, actions[], video_play_actions`. (item 100.6)
- **Por anúncio (ads)** retornam, além dos campos acima: `campaign{name}` e
  `creative{name,thumbnail_url}`. Uma consulta `act_<id>/ads?fields=...` por conta
  dá o total do funil (somando os ads cujas campanhas casam o termo) E os criativos.
- `actions[]` traz `landing_page_view`, `initiate_checkout`, `link_click`, `video_view`, `purchase` etc.
- **Fórmulas do dono:** CTR = `unique_clicks` / `reach` x 100; Hook Rate = `actions.video_view` / `impressions` x 100 (só vídeo; imagem/carrossel = "-").

## Escopo

**Dentro da 2B:**
1. Camada de dados: estender a Meta pra puxar os campos do funil por anúncio, agregar por funil (campanhas cujo nome CONTÉM um termo do funil), em todas as contas.
2. Tela: visão geral (lista) + detalhe (etapas do funil, criativos, cadência diária).

**Fora da 2B (2C+):** compras reais, faturamento, taxas, imposto, repasse, ROAS, CPA por venda, margem, cascata financeira. Atribuição por UTM/ad_id = 2D.

---

## Camada de dados

### Arquivos
- `lib/funis/meta-funil.ts` (novo) — funções puras de agregação (testáveis) + a montagem da consulta. Isolado do módulo funis (importa só de si, `@/lib/supabase` e, se preciso, `@/lib/meta` compartilhado).
- Estender `lib/meta.ts` OU criar `getAdsComInsights(accountId, dateParam)` ali, porque é a casa da Graph API (token, contas, paginação). Reaproveita `getAccountIds()`, o token e o padrão de `insights.date_preset(x){...}` / `insights.time_range(...)`.

### Como funciona
1. Uma vez por período, buscar os **ads** de cada conta com:
   `name, campaign{name}, creative{name,thumbnail_url}, insights.<periodo>{spend,impressions,reach,clicks,inline_link_clicks,unique_clicks,actions,video_play_actions}` (paginado, `limit=500`).
2. Para cada funil, filtrar os ads cujo `campaign.name` **contém** algum `termos_campanha` do funil (case-insensitive — mesma regra de `getProjectInvestment`). Funil sem termos (orgânico) = sem dados de Meta (mostra "sem investimento").
3. Agregar (função pura `agregarFunil(adsDoFunil)`):
   - **Aditivos (soma):** `spend`, `impressions`, `clicks`, `inline_link_clicks`, e as ações `landing_page_view`, `initiate_checkout`.
   - **Hook Rate:** soma de `actions.video_view` dos ads de VÍDEO / soma de `impressions` dos ads de vídeo x 100.
   - **Não aditivos (alcance/únicos):** `reach` e `unique_clicks` são pessoas únicas; somar sobre ads superconta. DECISÃO 2B: somar mesmo assim para o CTR do funil (os dois superContam juntos, então o CTR = unique_clicks/reach fica aproximadamente certo), e **rotular o alcance do funil como aproximado**. O CTR exato por anúncio (criativo) usa o reach do próprio ad (exato). Revisar na 2C/2D se precisar do alcance de-duplicado real (exige consulta agregada por conta/campanha).

### Métricas expostas (por funil e por criativo)
- Investido = `spend`
- Impressões = `impressions`
- Cliques = `inline_link_clicks`
- CTR = `unique_clicks` / `reach` x 100
- Hook Rate = `actions.video_view` / `impressions` x 100 (só anúncio de vídeo; senão "-")
- Visitas = `actions.landing_page_view`
- Checkouts = `actions.initiate_checkout`
- Custo por checkout = `spend` / checkouts (ou "-" se checkouts = 0)

### Como saber se o anúncio é vídeo
Pelo retorno de `video_play_actions`/`actions.video_view` > 0 (anúncio de imagem/carrossel não traz vídeo). Hook Rate "-" quando não há vídeo.

### Rota
`app/api/funis/performance/route.ts` (admin-only): recebe `datePreset` ou `dateStart/dateEnd`; lê os funis do banco (nome + termos + produtos), busca os ads das contas, agrega por funil, devolve a visão geral (totais por funil) e, com `?funilId=`, o detalhe (etapas + criativos + série diária). Reaproveita o jeito do `app/api/meta/insights`.

### Performance / limites
Uma leva de consultas por conta (5) por período serve TODOS os funis (filtra em memória). Rate limit da Meta: se estourar, degradar com aviso (não quebrar), igual `lib/meta.ts` já faz com erro por conta. Cadência diária (série por dia) pode exigir `time_increment=1` na consulta de insights — provar no plano.

---

## Telas

Dentro da área de Performance de Funis (abas já existem: Funis / Produtos). A 2B
acrescenta a aba/tela **Dashboard** (a visão geral) como entrada principal.

### Seletor de período (topo)
Atalhos Hoje / 7 dias / 30 dias + intervalo personalizado. Reusar
`lib/datas-da-plataforma.ts` e o padrão de `datePreset` que o DRE/Vendas já usam.

### A) Visão geral (lista de funis)
Uma linha por funil, com os números do período: Nome · Investido · Impressões ·
Cliques · CTR · Visitas · Checkouts · Custo por checkout. Funil orgânico (sem
termos) aparece com "sem investimento". Clicar na linha abre o detalhe.

### B) Detalhe (um funil)
Reaproveitar o visual do protótipo (item 100), com dados reais:
- **Etapas do funil:** Impressões → Cliques → Visitas → Checkouts, com a % de
  passagem entre etapas.
- **Tabela de criativos** (por anúncio): miniatura (thumbnail), nome do criativo,
  campanha, Investido, CTR, Hook Rate, Cliques. Ordenável por investido.
- **Gráfico de cadência diária** (linha): investido e/ou cliques por dia no período
  (dataviz skill; série única = sem legenda; emerald pra dinheiro). Reusar o padrão
  de gráfico do protótipo.

Sem cascata financeira, ROAS, compras ou faturamento (2C).

---

## Isolamento / padrões
- Lógica agregável testável em `lib/funis/meta-funil.ts` (`lib/*.test.ts` cobre via o glob já ajustado). Funções puras recebem os ads já baixados e devolvem os agregados — o fetch fica na rota/`lib/meta.ts`.
- Rotas em `app/api/funis/*` (admin-only: `lerIdentidade` + `podeAdministrar`).
- Telas em `app/performance-funis/*`. Token da Meta só no servidor (rota), nunca no cliente.

## Erros / bordas
- Sem `META_ACCESS_TOKEN` → a rota devolve os funis com números zerados/`null` e um aviso (não quebra).
- Conta que falha na Meta → ignora aquela conta e segue (como `lib/meta.ts`), marcando parcial.
- Funil orgânico (sem termos) → sem dados de Meta; mostra "sem investimento".
- Divisão por zero (CTR, custo/checkout) → "-".
- Anúncio sem vídeo → Hook Rate "-".
- Alcance do funil é aproximado (soma de reach) — rotulado na tela.

## Testes (2B)
- `agregarFunil(ads)`: soma aditivos; Hook Rate só sobre ads de vídeo; CTR = unique/reach; custo/checkout; divisão por zero → "-"; anúncio sem vídeo → Hook "-".
- Filtro de ads por termo do funil (contém, case-insensitive; funil orgânico → vazio).
- Extração das ações (landing_page_view / initiate_checkout / video_view) de `actions[]`.
- Parsing da série diária (time_increment) — função pura.
- Validação do período (datePreset vs intervalo) reusando datas-da-plataforma.

## Critério de pronto (2B)
1. Rota que devolve, por período, a visão geral (totais por funil) e o detalhe de um funil (etapas + criativos + série diária), com dados reais da Meta.
2. Tela Dashboard (visão geral) + detalhe ao clicar, com seletor de período.
3. Criativos com thumbnail, CTR e Hook Rate reais.
4. Funções de agregação provadas por teste + provado rodando contra a Meta real.
5. Deploy só quando o dono aprovar (continua na cópia/branch até lá).
