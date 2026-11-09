import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { comporApp, type App } from "../../src/adapters/http/compor.ts";
import { listen } from "../../src/adapters/http/server.ts";
import { cunharCookie } from "../../src/adapters/http/sessao.ts";
import type { MaquinasDto } from "../../src/contracts/maquina.ts";
import { abrirTxEscopada } from "../../src/db/tx.ts";
import { db } from "../helpers/db.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * ADR-090 de ponta a ponta, com o PROCESSO do motor: o servidor composto em modo compartilhado (a ponte HTTP de
 * verdade), o `nod-motor parear` pedindo o código, a pessoa aprovando pela API, e o `nod-motor rodar` conectando e
 * aparecendo em Máquinas como Linux. Sem IA de verdade (NOD_CLAUDE_BIN=/bin/false): nenhum turno roda, custo zero.
 * Mora em tests/concurrency porque COMMITA a chave; ao fim, apaga a própria linha.
 */
describeIntegracao("motor sem janela: parear e conectar (processo real, commita)", () => {
  let app: App;
  let srv: { port: number; close: () => Promise<void> };
  let url: string;
  let pasta: string;
  const SEGREDO = "segredo-de-teste";
  const dona = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
  const cookie = `nod_sessao=${cunharCookie(dona, SEGREDO)}`;
  const api = (metodo: string, caminho: string, corpo?: unknown) =>
    fetch(`${url}/api/t/${dona.tenantId}/${caminho}`, { method: metodo, headers: { cookie, "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const filhos: ChildProcess[] = [];
  const env = () => ({ ...process.env, NOD_MOTOR_HOME: pasta, NOD_CLAUDE_BIN: "/bin/false", NOD_CODEX_BIN: "/bin/false", NOD_LOG_NIVEL: "aviso" });
  const motor = (...args: string[]) => {
    const f = spawn(process.execPath, [join(process.cwd(), "motor", "main.ts"), ...args], { env: env(), stdio: ["ignore", "pipe", "pipe"] });
    filhos.push(f);
    return f;
  };

  beforeAll(async () => {
    pasta = await mkdtemp(join(tmpdir(), "nod-motor-e2e-"));
    app = comporApp({ db, env: { NOD_MODO: "compartilhado", NOD_EXECUTOR: "catcher", NOD_CREDENTIAL_KEY: "0".repeat(63) + "6" }, listarPessoas: async () => [] });
    srv = await listen(0, "127.0.0.1", { rotas: app.rotas, segredoSessao: SEGREDO, autorizarMaquina: app.autorizarMaquina });
    url = `http://127.0.0.1:${srv.port}`;
  });

  afterAll(async () => {
    for (const f of filhos) if (f.exitCode === null) f.kill("SIGKILL");
    const { maquinas } = (await (await api("GET", "maquinas")).json().catch(() => ({ maquinas: [] }))) as MaquinasDto;
    for (const m of maquinas) await abrirTxEscopada(db, dona)((trx) => trx`delete from maquina_tokens where id = ${m.id}`);
    await srv?.close();
    await app?.fechar();
    await rm(pasta, { recursive: true, force: true });
  });

  it("parear mostra o código, a pessoa aprova, e o motor conectado aparece em Máquinas como Linux", async () => {
    const parear = motor("parear", url, "--nome", "vm-teste");
    let saida = "";
    parear.stdout!.on("data", (b: Buffer) => { saida += b.toString(); });
    const codigo = await new Promise<string>((resolver, rejeitar) => {
      const t = setTimeout(() => rejeitar(new Error(`sem código: ${saida}`)), 15_000);
      parear.stdout!.on("data", () => {
        const m = /\b([2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4})\b/.exec(saida);
        if (m) { clearTimeout(t); resolver(m[1]!); }
      });
    });
    expect(await (await api("GET", `maquinas/dispositivos/${codigo}`)).json()).toMatchObject({ nome: "vm-teste", plataforma: "linux" });
    expect((await api("POST", `maquinas/dispositivos/${codigo}/aprovar`)).status).toBe(200);
    const codigoSaida = await new Promise<number | null>((resolver) => parear.once("exit", resolver));
    expect(codigoSaida, saida).toBe(0);
    expect(saida).toContain("Conectada como vm-teste");

    const rodar = motor("rodar");
    let erros = "";
    rodar.stderr!.on("data", (b: Buffer) => { erros += b.toString(); });
    let maquina: MaquinasDto["maquinas"][number] | undefined;
    for (let i = 0; i < 60 && !maquina?.conectada; i++) {
      await new Promise((r) => setTimeout(r, 500));
      maquina = ((await (await api("GET", "maquinas")).json()) as MaquinasDto).maquinas[0];
    }
    expect(maquina, erros).toMatchObject({ conectada: true, plataforma: "linux" });
    expect(maquina?.ias["claude-cli"]).not.toBe("pronto");

    rodar.kill("SIGTERM");
    expect(await new Promise<number | null>((resolver) => rodar.once("exit", resolver))).toBe(0);

    // NOD-344: a reinstalação por SSH chama exatamente este caminho (`parear --convite`). A conexão local ainda tem a
    // chave anterior; depois da troca, o motor precisa aposentá-la no servidor, não apenas sobrescrever conexao.json.
    const antiga = maquina!.id;
    const convite = (await (await api("POST", "maquinas/convites", { papel: "computador", substituir: true })).json()) as { convite: string };
    const reparear = motor("parear", url, "--nome", "vm-teste", "--convite", convite.convite);
    let saidaDoReparear = "";
    reparear.stdout!.on("data", (b: Buffer) => { saidaDoReparear += b.toString(); });
    expect(await new Promise<number | null>((resolver) => reparear.once("exit", resolver)), saidaDoReparear).toBe(0);
    const [chaveAntiga] = await abrirTxEscopada(db, dona)((trx) =>
      trx<{ revogado_em: Date | null }[]>`select revogado_em from maquina_tokens where id = ${antiga}`,
    );
    expect(chaveAntiga?.revogado_em).toBeInstanceOf(Date);
  }, 60_000);
});
