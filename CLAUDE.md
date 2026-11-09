# CLAUDE.md

Fino, só aponta. Leia [AGENTS.md](AGENTS.md) (comandos, regras travadas pelo código, desvios
registrados) e [docs/adr/](docs/adr/) (as decisões, cada uma com gatilho de reversão quando foi
decidida contra alternativa).

Convenções: TypeScript ESM com imports `./x.ts`; identificadores, mensagens e comentários em
português; domínio puro em `src/domain`; vitest em quatro modos; Postgres real sob `withRollback`.
