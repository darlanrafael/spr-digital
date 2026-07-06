# Custo de Tráfego em Fechamentos — Design

## Objetivo

Na Etapa 1 (Custos) do fluxo de Novo Fechamento, adicionar um terceiro
quadrante "Custo de Tráfego" ao lado de Custos Fixos e Custos Variáveis.
O usuário escolhe um período próprio (independente do período de vendas
da Etapa 2) e um ou mais termos de filtro (ex: "funil1", "lançamento-julho").
O sistema busca o gasto do Meta Ads de todas as campanhas cujo nome
contenha (case-insensitive) pelo menos um dos termos digitados, soma o
total, e inclui esse total no Total de Custos do fechamento.

## Por que

Hoje o custo de tráfego (Meta Ads) só aparece no Dashboard, vinculado à
nomenclatura fixa por projeto (`PROJECT_NOMENCLATURAS`). Não há como
segmentar o gasto por funil/campanha dentro de um fechamento específico.
O usuário fecha o financeiro por funil (ex: Funil 1, Funil 2) e precisa
poder puxar o gasto de tráfego de cada funil isoladamente, usando os
próprios termos que aparecem no nome das campanhas daquele funil.

## Arquitetura

### 1. API — reaproveitar `getProjectInvestment`

`lib/meta.ts` já expõe `getProjectInvestment(nomenclaturas, dateStart, dateEnd, datePreset?)`,
que busca campanhas em todas as contas Meta configuradas e filtra
localmente por `c.name.toLowerCase().includes(termo.toLowerCase())` (OR
entre termos). Essa função não precisa mudar.

Novo endpoint `app/api/meta/custo-trafego/route.ts` (GET):
- Query params: `dateStart`, `dateEnd`, `termos` (múltiplos, ex:
  `?termos=funil1&termos=lancamento-julho`).
- Chama `getProjectInvestment(termos, dateStart, dateEnd)` diretamente
  (sem `projectId`/`PROJECT_NOMENCLATURAS` — os termos vêm 100% do
  usuário).
- Retorna `{ total, totalFormatado, campanhas: MetaCampanha[] }`, mesmo
  formato do `/api/meta/insights` existente.
- Se `termos` vier vazio ou `dateStart`/`dateEnd` faltando, retorna
  `{ total: 0, campanhas: [] }` sem chamar a Meta API.

### 2. UI — `app/fechamentos/page.tsx`, Etapa 1 (Custos)

Novo estado local em `FechamentosContent`:

```tsx
const [trafego, setTrafego] = useState<{
  periodo: { inicio: string; fim: string }
  termos: string[]
  termoInput: string
  loading: boolean
  erro: boolean
  total: number
  campanhas: { name: string; spend: number; accountId: string }[]
  buscado: boolean
}>({
  periodo: { inicio: '', fim: '' },
  termos: [],
  termoInput: '',
  loading: false,
  erro: false,
  total: 0,
  campanhas: [],
  buscado: false,
})
```

Novo quadrante (mesmo estilo visual dos outros dois — `bg-gray-900
rounded-xl border border-white/10 p-4`), posicionado depois de "Custos
Variáveis" e antes do card "Total de Custos":

- Dois inputs de data (início/fim), mesmo estilo dos date-pickers da
  Etapa 2.
- Input de texto + Enter (ou botão "+") adiciona um termo como chip
  removível (`×` para remover). Sem limite de termos.
- Botão "Buscar tráfego" — desabilitado se período incompleto ou nenhum
  termo. Ao clicar, chama o endpoint novo, mostra spinner enquanto
  `loading`.
- Resultado: total em destaque (`text-red-400`, mesmo padrão dos outros
  subtotais) + lista expansível (`<details>`) das campanhas encontradas
  (nome + valor formatado), para conferência.
- Erro de busca: mensagem inline, mesmo padrão usado no card de Meta Ads
  do Dashboard (`erro` boolean).

`Total de Custos` passa a ser `fixedTotal + varTotal + trafego.total`.

