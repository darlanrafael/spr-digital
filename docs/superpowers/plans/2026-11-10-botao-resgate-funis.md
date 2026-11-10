# Botão "Contar O Resgate - CSP" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na tela Performance de Funis, um botão liga/desliga a contagem das vendas do O RESGATE - CSP em todos os números do funil Como Ser Perdoado.

**Architecture:** O produto ganha a marca `desligavel` no config. Um módulo puro novo tira as vendas desligáveis de uma lista e marca o degrau da esteira. A rota lê `semResgate=1` e filtra vendas e reembolsos **depois** do cache (a chave do cache não muda), então tudo o que já é calculado a partir dessas listas (resultado, diário, listas, criativos, visão geral) segue sozinho; a esteira continua montada com todas as vendas e só ganha `foraDaConta`. A página guarda o estado (começa ligado), manda o parâmetro nas duas buscas e desenha botão, aviso e esteira apagada.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Tailwind, testes `node:test` via `tsx --test` (`npm test`).

**Spec:** `docs/superpowers/specs/2026-11-10-botao-resgate-funis-design.md`

## Global Constraints

- Mesmo design atual da página; só entram o botão, o aviso amarelo e a marca "fora da conta" na esteira (dono, 10/11/2026).
- Estado inicial sempre "contando" (ligado); volta a ligado ao trocar de funil; não é salvo em lugar nenhum.
- Tráfego (investido e acréscimo `ACRESCIMO_TRAFEGO`) nunca muda com o botão.
- Casamento de produto pela regra existente (nome normalizado ou `produto_id`, mesma plataforma): reusar `funilDaVenda` / `produtoDoFunil`, nunca uma regra nova.
- "O RESGATE" sem CSP (Hubla `t4ytLBgwp69xubk1irZK`) e "🥝 O Resgate" (Kiwify) não são do funil e não são tocados.
- Textos exatos: botão `Contar O Resgate - CSP`; aviso `O Resgate - CSP está fora da conta. Os números mostram o funil sem ele.`; marca `fora da conta`.
- Texto exato do erro dos criativos: `Não foi possível carregar os anúncios da Meta. Clique em Atualizar para tentar de novo.`
- Sem travessão em texto da tela. Sem commit de credencial. Push só com pedido explícito do dono.

## Revisão do plano (10/11/2026)

Codex atacante + Codex auditor + Gemini. Achados aceitos e já incorporados abaixo: estado do botão quando a busca falha (A1, ALTO); dia só com Resgate sumindo do gráfico diário (A3, MÉDIO); prova da fiação da rota (Au1/Au2, ALTO) por renomeação estrutural + conferência com números esperados do banco; soma da esteira no componente pai (Au3); Imersão ignora o parâmetro (Au4); teste por id com nome divergente e plataforma errada (Au5); recarregar e sair/voltar (Au6). Gemini (sobre o plano já corrigido): sem volta automática do botão quando a busca falha, que apagava o erro e podia desligar um período novo (G1, ALTO); faixa SVG da esteira apagada junto (G2, ALTO); criativos na prova (G3); clique no botão zera o "Atualizar" (G4); reset ao trocar de funil já no clique (G5); testes de `diasDasVendas` e `diasExtras` (G6); paginação da aba Vendas volta à 1 (G7). Os dois defeitos que já existiam nos criativos ("não atribuído" some sem anúncio na lista, A2; falha da busca de criativos aparece como "Nenhum anúncio no período", G1.3) entraram no escopo a pedido do dono (10/11/2026): Task 4.

