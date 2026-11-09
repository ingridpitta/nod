// NOD-203: o preflight do job `mac` do desktop-release. Roda ANTES do `npm ci`, então só usa módulos do Node.
// A lógica é a função pura `validarPreflight`, que devolve TODOS os erros de uma vez: quem cadastra os secrets
// vê tudo o que falta numa execução só. As mensagens usam o nome que se cadastra no GitHub, não o da variável
// de ambiente do electron-builder (CSC_LINK não é o nome de nenhum secret).
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FORMATO_SERVIDOR_PADRAO } from "./servidor-padrao.mjs";

/** Variável de ambiente do job → secret no GitHub (`.github/workflows/desktop-release.yml`, env do job `mac`). */
export const SECRETS_DE_RELEASE = [
  ["CSC_LINK", "APPLE_CERTIFICATE_P12"],
  ["CSC_KEY_PASSWORD", "APPLE_CERTIFICATE_PASSWORD"],
  ["APPLE_ID", "APPLE_ID"],
  ["APPLE_APP_SPECIFIC_PASSWORD", "APPLE_APP_SPECIFIC_PASSWORD"],
  ["APPLE_TEAM_ID", "APPLE_TEAM_ID"],
];

const ONDE_SECRETS = "Settings › Secrets and variables › Actions";

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
    erros.push(`Configure a variável de repositório NOD_SERVIDOR_PADRAO (https://host, sem caminho) em ${ONDE_SECRETS} › Variables`);
  } else if (!FORMATO_SERVIDOR_PADRAO.test(servidor)) {
    erros.push(`A variável NOD_SERVIDOR_PADRAO precisa ser https://host, sem caminho nem barra final: veio ${servidor}`);
  }
  return erros;
}

async function main() {
  const pacote = JSON.parse(await readFile("package.json", "utf8"));
  const erros = validarPreflight({ env: process.env, versao: pacote.version, ref: process.env.GITHUB_REF ?? "" });
  if (erros.length === 0) {
    process.stdout.write("Preflight da release: secrets, variável NOD_SERVIDOR_PADRAO e tag conferidos.\n");
    return;
  }
  // `::error::` vira anotação no resumo do run do GitHub; fora do Actions sai o texto puro.
  const prefixo = process.env.GITHUB_ACTIONS === "true" ? "::error::" : "";
  process.stderr.write(`Preflight da release reprovado (${erros.length}):\n${erros.map((e) => `${prefixo}${e}`).join("\n")}\n`);
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
