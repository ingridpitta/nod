import type { JsonSchema } from "./json-schema.ts";

/**
 * definido em 2026-09-24 (ADR-048): o GitHub é UM conector, slug `github`, com nomes de capacidade
 * estáveis. Concessão e "Sempre permitir" se amarram a `github__<capacidade>`, nunca ao jeito de
 * conectar: trocar gh por token ou Composio não perde regra nenhuma.
 */
export const SLUG_GITHUB = "github" as const;

/**
 * O `comando` do conector nativo no banco. Não é executável: o servidor troca esta marca pelo Node
 * deste processo + src/adapters/conectores-locais/github/servidor.ts na hora de spawnar, e só conector
 * com esta marca recebe a lista mínima de ambiente de conector nativo (ambiente-executor.ts).
 */
export const COMANDO_GITHUB_NATIVO = "nod:github" as const;

/** As chaves do env CIFRADO do conector `github` que cada jeito lê (token pessoal; login do Composio). */
export const ENV_TOKEN_GITHUB = "GITHUB_TOKEN" as const;
export const ENV_COMPOSIO_URL = "COMPOSIO_URL" as const;
export const ENV_COMPOSIO_CHAVE = "COMPOSIO_API_KEY" as const;

/**
 * Os jeitos de conectar, na ordem de preferência por turno (ADR-048, domain/github.ts): `gh` = o CLI
 * já logado no Mac da dona do conector, executado NA MÁQUINA do turno pelo proxy; `token` = token
 * pessoal do campo avançado; `composio` = login OAuth pelo Composio; `app` = GitHub App da
 * organização, só em turno de rotina. Os três últimos rodam no servidor.
 */
export type JeitoGithub = "gh" | "token" | "composio" | "app";

export type NomeCapacidadeGithub = "pr_ver" | "pr_diff" | "pr_arquivos" | "pr_comentarios" | "pr_checks" | "arquivo_ler" | "issue_ver" | "pr_comentar" | "pr_revisar";

export type EventoRevisao = "comment" | "approve" | "request_changes";

const REPOSITORIO: JsonSchema = { type: "string", description: "Repositório no formato dono/nome, ex.: acme/nod.", minLength: 3 };
const NUMERO: JsonSchema = { type: "integer", description: "Número do pull request (ou da issue)." };

