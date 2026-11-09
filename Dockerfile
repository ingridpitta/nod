# definido em 2026-09-17: a imagem compartilhada inclui a web compilada, sem Electron nem CLI no runtime.
FROM node:24.19.0-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:24.19.0-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
# definido em 2026-10-08: o --ignore-scripts pula o postinstall; o remendo do postgres.js (queda de conexão com transação
# em voo derrubava o processo) roda aqui à mão.
COPY scripts/remendar-postgres.mjs ./scripts/
RUN node scripts/remendar-postgres.mjs
COPY src ./src
# definido em 2026-10-02: o deploy migra com a própria imagem (docker compose run nod node scripts/migrate.ts).
# NOD-218: e fecha as ligações da cor que saiu (scripts/ligacoes-orfas.ts). PR 6 dos modos de aprovação: e escreve a
# linha do total nos bots que já estavam nele (scripts/aviso-total-credenciais.ts).
COPY scripts/migrate.ts scripts/seed.ts scripts/ligacoes-orfas.ts scripts/aviso-total-credenciais.ts ./scripts/
COPY tests/helpers/catcher-roteiro.ts ./tests/helpers/catcher-roteiro.ts
# definido em 2026-10-03: src/adapters/workspace/pastas.ts importa este módulo; sem ele o servidor não sobe.
COPY infra/computador/texto.mjs ./infra/computador/texto.mjs
COPY --from=web /app/dist/web ./dist/web
# definido em 2026-10-09 (ADR-090): o motor sem janela desta versão, servido em /api/motor/arquivos para a VM da pessoa.
COPY --from=web /app/dist/motor ./dist/motor
# Carrega o grafo inteiro do servidor (server.ts só escuta quando é o ponto de entrada): um import
# para fora do que foi copiado falha aqui, no build, e não no primeiro boot em produção.
RUN node -e "import('./src/adapters/http/server.ts').catch((e) => { console.error(e); process.exit(1); })"
ENV NODE_ENV=production
ENV NOD_MODO=compartilhado
ENV NOD_STATIC_DIR=/app/dist/web
EXPOSE 8888
CMD ["node", "src/adapters/http/server.ts"]
