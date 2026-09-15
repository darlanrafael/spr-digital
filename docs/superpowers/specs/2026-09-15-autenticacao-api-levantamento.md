# Autenticação das rotas de API - levantamento para revisão

**Data:** 15/09/2026
**Para quê:** você pediu para revisar as regras no caminho, em vez de só cumprir
as de hoje. Este documento é o que você revisa. **Nada foi implementado.**

---

## O estado de hoje, em três frases

1. Não existe `middleware.ts`. O login guarda a sessão no `localStorage` e
   protege **as telas**; as rotas que entregam o dado não conferem sessão.
2. Onde há conferência, ela é: "manda um e-mail que exista na tabela de
   usuários" - e o e-mail vem do navegador. Na tela de aprovações ele está
   **fixo no código** como `'rafael@spr.com'`.
3. O próprio código registra isso. Em `app/api/terapeutas/admin/log/route.ts`
   está escrito: *"Esta rota nao exige autenticacao (nenhum GET de
   app/api/terapeutas exige)"*.

## Duas descobertas que você ainda não sabia

**A.** Existe **escrita** sem nenhuma conferência, não só leitura. A pior é
`POST /api/terapeutas/admin/usuarios`: cria usuário em `usuarios_sistema` com
qualquer `tipo` e qualquer `permissoes`. Quem criar um para si passa a ter login
legítimo, e daí em diante não é invasão, é acesso normal.

**B.** A coluna `permissoes` de `usuarios_sistema` é **gravada e nunca lida**.
A tela de admin deixa marcar permissões que não têm efeito nenhum. O modelo de
permissão que você desenhou existe no banco e na tela, e não é cumprido em lugar
nenhum.

---

## O que NÃO pode ser tocado (restrição do trabalho)

Estas 7 rotas não têm login por natureza. Exigir prova nelas **quebra o
sistema em silêncio**:

| rota | por que fica aberta |
|---|---|
| `webhooks/hubla` POST | é a Hubla chamando você para avisar de venda nova |
| `webhooks/kiwify` POST | idem, Kiwify |
| `whatsapp/pendentes-vespera` GET | cron; já tem segredo próprio (`x-whatsapp-cron-secret`) |
| `whatsapp/pendentes-30min` GET | idem |
| `whatsapp/marcar-enviado` POST | idem |
| `dashboard-usuarios/login` POST | é o próprio login do DRE |
| `terapeutas/login` POST | é o próprio login do módulo de terapeutas |

Se as duas primeiras passassem a exigir prova, **as vendas parariam de entrar e
ninguém receberia erro na tela**. Você descobriria dias depois, com venda
faltando. Esta restrição fica escrita no plano, com verificação explícita antes
de publicar.

---

## GRUPO 1 - Escrita sem nenhuma conferência

O grupo mais grave. Nenhuma dessas rotas tem uma única linha de verificação.

| rota | o que dá para fazer hoje, sem login |
|---|---|
| `POST terapeutas/admin/usuarios` | criar usuário com qualquer tipo e permissão |
| `PUT terapeutas/admin/usuarios` | alterar usuário existente |
| `POST/PUT/PATCH terapeutas/admin/terapeutas` | criar terapeuta e mudar **percentual de comissão** |
| `POST closings` | criar fechamento |
| `PATCH sales` | alterar venda |
| `POST/PUT/DELETE costs` | criar, alterar e **apagar custo** |
| `POST cashflow` | lançar movimento no caixa |
| `POST/PUT/PATCH dashboard-usuarios` | criar e alterar usuário do DRE |

**Minha proposta:** só quem está logado em `usuarios_dashboard` com `role`
`admin` ou `socio`. Hoje são papéis que já existem (`admin`, `gestor`,
`financeiro`, `socio`).

**SUA DECISÃO:** o `gestor` e o `financeiro` podem mexer em custo e em caixa?
E em fechamento? Hoje qualquer um pode, inclusive quem não está logado.

---

## GRUPO 2 - Leitura do DRE financeiro

| rota | o que entrega |
|---|---|
| `GET sales` | todas as vendas, com nome, e-mail e valores |
| `GET closings` | todos os fechamentos |
| `GET costs` | todos os custos |
| `GET cashflow` | o caixa |
| `GET meta/insights`, `meta/custo-trafego`, `meta/test` | gasto de tráfego do Meta |

Nenhuma exige nada hoje.

**Minha proposta:** qualquer um logado em `usuarios_dashboard`.

**SUA DECISÃO:** tem papel que NÃO deve ver faturamento ou fechamento? Por
exemplo, `seller` (o valor aparece no código, embora não esteja no tipo
`UserRole`).

---

## GRUPO 3 - Leitura do módulo de terapeutas

