# Autenticação das rotas de API - desenho

**Data:** 15/09/2026
**Decisões do usuário já tomadas:** todas as rotas (não só a exposta); revisar as
regras no caminho; mecanismo = **opção A, o crachá que já existe**.

---

## 1. O problema, provado por execução

Não é leitura de código. As três chamadas abaixo foram feitas contra o sistema
rodando, sem nenhuma credencial, em 15/09/2026:

| chamada | resposta |
|---|---|
| `GET /api/terapeutas/dashboard?terapeutaId=all` | **200**, 91.855 bytes: faturamento da Denise (R$ 84.141,98) e do Pedro (R$ 282.442,30), e 11 consultas de hoje com **nome e e-mail de paciente** |
| `POST /api/terapeutas/admin/usuarios` (corpo vazio) | **400 "Campos obrigatórios ausentes"** - ou seja, a rota aceitou a chamada sem login e chegou até a validação do corpo. Com o corpo completo teria criado o usuário |
| `GET /api/closings` | **200**, 2,5 MB, os 8 fechamentos com o array `socios` - exatamente a divisão que a tela esconde do sócio |

## 2. O que existe hoje (verificado no banco)

**Duas áreas de login separadas, que não se falam.**

`usuarios_dashboard` (DRE) - 2 pessoas: Rafael (`admin`), Reinaldo (`socio`).
`usuarios_sistema` (terapeutas) - 7 pessoas: 1 `admin`, 4 `comercial`, 2 `terapeuta`.

**As regras existem, e vivem no navegador:**

- `app/fechamentos/page.tsx:240` - `podeVerRepasse = user?.role !== 'socio'`
  esconde a **Divisão entre Sócios** e as linhas de repasse de cada sócio.
- `app/caixa/page.tsx:55`, `app/page.tsx:246`, `app/fechamentos/page.tsx:237` -
  `canEdit = role === 'admin'`.
- `app/dre/page.tsx:61` - `canEdit = admin || financeiro`.
- `components/Header.tsx:34` - o menu do `comercial` tem **um item só**
  (Terapeutas); Admin, Fechamentos e Aprovações só aparecem para `role === 'admin'`.
- `app/terapeutas/layout.tsx:39` - `tipo === 'terapeuta'` fica confinada à
  própria página.
- `app/terapeutas/layout.tsx:27` - **quem tem sessão do DRE tem acesso total ao
  módulo de terapeutas**, sem restrição de terapeuta.

**Duas coisas que não funcionam:**

- A coluna `permissoes` de `usuarios_sistema` é gravada e **nunca lida**.
- `app/terapeutas/admin/page.tsx:326` - a guarda é `if (user && user.role !== 'admin')`.
  O `user` vem do login do DRE; para um usuário de `usuarios_sistema` ele é vazio
  e a guarda é pulada. O que protege hoje é o menu não oferecer o caminho.

## 3. Como vai funcionar

**3.1.** `usuarios_dashboard` ganha as duas colunas que `usuarios_sistema` já
tem: `session_token` e `session_token_expira_em`. O login do DRE passa a emitir
crachá; o de terapeutas já emite.

**3.2.** As telas mandam o crachá num cabeçalho fixo, igual nas duas áreas.

**3.3.** Um `middleware.ts` na raiz roda **antes** de qualquer rota de API:
- deixa passar as 7 rotas da lista de exceção (seção 4);
- nas demais, lê o crachá, descobre de quem é, e recusa com **401** se não
  existir ou estiver vencido;
- **entrega a identidade para a rota**, num cabeçalho que só o servidor escreve.

**3.4.** As rotas passam a usar essa identidade **no lugar do que o cliente
mandou**. O caso que resume tudo, em `app/api/terapeutas/dashboard/route.ts:139`:

```
hoje:  const terapeutaId = searchParams.get('terapeutaId') ?? 'all'
fica:  quem é terapeuta  -> o terapeuta_id é o DELA; o parâmetro é ignorado
       quem é admin      -> o parâmetro vale, inclusive 'all'
```

