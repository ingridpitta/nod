import net from "node:net";
import { afterEach, beforeAll, expect, it } from "vitest";
import { criarDb } from "../../src/db/client.ts";
import type { Db } from "../../src/shared/types.ts";
import { remendado } from "../../scripts/remendar-postgres.mjs";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * Queda do Docker em 2026-10-08: a conexão com o Postgres caiu com um `begin` em voo, o postgres.js mandou o ROLLBACK na
 * conexão já sem socket e o `socket.write` num setImmediate derrubou a API inteira (TypeError fora de promessa). Com o
 * remendo (scripts/remendar-postgres.mjs), a transação falha com CONNECTION_CLOSED, o processo segue e a próxima consulta
 * abre conexão nova. Um proxy TCP entre o pool e o banco faz a queda — fechamento limpo (FIN) e com erro (RST). Sem o
 * remendo, o vitest acusa o erro não tratado e a rodada falha.
 */
let proxy: net.Server | undefined;
let db: Db | undefined;

afterEach(async () => {
  await db?.end({ timeout: 1 });
  db = undefined;
  await new Promise<void>((r) => (proxy ? proxy.close(() => r()) : r()));
  proxy = undefined;
});

async function poolPeloProxy(): Promise<{ db: Db; derrubar: (modo: "fin" | "rst") => void }> {
  const alvo = new URL(process.env.DATABASE_URL_TEST ?? "");
  const portaBanco = Number(alvo.port || 5432);
  const lados = new Set<net.Socket>();
  proxy = net.createServer((cliente) => {
    const banco = net.connect(portaBanco, alvo.hostname);
    lados.add(cliente);
    cliente.pipe(banco);
    banco.pipe(cliente);
    cliente.on("error", () => banco.destroy());
    banco.on("error", () => cliente.destroy());
    cliente.on("close", () => { banco.destroy(); lados.delete(cliente); });
  });
  const servidor = proxy;
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", () => r()));
  const endereco = servidor.address();
  if (!endereco || typeof endereco === "string") throw new Error("proxy sem porta");
  alvo.hostname = "127.0.0.1";
  alvo.port = String(endereco.port);
  db = criarDb(alvo.toString());
  return {
    db,
    derrubar: (modo) => {
      for (const cliente of lados) {
        if (modo === "fin") cliente.end();
        else cliente.destroy();
      }
    },
  };
}

describeIntegracao("queda da conexão com transação em voo", () => {
  beforeAll(() => {
    expect(remendado(), "rode npm install (o postinstall aplica scripts/remendar-postgres.mjs)").toBe(true);
  });

  it.each(["fin", "rst"] as const)("%s: o begin falha com CONNECTION_CLOSED, o processo segue e o pool volta", async (modo) => {
    const { db, derrubar } = await poolPeloProxy();
    await db`select 1`;

    const tx = db.begin((t) => t`select pg_sleep(5)`).then(
      () => "resolveu",
      (e: { code?: string }) => e.code,
    );
    await new Promise((r) => setTimeout(r, 300));
    derrubar(modo);

    expect(await tx).toBe("CONNECTION_CLOSED");
    // O setImmediate do nextWrite (onde o processo morria) já passou.
    await new Promise((r) => setTimeout(r, 100));
    const [linha] = await db`select 2 as x`;
    expect(linha?.x).toBe(2);
  });
});