**2ª rodada (Codex atacante + auditor + Gemini, 10/11/2026), sem CRÍTICO.** Decisões tomadas:
- **Regra do desligado = "como se as vendas do Resgate não existissem".** Por isso o `diasExtras` SAI do plano: ele fazia uma venda "fora da conta" ainda mexer na média do "Melhor dia" (Gemini 4.2). Um dia que só teve Resgate some do gráfico diário exatamente como some hoje um dia sem venda e sem tráfego (no CSP há tráfego quase todo dia, então é raro).
- **Esmaecer por "chave da resposta" (atacante 2, Gemini 1):** a resposta do resumo guarda para qual funil/período/estado ela foi pedida; se não for a do pedido atual, o bloco usa a opacidade do `carregando` que já existe, num lugar só (sem esmaecer duas vezes). Isso também cobre a falha ao trocar de período. Os criativos não têm esmaecimento próprio (a lista já é limpa no início de cada busca).
- **Estado do botão amarrado ao funil (Gemini 2):** guarda-se o funil em que o botão foi desligado; em outro funil ele já vale "contando" no mesmo render, sem efeito de reset e sem buscas extras.
- **Faixa da esteira por recorte (auditor 2, Gemini 3):** a faixa é desenhada duas vezes com `clipPath`: fora da coluna do Resgate como hoje, e dentro dela com opacidade reduzida. Nenhum retângulo por cima do card.
- **Prova com os mesmos filtros da rota (auditor 1):** o script usa as próprias funções `janelaDoPeriodo`, `aplicarCorte`, `getSalesParaFunil` e `getReembolsosParaFunil`.
- **Fica para um item separado (atacante 1, ALTO, já existia):** `lib/meta.ts` engole erro da Meta e devolve lista vazia ou parcial com HTTP 200. Isso faz sumir anúncio e também pode baixar o "Investido" sem aviso. Não é deste botão e mexe na base da Meta usada por outras telas; vai como pendência para o dono decidir.

## Review Focus

1. Venda antiga do Resgate com `produto_id` null: tem que sair pelo nome (`O RESGATE - CSP`), como no resto do funil. Teste na Task 1.
2. Reembolso do Resgate no período: desligado, sai da lista e do total de reembolsos. Teste na Task 1 (o filtro não olha status).
3. Funil sem produto desligável (Imersão) com `semResgate=1` na URL: nada muda e não há botão. Teste na Task 1 (`produtoDesligavelDoFunil` null; filtro não remove venda da Imersão).
4. Cache de 2 min: alternar o botão não pode servir número velho do outro estado nem gravar lista filtrada no cache. Garantido filtrando depois do `cacheCurto.get` (Task 2, passo de verificação manual com os dois estados em sequência).
5. Trocar período com o botão desligado: continua desligado (só troca de funil ou recarregar volta a ligado). Verificação no localhost (Task 3).

---

### Task 1: Marca `desligavel` e módulo puro

**Files:**
- Modify: `lib/funis/funis-config.ts` (tipo `ProdutoDoFunil` ganha `desligavel?: boolean`; a entrada `O RESGATE - CSP`, `produto_id: '4c7FpX4SdlqVQT0WJfOv'`, ganha `desligavel: true`)
- Create: `lib/funis/produto-desligavel.ts`
- Test: `lib/funis/produto-desligavel.test.ts`

**Interfaces:**
- Produces:
  - `produtoDesligavelDoFunil(funilId: string): string | null` (o `estagio` do produto desligável do funil, ex. `'O Resgate - CSP'`; null se o funil não tem)
  - `semProdutosDesligaveis<T extends { plataforma: string; produto: string; produto_id?: string | null }>(vendas: T[]): T[]` (tira toda venda cujo `produtoDoFunil(v, funilDaVenda(v).id)` tem `desligavel`; não olha status nem moeda; não muda a ordem nem os objetos)
  - `marcarForaDaConta(esteira: EstagioEsteira[], funilId: string, excluir: boolean): (EstagioEsteira & { foraDaConta: boolean })[]` (`foraDaConta` true só no degrau `produtoDesligavelDoFunil(funilId)` e só com `excluir`)

