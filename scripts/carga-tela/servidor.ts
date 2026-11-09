// A API do teste de carga da tela: o servidor inteiro (boot.ts) no banco efêmero, com o catcher emitindo um evento a
// cada CARGA_ATRASO_MS para simular o streaming de vários bots sem gastar assinatura. Serve a web já compilada de
// CARGA_WEB_DIR. NÃO lê o .env: ele aponta para o banco diário (porta 5434), que este teste nunca toca.
// CARGA_REPO aponta para OUTRA cópia do código (ex.: um `git archive` da main) quando se mede o "antes".
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG, escrever } from "./comum.ts";

const repo = process.env.CARGA_REPO ?? resolve(fileURLToPath(new URL("../..", import.meta.url)));
const { boot } = (await import(join(repo, "src/adapters/http/boot.ts"))) as typeof import("../../src/adapters/http/boot.ts");
const { criarCatcherDriver } = (await import(join(repo, "src/adapters/executor/drivers/catcher.ts"))) as typeof import("../../src/adapters/executor/drivers/catcher.ts");

const casa = join(CONFIG.saida, "nod-home");
mkdirSync(casa, { recursive: true });
const env = {
  DATABASE_URL: `postgres://nod_app:nod@127.0.0.1:${CONFIG.bancoPorta}/nod`,
  DATABASE_URL_DONO: `postgres://nod_dono:nod@127.0.0.1:${CONFIG.bancoPorta}/nod`,
  NOD_LOGIN: "stub",
  NOD_EXECUTOR: "catcher",
  NOD_HOST: "127.0.0.1",
  NOD_SESSAO_SEGREDO: randomBytes(32).toString("hex"),
  NOD_CREDENTIAL_KEY: randomBytes(32).toString("hex"),
  NOD_HOME: casa,
  NOD_BANCO_AMBIENTE: "efemero",
  NOD_FUSO_PADRAO: "America/Sao_Paulo",
  NOD_PRAZO_DECISAO_MS: "86400000",
  PATH: process.env.PATH,
  HOME: process.env.HOME,
};

const servidor = await boot({
  env,
  porta: CONFIG.apiPorta,
  staticDir: process.env.CARGA_WEB_DIR,
  drivers: ({ urlNod }) => [criarCatcherDriver({ urlNod, atrasoMs: CONFIG.atrasoMs })],
});
escrever(`carga-tela: API em ${servidor.url} (catcher a cada ${CONFIG.atrasoMs} ms, web ${process.env.CARGA_WEB_DIR ?? "sem web"})`);
const encerrar = (): void => {
  servidor.fechar().then(() => process.exit(0), () => process.exit(1));
};
process.once("SIGINT", encerrar);
process.once("SIGTERM", encerrar);
