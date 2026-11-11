// NOD-203: o preflight do job `mac` do desktop-release. Roda ANTES do `npm ci`, então só usa módulos do Node.
// A lógica é a função pura `validarPreflight`, que devolve TODOS os erros de uma vez: quem cadastra os secrets
// vê tudo o que falta numa execução só. As mensagens usam o nome que se cadastra no GitHub, não o da variável
// de ambiente do electron-builder (CSC_LINK não é o nome de nenhum secret).
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FORMATO_SERVIDOR_PADRAO } from "./servidor-padrao.mjs";

/** Variável de ambiente do job → secret no GitHub (`.github/workflows/desktop-release.yml`, env dos passos do job `mac` que assinam). */
export const SECRETS_DE_RELEASE = [
  ["CSC_LINK", "APPLE_CERTIFICATE_P12"],
  ["CSC_KEY_PASSWORD", "APPLE_CERTIFICATE_PASSWORD"],
  ["APPLE_ID", "APPLE_ID"],
  ["APPLE_APP_SPECIFIC_PASSWORD", "APPLE_APP_SPECIFIC_PASSWORD"],
  ["APPLE_TEAM_ID", "APPLE_TEAM_ID"],
];

const ONDE_SECRETS = "Settings › Environments › release (secrets do environment)";
const ONDE_VARIAVEIS = "Settings › Secrets and variables › Actions › Variables";

/** O GitHub passa string vazia quando o secret ou a variável não existe: vazio (ou só espaços) conta como ausente. */
const ausente = (valor) => typeof valor !== "string" || valor.trim() === "";

/**
 * @param {{ env: Record<string, string | undefined>, versao: string, ref?: string }} entrada
 * @returns {string[]} os erros, em pt-BR; lista vazia = pode seguir.
 */
export function validarPreflight({ env, versao, ref = "" }) {
  const erros = [];
  if (ref.startsWith("refs/tags/") && ref !== `refs/tags/v${versao}`) {
    erros.push(`A tag deve corresponder à versão do package.json: esperava refs/tags/v${versao}, veio ${ref}`);
  }
  for (const [variavel, secret] of SECRETS_DE_RELEASE) {
    if (!ausente(env[variavel])) continue;
    const chega = variavel === secret ? "" : ` (chega ao job como ${variavel})`;
    erros.push(`Configure o secret ${secret} em ${ONDE_SECRETS}${chega}`);
  }
  const servidor = env.NOD_SERVIDOR_PADRAO;
  if (ausente(servidor)) {
    erros.push(`Configure a variável de repositório NOD_SERVIDOR_PADRAO (https://host, sem caminho) em ${ONDE_VARIAVEIS}`);
  } else if (!FORMATO_SERVIDOR_PADRAO.test(servidor)) {
    erros.push(`A variável NOD_SERVIDOR_PADRAO precisa ser https://host, sem caminho nem barra final: veio ${servidor}`);
  }
  return erros;
}

/**
 * O que o CLI faz com os erros. Publicando, qualquer erro reprova (sai 1). No modo seco (NOD_RELEASE_SECO=1, o
 * workflow_dispatch com publicar=false) cada erro vira aviso e o job segue sem assinatura: o run mostra o que ainda
 * falta cadastrar sem travar o build.
 * @param {{ erros: string[], seco: boolean, actions: boolean }} entrada
 * @returns {{ codigo: 0 | 1, saida: string, erro: string }}
 */
export function relatorioPreflight({ erros, seco, actions }) {
  if (erros.length === 0) return { codigo: 0, saida: "Preflight da release: secrets, variável NOD_SERVIDOR_PADRAO e tag conferidos.\n", erro: "" };
  // `::error::`/`::warning::` viram anotação no resumo do run do GitHub; fora do Actions sai o texto puro.
  const prefixo = actions ? (seco ? "::warning::" : "::error::") : "";
  const linhas = erros.map((e) => `${prefixo}${e}`).join("\n");
  if (seco) return { codigo: 0, saida: `Preflight da release em modo seco (${erros.length} pendência(s); o app sai sem assinatura):\n${linhas}\n`, erro: "" };
  return { codigo: 1, saida: "", erro: `Preflight da release reprovado (${erros.length}):\n${linhas}\n` };
}

async function main() {
  const pacote = JSON.parse(await readFile("package.json", "utf8"));
  const erros = validarPreflight({ env: process.env, versao: pacote.version, ref: process.env.GITHUB_REF ?? "" });
  const r = relatorioPreflight({ erros, seco: process.env.NOD_RELEASE_SECO === "1", actions: process.env.GITHUB_ACTIONS === "true" });
  if (r.saida) process.stdout.write(r.saida);
  if (r.erro) process.stderr.write(r.erro);
  process.exitCode = r.codigo;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
