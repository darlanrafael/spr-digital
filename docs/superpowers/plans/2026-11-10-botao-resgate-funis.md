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
- Sem travessão em texto da tela. Sem commit de credencial. Push só com pedido explícito do dono.

## Revisão do plano (10/11/2026)

Codex atacante + Codex auditor + Gemini. Achados aceitos e já incorporados abaixo: estado do botão quando a busca falha (A1, ALTO); dia só com Resgate sumindo do gráfico diário (A3, MÉDIO); prova da fiação da rota (Au1/Au2, ALTO) por renomeação estrutural + conferência com números esperados do banco; soma da esteira no componente pai (Au3); Imersão ignora o parâmetro (Au4); teste por id com nome divergente e plataforma errada (Au5); recarregar e sair/voltar (Au6). Gemini (sobre o plano já corrigido): sem volta automática do botão quando a busca falha, que apagava o erro e podia desligar um período novo (G1, ALTO); faixa SVG da esteira apagada junto (G2, ALTO); criativos na prova (G3); clique no botão zera o "Atualizar" (G4); reset ao trocar de funil já no clique (G5); testes de `diasDasVendas` e `diasExtras` (G6); paginação da aba Vendas volta à 1 (G7). Fora do escopo, registrados para o dono como defeitos que já existem: "não atribuído" some quando não há anúncio na lista (A2) e falha da busca de criativos aparece como "Nenhum anúncio no período" (G1.3).

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

  - `resultadoDiario` (em `lib/funis/cadencia-do-funil.ts`) ganha o 4º parâmetro opcional `diasExtras: string[] = []`: teste em `lib/funis/cadencia-do-funil.test.ts` com vendas só em `2026-11-07` e `2026-11-09`, sem tráfego, `diasExtras: ['2026-11-08']` → 3 pontos em ordem, o de `2026-11-08` com `faturamento: 0` e `resultadoLiquido: 0`; sem o parâmetro → 2 pontos (comportamento atual).
  - `diasExtras` com um dia que JÁ tem venda (`['2026-11-07']`) → o ponto não duplica nem zera (mesmos 2 pontos e valores de sem o parâmetro).
  - `diasDasVendas(vendas: { data_hora: string }[]): string[]` (em `produto-desligavel.ts`): dias únicos `data_hora.slice(0, 10)`, ordenados; teste com duas vendas no mesmo dia e uma em outro → 2 dias.

- [ ] **Step 2: Run** `npx tsx --test lib/funis/produto-desligavel.test.ts lib/funis/cadencia-do-funil.test.ts` → FAIL (módulo e parâmetro não existem).

- [ ] **Step 3: Implement** a marca no config, `diasExtras` em `resultadoDiario` (só acrescenta os dias ao conjunto de dias) e as quatro funções em `lib/funis/produto-desligavel.ts`, usando `FUNIS`, `funilDaVenda` e `produtoDoFunil` de `./funis-config` e o tipo `EstagioEsteira` de `./esteira-do-funil`.

- [ ] **Step 4: Run** `npx tsx --test lib/funis/produto-desligavel.test.ts lib/funis/cadencia-do-funil.test.ts lib/funis/funis-config.test.ts lib/funis/esteira-do-funil.test.ts lib/funis/vendas-do-funil.test.ts` → PASS.

- [ ] **Step 5: Commit** `feat(funis): marca desligavel no O RESGATE - CSP e filtro puro`.

### Task 2: Rota lê `semResgate=1`

**Files:**
- Modify: `app/api/funis/performance/route.ts`

**Interfaces:**
- Consumes: as três funções da Task 1.
- Produces (resposta do detalhe e da chamada `criativos=1`, campos novos): `desligavel: string | null` (= `produtoDesligavelDoFunil(funil.id)`), `contandoDesligavel: boolean` (= `!excluir`); `esteira` passa a ser `(EstagioEsteira & { foraDaConta: boolean })[]`. Query: `semResgate=1` desliga; qualquer outro valor ou ausente = ligado.

- [ ] **Step 1: Implement**
  - `excluir`: com `funilId`, `sp.get('semResgate') === '1' && produtoDesligavelDoFunil(funilId) !== null` (Imersão ignora o parâmetro: resposta idêntica); sem `funilId` (visão geral), só `sp.get('semResgate') === '1'`.
  - **Renomeação estrutural (prova da fiação):** nos dois ramos, o resultado do `cacheCurto.get` passa a se chamar `vendasTodas` / `reembolsosTodos`, e logo abaixo `const vendas = excluir ? semProdutosDesligaveis(vendasTodas) : vendasTodas` (idem `reembolsos`). Todo o código existente continua usando `vendas` / `reembolsos` sem nenhuma outra mudança. `vendasTodas` só aparece em dois lugares: na esteira, `marcarForaDaConta(agregarEsteira(vendasTodas, funil.id), funil.id, excluir)`, e no `diasExtras` do `resultadoDiario`, que recebe `excluir ? diasDasVendas(<vendasTodas do funil, aprovadas>) : []`. O cache continua guardando a lista inteira (chaves `vendas|${periodo}` e `reemb|${periodo}` intactas).
  - Incluir os dois campos novos no JSON do detalhe e no da chamada `criativos=1`.

- [ ] **Step 2: Run** `npx tsc --noEmit` → sem erro; `npm test` → tudo passa.

