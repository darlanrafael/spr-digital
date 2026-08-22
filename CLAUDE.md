# Regras deste projeto

## Documentação — qual arquivo atualizar

Dois sistemas, dois documentos. **Nunca misture.**

| Se você mexeu em… | Atualize |
|---|---|
| DRE financeiro, vendas, webhooks Kiwify/Hubla, imposto, comissão, reembolso, fechamento, fluxo de caixa, Meta Ads | `spr-digital.md` |
| Agenda dos terapeutas, sessões, compromissos, link do Meet, lembretes de WhatsApp dos pacientes, aprovações | `spr-digital.md` |
| **Qualquer coisa do ClickUp / gestor de projetos** | **`clickup.md`** |

Regra dada pelo usuário em 21/08/2026: *"tudo que for feito a nível de ClickUp
sempre atualiza o MD do ClickUp, sempre. Sem misturar as coisas."*

Vale para tudo: código, decisão de arquitetura, pendência, credencial, resultado
de investigação. Se uma mudança tocar os dois sistemas, escreva em cada
documento a parte que é dele e ligue um ao outro por um ponteiro de uma linha —
**nunca duplique o conteúdo**, porque as duas cópias divergem e ninguém sabe
qual está certa.

Desenhos de feature continuam indo para `docs/superpowers/specs/`, de qualquer
um dos sistemas.

## Isolamento do módulo ClickUp

O usuário pediu isso explicitamente: *"meu medo é misturar e virar uma farofa
tudo"*. Decidido em 21/08 manter o ClickUp no mesmo projeto (Jeito B), com
isolamento rigoroso:

- Rotas apenas em `app/api/clickup/`
- Lógica apenas em `lib/clickup/`
- Tabelas com prefixo `clickup_`
- `lib/clickup/*` importa só de si mesmo e de `@/lib/supabase`
- Nada fora dessas pastas importa de dentro delas
- Nenhum arquivo existente é modificado pelo módulo

Precedente que sustenta a regra: o módulo de terapeutas convive assim há meses —
seus arquivos importam apenas de si mesmos e de `@/lib/supabase`, nunca do lado
financeiro.

Quando duplicar for a escolha certa (ex.: `lib/clickup/telefone.ts` é cópia de
`lib/telefone.ts`), duplique e escreva o porquê no arquivo. Trinta linhas
copiadas custam menos que um acoplamento invisível entre dois sistemas.

## Credenciais

`.env.local` está no `.gitignore` (linha 34). Nenhum valor real de credencial
entra em documento, commit ou código — só o nome da variável e onde encontrá-la.