/** O que a sonda lê do servidor stdio nativo: nome, descrição, schema e readOnlyHint (ADR-013). */
export const CAPACIDADES_GITHUB: readonly { nome: NomeCapacidadeGithub; descricao: string; readOnlyHint: boolean; schema: JsonSchema }[] = [
  { nome: "pr_ver", readOnlyHint: true, descricao: "Lê título, descrição, autor, estado e branches de um pull request.",
    schema: { type: "object", properties: { repositorio: REPOSITORIO, numero: NUMERO }, required: ["repositorio", "numero"], additionalProperties: false } },
  { nome: "pr_diff", readOnlyHint: true, descricao: "Lê o diff unificado de um pull request (cortado ao orçamento do turno).",
    schema: { type: "object", properties: { repositorio: REPOSITORIO, numero: NUMERO }, required: ["repositorio", "numero"], additionalProperties: false } },
  { nome: "pr_arquivos", readOnlyHint: true, descricao: "Lista os arquivos alterados de um pull request, com adições e remoções.",
    schema: { type: "object", properties: { repositorio: REPOSITORIO, numero: NUMERO }, required: ["repositorio", "numero"], additionalProperties: false } },
  { nome: "pr_comentarios", readOnlyHint: true, descricao: "Lê os comentários da conversa e das linhas de um pull request.",
    schema: { type: "object", properties: { repositorio: REPOSITORIO, numero: NUMERO }, required: ["repositorio", "numero"], additionalProperties: false } },
  { nome: "pr_checks", readOnlyHint: true, descricao: "Lê o estado dos checks (CI) do último commit de um pull request.",
    schema: { type: "object", properties: { repositorio: REPOSITORIO, numero: NUMERO }, required: ["repositorio", "numero"], additionalProperties: false } },
  { nome: "arquivo_ler", readOnlyHint: true, descricao: "Lê o conteúdo de um arquivo do repositório numa branch, tag ou commit.",
    schema: { type: "object", properties: { repositorio: REPOSITORIO, caminho: { type: "string", description: "Caminho do arquivo, ex.: src/index.ts.", minLength: 1 }, ref: { type: "string", description: "Branch, tag ou SHA; ausente = branch padrão." } }, required: ["repositorio", "caminho"], additionalProperties: false } },
  { nome: "issue_ver", readOnlyHint: true, descricao: "Lê título, descrição, autor e estado de uma issue.",
    schema: { type: "object", properties: { repositorio: REPOSITORIO, numero: { type: "integer", description: "Número da issue." } }, required: ["repositorio", "numero"], additionalProperties: false } },
  { nome: "pr_comentar", readOnlyHint: false, descricao: "Publica um comentário na conversa de um pull request, em nome de quem conectou o GitHub.",
    schema: { type: "object", properties: { repositorio: REPOSITORIO, numero: NUMERO, texto: { type: "string", description: "O comentário, em Markdown.", minLength: 1 } }, required: ["repositorio", "numero", "texto"], additionalProperties: false } },
  { nome: "pr_revisar", readOnlyHint: false, descricao: "Envia uma revisão de pull request: comentário, aprovação ou pedido de mudanças.",
    schema: { type: "object", properties: { repositorio: REPOSITORIO, numero: NUMERO, evento: { type: "string", enum: ["comment", "approve", "request_changes"], description: "comment, approve ou request_changes." }, texto: { type: "string", description: "Corpo da revisão (obrigatório em comment e request_changes)." } }, required: ["repositorio", "numero", "evento"], additionalProperties: false } },
];

/**
 * definido em 2026-09-24 (ADR-048): as capacidades estáveis do conector `github` → ferramentas
 * GITHUB_* do Composio. Slugs e parâmetros conferidos em https://docs.composio.dev/toolkits/github.md
 * no mesmo dia (GITHUB_GET_A_PULL_REQUEST, GITHUB_LIST_PULL_REQUESTS_FILES, GITHUB_LIST_ISSUE_COMMENTS,
 * GITHUB_LIST_REVIEW_COMMENTS_ON_A_PULL_REQUEST, GITHUB_GET_REPOSITORY_CONTENT, GITHUB_GET_AN_ISSUE,
 * GITHUB_CREATE_AN_ISSUE_COMMENT, GITHUB_CREATE_A_REVIEW_FOR_A_PULL_REQUEST). `null` = sem par:
 * o diff unificado não existe lá, e os checks pediriam o SHA do head lido de um `data` em texto
 * livre — aparecem como indisponíveis neste jeito, em vez de adivinhados.
 */
export const COMPOSIO_POR_CAPACIDADE_GITHUB: Readonly<Record<NomeCapacidadeGithub, readonly string[] | null>> = {
  pr_ver: ["GITHUB_GET_A_PULL_REQUEST"],
  pr_diff: null,
  pr_arquivos: ["GITHUB_LIST_PULL_REQUESTS_FILES"],
  pr_comentarios: ["GITHUB_LIST_ISSUE_COMMENTS", "GITHUB_LIST_REVIEW_COMMENTS_ON_A_PULL_REQUEST"],
  pr_checks: null,
  arquivo_ler: ["GITHUB_GET_REPOSITORY_CONTENT"],
  issue_ver: ["GITHUB_GET_AN_ISSUE"],
  pr_comentar: ["GITHUB_CREATE_AN_ISSUE_COMMENT"],
  pr_revisar: ["GITHUB_CREATE_A_REVIEW_FOR_A_PULL_REQUEST"],
};