- [ ] **Step 1: Write the failing tests** em `lib/funis/produto-desligavel.test.ts` (fábrica `v()` igual à de `esteira-do-funil.test.ts`):
  - `produtoDesligavelDoFunil('como-ser-perdoado')` → `'O Resgate - CSP'`; `produtoDesligavelDoFunil('imersao-reaproximacao')` → `null`; id inexistente → `null`. (Usar o `id` real do funil CSP lido de `FUNIS`.)
  - `semProdutosDesligaveis` com: Resgate CSP por id com NOME divergente (`produto: 'X'`, `produto_id: '4c7FpX4SdlqVQT0WJfOv'`), Resgate CSP por nome com `produto_id: null`, Resgate CSP `status: 'reembolsada'`, Como Ser Perdoado, Acesso Vitalício - CSP, Mentoria Hubla, Mentoria Kiwify, uma venda da Imersão, `O RESGATE` sem CSP (`t4ytLBgwp69xubk1irZK`), `🥝 O Resgate` Kiwify, e `O RESGATE - CSP` com `plataforma: 'kiwify'` (plataforma errada) → sobram todas menos as 3 do Resgate CSP, na mesma ordem e com os mesmos objetos (`assert.equal` por referência no primeiro).
  - `marcarForaDaConta(agregarEsteira(vendas, csp), csp, true)` → só `'O Resgate - CSP'` com `foraDaConta: true`, vendas e faturamento dele preservados; com `excluir: false` → todos false; funil Imersão com `true` → todos false.

- [ ] **Step 2: Run** `npx tsx --test lib/funis/produto-desligavel.test.ts` → FAIL (módulo não existe).

- [ ] **Step 3: Implement** a marca no config e as três funções em `lib/funis/produto-desligavel.ts`, usando `FUNIS`, `funilDaVenda` e `produtoDoFunil` de `./funis-config` e o tipo `EstagioEsteira` de `./esteira-do-funil`.

- [ ] **Step 4: Run** `npx tsx --test lib/funis/produto-desligavel.test.ts lib/funis/funis-config.test.ts lib/funis/esteira-do-funil.test.ts lib/funis/vendas-do-funil.test.ts` → PASS.

- [ ] **Step 5: Commit** `feat(funis): marca desligavel no O RESGATE - CSP e filtro puro`.

### Task 2: Rota lê `semResgate=1`

**Files:**
- Modify: `app/api/funis/performance/route.ts`

**Interfaces:**
- Consumes: as três funções da Task 1 (`produtoDesligavelDoFunil`, `semProdutosDesligaveis`, `marcarForaDaConta`).
- Produces (resposta do detalhe e da chamada `criativos=1`, campos novos): `desligavel: string | null` (= `produtoDesligavelDoFunil(funil.id)`), `contandoDesligavel: boolean` (= `!excluir`); `esteira` passa a ser `(EstagioEsteira & { foraDaConta: boolean })[]`. Query: `semResgate=1` desliga; qualquer outro valor ou ausente = ligado.

- [ ] **Step 1: Implement**
  - `excluir`: com `funilId`, `sp.get('semResgate') === '1' && produtoDesligavelDoFunil(funilId) !== null` (Imersão ignora o parâmetro: resposta idêntica); sem `funilId` (visão geral), só `sp.get('semResgate') === '1'`.
  - **Renomeação estrutural (prova da fiação):** nos dois ramos, o resultado do `cacheCurto.get` passa a se chamar `vendasTodas` / `reembolsosTodos`, e logo abaixo `const vendas = excluir ? semProdutosDesligaveis(vendasTodas) : vendasTodas` (idem `reembolsos`). Todo o código existente continua usando `vendas` / `reembolsos` sem nenhuma outra mudança. Fora da própria definição e da linha do filtro, `vendasTodas` só aparece na esteira: `marcarForaDaConta(agregarEsteira(vendasTodas, funil.id), funil.id, excluir)`. O cache continua guardando a lista inteira (chaves `vendas|${periodo}` e `reemb|${periodo}` intactas).
  - Incluir os dois campos novos no JSON do detalhe e no da chamada `criativos=1`.

- [ ] **Step 2: Run** `npx tsc --noEmit` → sem erro; `npm test` → tudo passa.

