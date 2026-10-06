# Fix aviso Meta indisponivel (2B)
- route.ts: metaDisponivel = !!META_ACCESS_TOKEN; campo `aviso` (null ou texto) na visao geral e no detalhe.
- page.tsx: banner ambar quando `aviso` vem preenchido, na visao geral e no detalhe.
- Fora de escopo: falha parcial por conta (exige mudar assinaturas de lib/meta).
- Verificacao: tsc sem erro; npm test 871 pass, 0 fail.
