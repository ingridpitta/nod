import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";
import { apontarParaBancoDaWorktree } from "./tests/setup/banco-por-worktree.ts";

// Lê .env quando existe (Node 24 nativo, sem dependência). Sob CI as variáveis vêm do workflow.
try {
  process.loadEnvFile(".env");
} catch {
  // sem .env: ambiente já configurado (CI) ou testes de integração vão pular fora do CI
}

// definido em 2026-10-05: fora do CI cada worktree usa o próprio banco de teste (nod_test_<hash>), para
// bots rodando a suíte ao mesmo tempo não se contaminarem; o globalSetup cria e migra sob demanda.
apontarParaBancoDaWorktree();

// Quatro modos de teste (ADR-011 refinado): unit sem banco, integration sob withRollback,
// conformidade lendo pg_catalog, concurrency com DUAS conexões e limpeza própria.
// fileParallelism fica ligado nos três primeiros porque o withRollback isola cada arquivo;
// concurrency roda serial porque disputa linhas de verdade.
// medido em 2026-09-16: `fileParallelism: false` DENTRO de um projeto não é honrado pelo vitest 3.2.7
// (dois arquivos de concurrency rodaram juntos e um reivindicou os turnos do outro); o que serializa
// os arquivos do projeto é pool 'forks' com singleFork. O fileParallelism fica como documentação.
//
// definido em 2026-11-04: na CI, um teste que falha roda UMA segunda vez antes de reprovar o job. A CI saiu das VMs
// lentas para máquinas rápidas (Blacksmith) e, no mesmo dia, quatro testes de tempo que nunca piscavam passaram a
// cair (paridade-apps: dois apps no mesmo ms; computador-login-senhas: mtime; sessao-por-harness; o e2e do
// computador) — cada queda era um rerun manual e uma main vermelha que pulava o deploy. O retry não é desculpa:
// o relatório do vitest marca o que passou na segunda ("retry"), e o que cair duas vezes na semana vira issue
// (AGENTS.md, "Teste instável na CI"). Fora da CI continua 0, para quem desenvolve ver a instabilidade de perto.
const RETRY_NA_CI = process.env.CI ? 1 : 0;
const raiz = { exclude: ["node_modules", "dist", "prototypes", ".claude"], retry: RETRY_NA_CI };

/**
 * testTimeout dos projetos que tocam o banco (EMENDA-L9 §11, opção b): `npx vitest run` roda os quatro
 * projetos ao MESMO tempo e integration/conformidade/concurrency disputam o mesmo Postgres; sob disputa um
 * teste de ~600 ms encostava nos 5 s do default e a suíte piscava. medido em 2026-09-16 (árvore merjada,
 * antes da L9): 2 de 3 rodadas de `npx vitest run` falhavam só por "Test timed out in 5000ms", com
 * arquivos diferentes a cada rodada; rodando um projeto por vez, os quatro passavam. 20 s dá ~30x o
 * teste típico; `npm run check` continua serializando os projetos (opção a), então o número só vale
 * para quem roda tudo junto.
 */
const BANCO = {
  testTimeout: 20_000,
  hookTimeout: 30_000,
  globalSetup: ["tests/setup/banco-por-worktree.ts"],
};

/**
 * NOD-198: teto de workers. `maxWorkers` só existe na raiz no vitest 3.2.7 (o `poolOptions.forks.maxForks`
 * por projeto foi ignorado: 13 filhos), então vale para os quatro projetos; quem pesa é o unit.
 * medido em 2026-10-08 (Mac de 12 núcleos, load de outros bots 160–730): com o default (11 workers) dois
 * `npm run test:unit` ao mesmo tempo terminavam com "Timeout calling onTaskUpdate" (Unhandled=2, exit 1)
 * mesmo com 0 teste falho; com 8, as mesmas rodadas saem com exit 0 e 0 Unhandled. Sem carga extra, um
 * test:unit sozinho: 11 workers mediana 112 s, 8 workers 132 s (+18%, dentro do teto de 20%); 6 dava +25%
 * e 4 dava +71%. Gatilho de reversão: o erro voltar com 8, ou o tempo sem carga passar de +20%.
 * É um TETO, nunca mais que o padrão do vitest (núcleos − 1): no runner do CI (poucos núcleos) um 8 fixo subiu o
 * paralelismo e os testes de tempo do unit estouraram (run 37864813061).
 */
const MAX_WORKERS = Math.min(8, Math.max(1, availableParallelism() - 1));

export default defineConfig({
  test: {
    maxWorkers: MAX_WORKERS,
    projects: [
      { test: { ...raiz, name: "unit", include: ["tests/unit/**/*.test.ts"] } },
      // ADA-11 (ADR-147): o smoke do Windows de verdade; só roda no job `windows` da CI (fora do win32 os testes pulam).
      { test: { ...raiz, name: "windows", include: ["tests/windows/**/*.test.ts"] } },
      { test: { ...raiz, ...BANCO, name: "integration", include: ["tests/integration/**/*.test.ts"] } },
      { test: { ...raiz, ...BANCO, name: "conformidade", include: ["tests/conformidade/**/*.test.ts"] } },
      {
        test: {
          ...raiz,
          ...BANCO,
          name: "concurrency",
          include: ["tests/concurrency/**/*.test.ts"],
          fileParallelism: false,
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
});