- [ ] **Step 3: Conferir a fiação:** `grep -n "vendasTodas\|reembolsosTodos" app/api/funis/performance/route.ts` → em cada um dos DOIS ramos (criativos e resumo): a definição a partir do `cacheCurto.get` e a linha do filtro (`const vendas = excluir ? semProdutosDesligaveis(vendasTodas) : vendasTodas`, idem `reembolsos` no resumo); além disso, só a esteira. `grep -n "getSalesParaFunil\|getReembolsosParaFunil" app/api/funis/performance/route.ts` → cada chamada está dentro do `cacheCurto.get` que define `vendasTodas`/`reembolsosTodos` (conferir lendo as linhas, não só pela contagem).
- [ ] **Step 4: Números esperados do banco** (script `tsx` na pasta de rascunho, fora do projeto, só leitura, importando do projeto `janelaDoPeriodo`, `aplicarCorte`, `DATA_CORTE_FUNIS`, `getSalesParaFunil(de, ate, ['aprovada'])` e `getReembolsosParaFunil(de, ate)`, para ter exatamente os filtros da rota: janela em Brasília, corte, `manual_*`, moeda e paginação): para "Últimos 30 dias", somar das vendas aprovadas do Resgate CSP a quantidade, `valor_pago_cliente`, taxas (`pago - liquido`) e, dos reembolsos do Resgate no período, o total. Daí sai a tabela esperada do estado desligado: bruto, vendas e taxas caem esses valores; impostos = bruto × 0,1285; investido e tráfego com acréscimo iguais; total de reembolsos cai o total do Resgate; nos criativos, (soma do faturamento das linhas + `naoAtribuido.faturamento`) cai o bruto do Resgate. Essa tabela vai para a prévia do dono (Task 3, Step 4), que confere na tela.

- [ ] **Step 5: Commit** `feat(funis): rota de performance aceita semResgate=1`.

### Task 3: Botão, aviso e esteira na página

**Files:**
- Modify: `app/performance-funis/dashboard/page.tsx`

**Interfaces:**
- Consumes: `desligavel`, `contandoDesligavel`, `esteira[].foraDaConta` da Task 2.

- [ ] **Step 1: Implement**
  - Estado amarrado ao funil: `const [desligadoNoFunil, setDesligadoNoFunil] = useState<string | null>(null)` e `const contarDesligavel = desligadoNoFunil !== funilId`. Sem efeito de reset: em outro funil o valor já é "contando" no mesmo render. Ao renderizar com `desligadoNoFunil` de outro funil, limpar para `null` (assim voltar ao CSP pelo navegador também volta contando).
  - **O que a tela mostra sai da resposta, não do botão (A1/G1):** o aviso e a marca da esteira usam `d.contandoDesligavel`. Ao chegar a resposta do resumo, guardar junto a chave do pedido: `${funilId}|${query}|${contarDesligavel}`. `const resumoDesatualizado = !!d && chaveDoD !== chaveAtual`. A `div` que já recebe `carregando ? 'opacity-50' : 'opacity-100'` passa a usar `carregando || resumoDesatualizado`: é o único lugar que esmaece. Assim, se a busca falhar (troca de botão ou de período), os números ficam esmaecidos com o erro que a página já mostra, até uma busca dar certo. Sem volta automática do botão e sem nova busca no erro.
  - **Clique no botão (G4/G7):** `setDesligadoNoFunil(contarDesligavel ? funilId : null); setRefresh(0); setPagVendas(0)`.
  - `const semResgate = contarDesligavel ? '' : '&semResgate=1'` nas duas buscas (`resumo` e `criativos=1`), com `contarDesligavel` nas dependências dos dois efeitos. Trocar período não mexe no estado. O `cancelado` que já existe descarta resposta de pedido antigo.
  - Botão só quando `d?.desligavel`: mesmo componente visual do botão "Somente ativos" que já existe na página (mesmas classes, mesmo trilho), texto `Contar ${d.desligavel}`, `aria-pressed`, ao lado das abas Visão geral / Vendas.
  - Aviso quando `d && d.desligavel && !d.contandoDesligavel`, com as mesmas classes do aviso âmbar existente (`d.aviso`): texto exato da Global Constraints.
  - Tipo `Detalhe`: `esteira` ganha `foraDaConta: boolean`; `desligavel: string | null`; `contandoDesligavel: boolean`.
  - `FunilEsteira`: no degrau com `foraDaConta`, a opacidade reduzida vai só no texto do rótulo, no percentual e em vendas/faturamento; a marca `fora da conta` fica em âmbar a 100%, sob o rótulo, fora do `truncate`. A faixa colorida (um `<path>` só) passa a ser desenhada duas vezes com o mesmo `d` e o mesmo gradiente: uma com `clipPath` que cobre tudo MENOS a coluna `[colW * i, colW * (i + 1)]` (igual a hoje) e outra com `clipPath` só dessa coluna e `opacity` 0.35. Nenhum retângulo pintado por cima; as linhas divisórias ficam como estão. Sem degrau fora da conta, um único `<path>` como hoje.
  - "Soma da esteira" fica no componente PAI (o bloco com os dois `reduce`, hoje perto de `page.tsx:563`): os DOIS `reduce` (vendas e faturamento) passam a somar só os degraus sem `foraDaConta`.