### 3. Tipos — `types/index.ts`

Novos campos opcionais em `Closing`:

```ts
export interface Closing {
  // ...existentes
  custos_trafego_total?: number
  custos_trafego_periodo?: { inicio: string; fim: string }
  custos_trafego_termos?: string[]
  custos_trafego_campanhas?: { name: string; spend: number; accountId: string }[]
}
```

### 4. Persistência — Supabase

Nova migração `supabase/migrations/20260705_add_custo_trafego_closings.sql`:

```sql
ALTER TABLE closings ADD COLUMN IF NOT EXISTS custos_trafego_total NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE closings ADD COLUMN IF NOT EXISTS custos_trafego_periodo_inicio DATE;
ALTER TABLE closings ADD COLUMN IF NOT EXISTS custos_trafego_periodo_fim DATE;
ALTER TABLE closings ADD COLUMN IF NOT EXISTS custos_trafego_termos TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE closings ADD COLUMN IF NOT EXISTS custos_trafego_campanhas JSONB NOT NULL DEFAULT '[]';
```

`supabase/schema.sql` (fonte de referência, não executado em produção)
recebe as mesmas colunas na definição da tabela `closings`, para ficar
consistente com o banco real.

`lib/services.ts`:
- `addClosing`: grava os 5 campos novos no `upsert` (mapeando de
  `closing.custos_trafego_*`).
- `getClosings` (leitura): mapeia as colunas de volta para o formato
  `Closing`, incluindo o objeto `periodo` aninhado a partir de
  `custos_trafego_periodo_inicio`/`_fim`.

### 5. `handleConfirm` (fechamentos/page.tsx)

Ao montar `newClosing`, inclui:

```ts
custos_trafego_total: trafego.total,
custos_trafego_periodo: trafego.periodo,
custos_trafego_termos: trafego.termos,
custos_trafego_campanhas: trafego.campanhas,
```

`custosTotais` (campo já existente) passa a incluir o tráfego:
`fixedTotal + varTotal + trafego.total`.

### 6. Histórico de Fechamento

No detalhe do fechamento (onde hoje aparecem as linhas "Custos fixos" e
"Custos variáveis" — `app/fechamentos/page.tsx` linhas ~868-869), nova
linha "Custo de tráfego" (mesma cor `text-red-400`, `neg: true`),
exibida somente quando `custos_trafego_total > 0`. Ao lado, texto
pequeno com o período e os termos usados (ex: "01/07 a 04/07 · funil1,
lançamento-julho").

## Casos de borda

- Nenhum termo digitado → botão "Buscar" fica desabilitado (não faz
  sentido buscar "tudo").
- Token do Meta (`META_ACCESS_TOKEN`) não configurado → endpoint retorna
  `{ total: 0, campanhas: [], erro: 'Token não configurado' }` (mesmo
  comportamento do endpoint existente); UI mostra erro, total fica 0 e
  não trava o fechamento.
- Fechamento antigo sem custo de tráfego (antes desta feature) →
  colunas novas com `DEFAULT 0` / `'{}'` / `'[]'`, a linha de tráfego no
  histórico simplesmente não aparece.
- Buscar de novo depois de confirmado: os campos de tráfego só são
  gravados no momento da confirmação (`handleConfirm`), igual aos
  demais totais — se o usuário mudar termos/período depois de já ter
  confirmado, precisa ser um novo fechamento (mesma regra dos outros
  campos, que já são imutáveis pós-confirmação).

## Fora de escopo

- Não altera a busca de Meta Ads do Dashboard (`app/page.tsx`,
  `PROJECT_NOMENCLATURAS`) — mecanismo separado, mantido como está.
- Não persiste os termos como "favoritos" ou sugestões — cada
  fechamento digita os termos do zero (não há histórico de termos
  usados anteriormente nesta v1).
- Não segmenta por conta de anúncio — soma todas as 5 contas
  configuradas, igual ao mecanismo existente.