**Custo honesto:** cada chamada de API ganha uma consulta a mais no banco, para
conferir o crachá. No tamanho da operação de hoje isso é irrelevante.

## 4. O que NÃO pode ser tocado

| rota | por quê |
|---|---|
| `webhooks/hubla` POST | é a Hubla chamando o sistema para avisar de venda nova |
| `webhooks/kiwify` POST | idem |
| `whatsapp/pendentes-vespera` GET | cron; já tem `x-whatsapp-cron-secret` |
| `whatsapp/pendentes-30min` GET | idem |
| `whatsapp/marcar-enviado` POST | idem |
| `dashboard-usuarios/login` POST | é o próprio login |
| `terapeutas/login` POST | idem |

Exigir crachá nos dois webhooks **pararia a entrada de vendas em silêncio**.
Nenhum erro apareceria em tela; a falta só seria notada dias depois, com venda
faltando. Verificação obrigatória antes de publicar: chamar os dois webhooks e o
cron e confirmar que continuam respondendo como hoje.

## 5. As regras que passam a valer

| quem | regra |
|---|---|
| DRE `admin` | tudo |
| DRE `socio` | vê tudo, **menos a divisão entre sócios**; não edita caixa, DRE nem fechamento |
| Terapeutas `admin` | tudo |
| Terapeutas `comercial` | o operacional (agendar, remarcar, pedir lançamento manual). **Não** cria usuário, **não** troca senha, **não** muda percentual de comissão |
| Terapeutas `terapeuta` | só o próprio `terapeuta_id`, para ver e para agir |

A regra do sócio muda de forma: não basta recusar a chamada. `GET /api/closings`
devolve o fechamento inteiro, então a rota terá de **remover os valores dos
sócios da resposta** quando quem chama é `socio` - o mesmo efeito da tela, feito
onde o dado sai.

## 6. As fases

Cada fase vai ao ar sozinha sem quebrar nada. Se eu errar numa, as anteriores
continuam de pé.

**Fase 1 - emitir.** Coluna nova em `usuarios_dashboard`, login do DRE passando a
devolver crachá. Nada passa a exigir nada. Sistema idêntico ao de hoje.

**Fase 2 - mandar.** As telas passam a anexar o crachá em toda chamada. As rotas
ainda não exigem. Sistema idêntico ao de hoje.

**Fase 3 - conferir.** O `middleware.ts` entra e passa a exigir. É a única fase
em que algo pode parar de funcionar - e, se parar, o desfazer é voltar o deploy
anterior na Vercel, um clique.

**Fase 4 - mandar na identidade.** As rotas passam a usar a identidade do
middleware no lugar do parâmetro do cliente, e as regras da seção 5 passam a
valer.

## 7. Erro e teste

**Quando a prova falha:** 401 com uma mensagem que diz para entrar de novo - não
"senha incorreta", que mandaria a pessoa para o caminho errado.

**Crachá vencido:** o módulo de terapeutas já distingue vencido de inválido
(`ResultadoAcesso.expirado`). O mesmo tratamento vale para o DRE.

**Como isto é testado.** Teste que lê código não prova acesso. Cada regra da
seção 5 ganha um teste que **faz a chamada** e confere o que voltou:

- sem crachá -> 401 em toda rota que não está na lista de exceção;
- crachá de terapeuta pedindo `terapeutaId=all` -> vem só o dela;
- crachá de comercial em `admin/usuarios` -> 401;
- crachá de sócio em `GET /api/closings` -> 200, e **sem** os valores dos sócios;
- os 2 webhooks e as 3 rotas de cron -> continuam respondendo como hoje.

## 8. Em aberto, para o usuário decidir

1. **Reinaldo (sócio) entra no módulo de terapeutas hoje**, por
   `layout.tsx:27`, e lá vê nome de paciente e comissão. Mantém ou restringe?
2. **`FELIPE TESTE` (`FELIPE@GMAIL.COM`) está ativo** como comercial. Desativa?
3. **Mariana Longo nunca logou** desde 21/06/2026 e não tem nenhuma ação
   registrada. Mantém o login ativo?