| rota | o que entrega | exige hoje |
|---|---|---|
| `GET terapeutas/dashboard` | nome e e-mail de paciente, comissão e faturamento **por terapeuta**; aceita `terapeutaId=all` | **nada** |
| `GET terapeutas/admin/log` | log de atividade, com e-mail e telefone de paciente e valores de venda | **nada** |
| `GET terapeutas/estornos-com-sessao` | pacientes com estorno e sessão futura | e-mail existe |
| `GET terapeutas/fechamentos` | histórico de pagamento da terapeuta | senha |
| `GET terapeutas/sessoes` | sessões | senha ou token |
| `GET terapeutas/vendas` | vendas do painel do terapeuta | senha ou token |
| `GET terapeutas/vendas/pacote` | pacotes a conferir | senha ou token + e-mail |
| `GET terapeutas/aprovacoes*` | filas de aprovação | senha |

**O ponto central deste grupo.** A regra "cada terapeuta só vê o que é dela"
**existe**, em `app/terapeutas/[id]/page.tsx:895-898`: se o usuário logado é
terapeuta e o `terapeuta_id` dela não é o da página, a tela **redireciona**.

Mas é redirecionamento **no navegador**. Em
`app/api/terapeutas/dashboard/route.ts:139` está:

```ts
const terapeutaId = searchParams.get('terapeutaId') ?? 'all'
```

Quem manda o `terapeutaId` é quem chama. Chamando a rota direto com
`terapeutaId=all`, a Denise recebe tudo, inclusive o faturamento do Pedro.

**Minha proposta:** o servidor passa a decidir o `terapeuta_id` a partir de
QUEM está chamando: usuário `tipo='terapeuta'` só recebe o próprio, e o
parâmetro do cliente é **ignorado** nesse caso. `tipo='admin'` continua podendo
pedir `all`.

**SUA DECISÃO:** confirma que terapeuta nunca vê dado de outra terapeuta? E o
`tipo='comercial'` - vê de todas, ou de nenhuma?

---

## GRUPO 4 - Operação do terapeuta e do comercial

| rota | o que faz | exige hoje |
|---|---|---|
| `POST terapeutas/sessoes/agendar` | cria, apaga e altera sessões | senha ou token |
| `POST terapeutas/sessoes/confirmar` | marca sessão como entregue | senha ou token |
| `POST terapeutas/sessoes/remarcar` | remarca | senha ou token |
| `POST terapeutas/sessoes/empurrar-seguintes` | empurra o resto do pacote | senha ou token |
| `PATCH terapeutas/sessoes` | altera sessão | senha ou token |
| `POST/DELETE terapeutas/compromissos` | bloqueia e libera horário na agenda | senha ou token |
| `PUT terapeutas/vendas/editar-paciente` | pede troca de dados do paciente | senha ou token |
| `POST terapeutas/vendas/lancamento-manual` | pede lançamento manual | **senha** |
| `POST/DELETE terapeutas/vendas/pacote` | junta e separa compras | senha ou token + e-mail |

Aqui a exigência de identidade existe. **O que não existe é escopo:** nada
confere se a sessão que está sendo remarcada é de quem está remarcando.

**Minha proposta:** manter a exigência como está (ela já funciona) e acrescentar
escopo: usuário `tipo='terapeuta'` só age em sessão e compromisso do próprio
`terapeuta_id`.

**SUA DECISÃO:** isso muda o dia a dia? Existe caso legítimo de uma terapeuta
mexer na agenda da outra, ou do comercial agendar para as duas? Se existe, o
escopo precisa ser por `tipo`, não por pessoa.

---

## GRUPO 5 - Decisão do CEO

| rota | o que faz | exige hoje |
|---|---|---|
| `PATCH terapeutas/aprovacoes` | aprova e rejeita reembolso | senha |
| `PATCH terapeutas/aprovacoes/lancamento-manual` | aprova lançamento manual | senha ou token + e-mail |
| `PATCH terapeutas/aprovacoes/edicao-paciente` | aprova troca de dados de paciente | senha ou token + e-mail |
| `POST terapeutas/fechamentos` | confirma pagamento da terapeuta | senha |
| `POST sales/converter-moeda` | converte venda em moeda estrangeira | e-mail existe |

Há uma regra sua registrada em `lib/terapeutas-auth.ts`, e ela é boa:

> *"os endpoints que mexem em dinheiro NÃO usam `verificarAcesso` - continuam
> chamando `verificarSenhaUsuario` direto. É de propósito: assim é impossível um
> token virar credencial financeira por descuido numa refatoração futura."*

Duas rotas de dinheiro **não seguem** essa regra hoje: `aprovacoes/lancamento-manual`
e `aprovacoes/edicao-paciente` aceitam token, e `sales/converter-moeda` aceita
só o e-mail.

**Minha proposta:** as cinco passam a exigir senha na hora, sem exceção, e só
de usuário `tipo='admin'`.

**SUA DECISÃO:** concorda em exigir senha nas três que hoje não exigem? Isso
significa digitar senha em aprovação de lançamento manual e em troca de dados de
paciente, que hoje passam com o crachá.

---

## O que eu preciso de você

Cinco decisões, uma por grupo. Elas são o que falta para eu escrever o desenho e
depois o plano.

Nada será implementado antes de você aprovar o desenho.
