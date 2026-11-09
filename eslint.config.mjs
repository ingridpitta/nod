// Fronteiras de camada por glob de DIRETÓRIO (herdado, docs/praticas-herdadas.md §3).
// O tsconfig.domain.json guarda a PUREZA (sem Node, sem DOM); este arquivo guarda a DIREÇÃO
// entre camadas. Cada mensagem ensina o caminho certo, não só proíbe.
// Mover um diretório sem atualizar este arquivo desliga a fronteira em silêncio (risco aceito, ADR-018).
import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** Bloco de fronteira: `files` proíbe `padroes` com uma mensagem que ensina. */
const fronteira = (files, padroes, mensagem, opcoes = {}) => ({
  files,
  rules: {
    "@typescript-eslint/no-restricted-imports": [
      "error",
      {
        patterns: [{ group: padroes, message: mensagem, ...opcoes }],
      },
    ],
  },
});

export default tseslint.config(
  {
    ignores: ["dist/**", "release/**", "node_modules/**", "prototypes/**", "docs/**", "web/public/**", ".claude/**", "**/.wrangler/**"],
  },
  { files: ["desktop/setup.js", "desktop/windows/setup-windows.js"], languageOptions: { globals: { window: "readonly", document: "readonly" } } },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly" } },
  },
  {
    files: ["**/*.ts", "**/*.mjs"],
    rules: {
      // Sem `allow`: o único lugar com console é src/obs/log.ts (um eslint-disable, datado).
      "no-console": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },

  fronteira(
    ["src/domain/**/*.ts"],
    ["node:*", "postgres", "**/db/**", "**/repositories/**", "**/services/**", "**/use-cases/**", "**/adapters/**", "**/obs/**", "**/shared/types*"],
    "domínio é puro: receba dados e `agora: number` por parâmetro; só src/contracts e outros arquivos de src/domain entram aqui (ADR-018).",
  ),
  fronteira(
    ["src/contracts/**/*.ts"],
    ["node:*", "postgres", "**/db/**", "**/domain/**", "**/repositories/**", "**/services/**", "**/use-cases/**", "**/adapters/**", "**/obs/**"],
    "contratos são só tipos e `as const`: nada de fora de src/contracts entra aqui (EMENDA 26).",
  ),
  fronteira(
    ["src/use-cases/**/*.ts"],
    ["**/db/client*", "postgres", "**/adapters/**", "**/repositories/**"],
    "caso de uso recebe repos, services e tx pelo parâmetro deps; nunca abre conexão nem fala com HTTP/executor (ADR-018).",
    { allowTypeImports: true },
  ),
  fronteira(
    ["src/repositories/**/*.ts"],
    ["**/use-cases/**", "**/adapters/**", "**/services/**"],
    "repositório só conhece Conn e escopo: quem orquestra é o caso de uso (Práticas §1).",
  ),
  fronteira(
    ["src/services/**/*.ts"],
    ["**/db/**", "postgres", "**/repositories/**", "**/adapters/http/**"],
    "src/services é SEM BANCO (EMENDA 3): laço de fundo que abre transação mora em src/adapters/fundo; persistência entra por callback injetado.",
  ),
  fronteira(
    ["src/adapters/fundo/**/*.ts"],
    ["**/adapters/http/**"],
    "laço de fundo não conhece HTTP: publica eventos e abre transações por pessoa (EMENDA 3).",
  ),
  fronteira(
    ["src/adapters/executor/**/*.ts", "src/adapters/mcp-proxy/**/*.ts"],
    ["**/db/**", "**/repositories/**", "**/use-cases/**", "postgres"],
    "executor e proxy recebem plano e sinks; quem grava é o servidor (ADR-018, ADR-024).",
    { allowTypeImports: true },
  ),
  // definido em 2026-09-24 (ADR-048): conector nativo roda em processo filho com o stdout como canal
  // JSON-RPC — sem banco, sem caso de uso e sem src/obs/log.ts (que escreve no stdout).
  fronteira(
    ["src/adapters/conectores-locais/**/*.ts"],
    ["**/db/**", "**/repositories/**", "**/use-cases/**", "**/services/**", "**/obs/**", "**/adapters/http/**", "postgres"],
    "conector nativo é processo filho: recebe tudo pelo ambiente que o servidor montou e só fala JSON-RPC no stdout (ADR-048).",
    { allowTypeImports: true },
  ),
  fronteira(
    ["web/**/*.ts"],
    ["**/src/**", "node:*", "postgres"],
    "a web só faz `import type` de src/contracts e src/shared/types.ts; dado chega pela API (ADR-018, ADR-020).",
    { allowTypeImports: true },
  ),
  // definido em 2026-09-24 (ADR-044): conceder é ato da PESSOA. Chamam conceder/concederLote só o botão
  // da decisão de acesso (decidir-acesso.ts) e a concessão manual por capacidade da tela Conectores
  // (rota de pessoa); conceder-acessos-da-rotina.ts concede o que a rotina declarou quando a pessoa a
  // confirma (emenda de 2026-09-24, "rotina nasce com o acesso"); duplicar-agente.ts leva à cópia as
  // concessões do bot da PRÓPRIA dona quando ela clica em Duplicar — só a rota de pessoa o chama, nenhuma
  // ferramenta (emenda de 2026-09-28 da ADR-034). acoes/acessos.ts (emenda de 2026-11-07, ADA-241, ADR-158) é o
  // executor único do nível em lote e do padrão do app: roda pelo clique da pessoa (tela ou card do lote) ou pelo
  // modo do bot com porRegra registrado (como o dar_acesso, ADR-082); Ler e alterar sempre espera a pessoa, e o
  // padrão que o bot novo herda foi a própria dona quem definiu.
  // Regra do núcleo (no-restricted-imports), não a do typescript-eslint: a mesma regra num segundo
  // bloco SUBSTITUIRIA as fronteiras de camada acima para estes arquivos.
  {
    files: ["src/**/*.ts"],
    ignores: ["src/use-cases/conceder.ts", "src/use-cases/decidir-acesso.ts", "src/adapters/http/rotas/concessoes.ts", "src/**/conceder-acessos-da-rotina.ts", "src/use-cases/duplicar-agente.ts", "src/use-cases/acoes/acessos.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/conceder.ts"],
              importNames: ["conceder", "concederLote"],
              message: "concessão nasce do clique da pessoa: decida pela decisão de acesso (decidir-acesso.ts), nunca por ferramenta, laço ou outro caso de uso (ADR-044).",
            },
          ],
        },
      ],
    },
  },

  {
    files: ["tests/**/*.ts"],
    ignores: ["tests/concurrency/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "TemplateElement[value.raw=/\\b(DELETE\\s+FROM|TRUNCATE)\\b/i]",
          message: "teste de integração usa withRollback, nunca limpa tabela; só tests/concurrency tem limpeza própria (Práticas §O que não trazer).",
        },
        {
          selector: "Literal[value=/\\b(DELETE\\s+FROM|TRUNCATE)\\b/i]",
          message: "teste de integração usa withRollback, nunca limpa tabela; só tests/concurrency tem limpeza própria (Práticas §O que não trazer).",
        },
      ],
    },
  },
);