- [ ] **Step 2: Run** `npx tsc --noEmit` e `npm test` → sem erro.

- [ ] **Step 3: Build** `npx next build` → compila (o `next.config.ts` não lê `NEXT_DIST_DIR`; o build usa `.next`, então rodar com o servidor de desenvolvimento parado e reiniciá-lo depois).

- [ ] **Step 4: Prévia no localhost para o dono:** CSP ligado = igual à produção; desligado = aviso, números batendo com a tabela esperada da Task 2 Step 4 (bruto, vendas, taxas, impostos, resultado, ROAS, margem, reembolsos), investido igual, esteira com a linha apagada e a soma sem ela, aba Vendas sem nenhuma venda do Resgate; trocar de "30 dias" para "7 dias" com o botão desligado mantém desligado e os números mudam de período; criativos (soma das linhas + não atribuído) batendo com a tabela; gráfico do resultado diário menor nos dias com Resgate; sub-aba Reembolsos sem reembolso do Resgate; trocar para Imersão = sem botão; voltar ao CSP = ligado; desligar e recarregar a página = ligado; desligar, sair para outra tela e voltar = ligado.

- [ ] **Step 5: Commit** `feat(funis): botao Contar O Resgate - CSP na tela de funis` e registrar o item 145 no `spr-digital.md` (o que mudou, arquivos, como verificar).

### Task 4: Criativos sem anúncio na lista e falha da busca (defeitos que já existiam)

**Files:**
- Modify: `app/performance-funis/dashboard/page.tsx` (seção de criativos, hoje `page.tsx:409-416` e `page.tsx:497-501`; efeito dos criativos, hoje `page.tsx:165-179`)

**Interfaces:**
- Consumes: o efeito dos criativos da Task 3 (com `semResgate` e `contarDesligavel` nas dependências).

- [ ] **Step 1: Implement**
  - `const [erroCriativos, setErroCriativos] = useState<string | null>(null)`: zera no início do efeito dos criativos; no `.catch` (hoje `.catch(() => {})`), se não cancelado, recebe o texto exato da Global Constraints. Só vale para a busca atual (o `cancelado` que já existe descarta resposta velha).
  - Ramo vazio (`criativos.length === 0`, sem carregar): com `erroCriativos`, mostrar o texto num aviso com as MESMAS classes do erro vermelho que a página já usa (`erro`); sem erro, manter `Nenhum anúncio no período.`.
  - A linha do não atribuído (o mesmo bloco e texto de hoje, `+ N venda(s) sem anúncio identificável na UTM (orgânico / link na bio): R$ ...`) passa a aparecer também no ramo vazio sem erro, sempre que `naoAtribuido.vendas > 0`. Extrair esse bloco para um trecho único usado nos dois ramos (não duplicar o texto).

- [ ] **Step 2: Run** `npx tsc --noEmit` e `npm test` → sem erro.

- [ ] **Step 3: Prévia no localhost (junto da Task 3, Step 4):** período/filtro em que "Somente ativos" não traz anúncio mas há venda orgânica → aparece "Nenhum anúncio no período." e, embaixo, a linha do não atribuído com o valor; tirar a internet do navegador (DevTools, Offline) e clicar em Atualizar → aparece o erro vermelho dos criativos, não "Nenhum anúncio no período."

- [ ] **Step 4: Commit** `fix(funis): criativos mostram o nao atribuido sem anuncio e o erro da busca` e completar o item 145 do `spr-digital.md`.

