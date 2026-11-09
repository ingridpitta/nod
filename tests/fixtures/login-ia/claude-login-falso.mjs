#!/usr/bin/env node
// Um `claude` falso para o login pela tela (ADR-102): `auth login` imprime o link oficial e espera o código no stdin;
// com o código certo (CODIGO_CERTO), grava a conta na pasta da conta (CLAUDE_CONFIG_DIR) e sai com 0. `auth status`
// devolve o JSON do Claude Code 2.1.296 com a conta da pasta; `auth logout` apaga a conta. O e-mail vem de EMAIL_FALSO.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const pasta = process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME || "/tmp", ".claude");
const arquivo = join(pasta, "conta-falsa.json");
const [a, b] = process.argv.slice(2);
if (a === "--version") { process.stdout.write("2.1.296 (Claude Code)\n"); process.exit(0); }
if (a === "auth" && b === "status") {
  if (!existsSync(arquivo)) { process.stdout.write(`${JSON.stringify({ loggedIn: false })}\n`); process.exit(1); }
  const c = JSON.parse(readFileSync(arquivo, "utf8"));
  process.stdout.write(`${JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: c.email, orgId: c.orgId, orgName: "Empresa", subscriptionType: "max" })}\n`);
  process.exit(0);
}
if (a === "auth" && b === "logout" && process.env.LOGOUT_FALHA === "1") { process.stderr.write("logout falhou\n"); process.exit(1); }
if (a === "auth" && b === "logout") { rmSync(arquivo, { force: true }); process.stdout.write("Logged out\n"); process.exit(0); }
if (a === "auth" && b === "login") {
  process.stdout.write("Browser didn't open? Use the url below to sign in (c to copy)\n");
  process.stdout.write("https://claude.com/cai/oauth/authorize?code=true&client_id=falso&state=xyz\n");
  process.stdout.write("Paste code here if prompted >\n");
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (linha) => {
    if (linha.trim() !== (process.env.CODIGO_CERTO || "codigo-certo-123")) { process.stderr.write("OAuth error: Invalid code\n"); process.exit(1); }
    mkdirSync(pasta, { recursive: true });
    writeFileSync(arquivo, JSON.stringify({ email: process.env.EMAIL_FALSO || "pessoa@exemplo.com", orgId: process.env.ORG_FALSA || "org-1" }));
    process.stdout.write("Login successful.\n");
    process.exit(0);
  });
} else {
  process.exit(2);
}