- [ ] **Step 3: Conferir a fiação:** `grep -n "vendasTodas\|reembolsosTodos" app/api/funis/performance/route.ts` → `vendasTodas` definido nos DOIS ramos (criativos e resumo) e `reembolsosTodos` no resumo; fora das definições, só a esteira e o `diasExtras`. `grep -n "getSalesParaFunil\|getReembolsosParaFunil" app/api/funis/performance/route.ts` → toda chamada cai numa variável `...Todas`/`...Todos`.
- [ ] **Step 4: Números esperados do banco** (script na pasta de rascunho, fora do projeto, lendo pela REST, só leitura): para "Últimos 30 dias" a partir de `DATA_CORTE_FUNIS`, somar das vendas aprovadas do Resgate CSP a quantidade, `valor_pago_cliente`, taxas (`pago - liquido`) e, dos reembolsos do Resgate no período, o total. Daí sai a tabela esperada do estado desligado: bruto, vendas e taxas caem esses valores; impostos = bruto × 0,1285; investido e tráfego com acréscimo iguais; total de reembolsos cai o total do Resgate; nos criativos, (soma do faturamento das linhas + `naoAtribuido.faturamento`) cai o bruto do Resgate. Essa tabela vai para a prévia do dono (Task 3, Step 4), que confere na tela.

- [ ] **Step 5: Commit** `feat(funis): rota de performance aceita semResgate=1`.

### Task 3: Botão, aviso e esteira na página

**Files:**
- Modify: `app/performance-funis/dashboard/page.tsx`

**Interfaces:**
- Consumes: `desligavel`, `contandoDesligavel`, `esteira[].foraDaConta` da Task 2.

- [ ] **Step 1: Implement**
  - `const [contarDesligavel, setContarDesligavel] = useState(true)`; no efeito que já roda em `[funilId]`, voltar para `true`.
  - **O que a tela mostra sai da resposta, não do botão (A1/G1):** o aviso e a marca da esteira usam `d.contandoDesligavel`. `const resumoDesatualizado = !!d && d.contandoDesligavel !== contarDesligavel`: enquanto for true, o bloco de números fica com a mesma opacidade do `carregando` que já existe (e assim fica se a busca falhar, com o erro que a página já mostra). Sem volta automática do botão e sem nova busca no erro. Criativos: guardar `criativosContando` (o `contandoDesligavel` da resposta); a seção de criativos fica com a opacidade do carregando enquanto `criativosContando !== contarDesligavel`.
  - **Clique no botão (G4/G7):** `setContarDesligavel(x => !x); setRefresh(0); setPagVendas(0)`.
  - **Troca de funil (G5):** `selecionar(id)` também faz `setContarDesligavel(true)` antes do `router.push` (o reset no efeito de `[funilId]` fica para voltar/avançar do navegador).
  - `const semResgate = contarDesligavel ? '' : '&semResgate=1'` nas duas buscas (`resumo` e `criativos=1`), com `contarDesligavel` nas dependências dos dois efeitos. Trocar período não mexe no estado.
  - Botão só quando `d?.desligavel`: mesmo componente visual do botão "Somente ativos" que já existe na página (mesmas classes, mesmo trilho), texto `Contar ${d.desligavel}`, `aria-pressed`, ao lado das abas Visão geral / Vendas.
  - Aviso quando `d && d.desligavel && !d.contandoDesligavel`, com as mesmas classes do aviso âmbar existente (`d.aviso`): texto exato da Global Constraints.
  - Tipo `Detalhe`: `esteira` ganha `foraDaConta: boolean`; `desligavel: string | null`; `contandoDesligavel: boolean`.
  - `FunilEsteira`: degrau com `foraDaConta` fica com opacidade reduzida nas três linhas da coluna (rótulo, percentual, vendas/faturamento) e a marca `fora da conta` em âmbar sob o rótulo (sem `truncate` cortando a marca). A faixa colorida é um `<path>` só (G2): depois dele, um `<rect x={colW * i} width={colW}>` com a altura do SVG e a cor de fundo do card (`#121319`) a 60% de opacidade apaga só o trecho daquele degrau.
  - "Soma da esteira" fica no componente PAI (o bloco com os dois `reduce`, hoje perto de `page.tsx:563`): os DOIS `reduce` (vendas e faturamento) passam a somar só os degraus sem `foraDaConta`.

- [ ] **Step 2: Run** `npx tsc --noEmit` e `npm test` → sem erro.

- [ ] **Step 3: Build** `NEXT_DIST_DIR=.next-buildcheck npx next build` → compila.

- [ ] **Step 4: Prévia no localhost para o dono:** CSP ligado = igual à produção; desligado = aviso, números batendo com a tabela esperada da Task 2 Step 4 (bruto, vendas, taxas, impostos, resultado, ROAS, margem, reembolsos), investido igual, esteira com a linha apagada e a soma sem ela, aba Vendas sem nenhuma venda do Resgate; trocar para "30 dias" mantém desligado; trocar para Imersão = sem botão; voltar ao CSP = ligado; desligar e recarregar a página = ligado; desligar, sair para outra tela e voltar = ligado.

- [ ] **Step 5: Commit** `feat(funis): botao Contar O Resgate - CSP na tela de funis` e registrar o item 145 no `spr-digital.md` (o que mudou, arquivos, como verificar).
