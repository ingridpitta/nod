import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { criarCodexCliDriver } from "../../../src/adapters/executor/drivers/codex-cli.ts";
import { PEDIDO_DE_RESUMO } from "../../../src/adapters/executor/drivers/claude-ligacao.ts";
import { configDosDrivers } from "../../../src/adapters/executor/registry.ts";
import { PRAZO_TESTE_FALSO_MS, prazoSondaDoTeste } from "../../helpers/prazo-falso.ts";
import type { ConfigDriver } from "../../../src/adapters/executor/spi.ts";
import { MODELO_LUNA_CODEX } from "../../../src/contracts/harness.ts";
import type { PlanoTurno } from "../../../src/contracts/plano-turno.ts";
import type { EventoStream, SinaisTurno } from "../../../src/contracts/turno.ts";
import type { MsgCerebroCliente, MsgCerebroServidor } from "../../../src/contracts/voz.ts";
import { planoHarness } from "../../helpers/plano-harness.ts";

// NOD-198: prazo por arquivo (sobe o CLI falso de verdade); a medida sob carga está em prazo-falso.ts.
vi.setConfig({ testTimeout: PRAZO_TESTE_FALSO_MS });

/**
 * O laço de voz do Codex (ADR-076) contra o app-server falso de tests/fixtures/codex-falso.mjs, com um servidor
 * WebSocket local no papel do canal do cérebro. Sem Codex real e sem custo.
 */

let dir: string;
let cfg: ConfigDriver;
let wss: WebSocketServer;
let urlNod: string;
let cerebro: Promise<CanalFalso>;

type CanalFalso = { socket: WebSocket; recebidas: MsgCerebroCliente[]; enviar(m: MsgCerebroServidor): void; esperar(pred: (m: MsgCerebroCliente) => boolean): Promise<MsgCerebroCliente> };

const proxyPath = fileURLToPath(new URL("../../../src/adapters/mcp-proxy/proxy.ts", import.meta.url));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nod-codex-ligacao-"));
  const bin = join(dir, "codex");
  await writeFile(bin, `#!${process.execPath}\nawait import(${JSON.stringify(new URL("../../fixtures/codex-falso.mjs", import.meta.url).href)});\n`);
  await chmod(bin, 0o700);
  wss = new WebSocketServer({ port: 0, host: "127.0.0.1", path: "/api/interno/voz/v1/cerebro" });
  await new Promise<void>((r) => wss.once("listening", () => r()));
  urlNod = `http://127.0.0.1:${(wss.address() as AddressInfo).port}`;
  cerebro = new Promise((resolver) => {
    wss.once("connection", (socket, req) => {
      expect(req.headers.authorization).toBe("Bearer segredo-do-turno");
      const recebidas: MsgCerebroCliente[] = [];
      const esperando: { pred: (m: MsgCerebroCliente) => boolean; r: (m: MsgCerebroCliente) => void }[] = [];
      socket.on("message", (dados) => {
        const m = JSON.parse(String(dados)) as MsgCerebroCliente;
        recebidas.push(m);
        for (const e of [...esperando]) if (e.pred(m)) {
          esperando.splice(esperando.indexOf(e), 1);
          e.r(m);
        }
      });
      resolver({
        socket,
        recebidas,
        enviar: (m) => socket.send(JSON.stringify(m)),
        esperar: (pred) => {
          const ja = recebidas.find(pred);
          return ja ? Promise.resolve(ja) : new Promise((r) => esperando.push({ pred, r }));
        },
      });
    });
  });
  // NOD-164: o cfg nasce como no boot (configDosDrivers, com a denylist): a NOD_MODELO_LIGACAO_CODEX do env do Mac não
  // chega ao driver, e o modelo da ligação é o do plano. Antes o env era montado à mão e mascarava o override morto.
  cfg = await configDosDrivers(
    { HOME: dir, PATH: process.env.PATH ?? "", NOD_HOME: join(dir, "nod"), NOD_CODEX_BIN: bin, TESTE_NOD_REGISTRO: join(dir, "registro.json"), TESTE_NOD_PORTAO: join(dir, "portao"), OPENAI_API_KEY: "nao-herdar", DATABASE_URL: "nao-herdar", NOD_MODELO_LIGACAO_CODEX: "gpt-6-do-mac" },
    { home: dir, shellDeLogin: false },
  );
});

afterEach(async () => {
  for (const c of wss.clients) c.terminate();
  await new Promise<void>((r) => wss.close(() => r()));
  await rm(dir, { recursive: true, force: true });
});

function planoLigacao(): PlanoTurno {
  const plano = planoHarness();
  plano.tokenDeTurno = "segredo-do-turno";
  plano.modoTurno = "ligacao";
  plano.promptSistema = "Você é a Vera, numa ligação. Fale curto.";
  plano.ligacaoVoz = { ligacaoId: "lig-1", modelo: "gpt-6-luna-do-plano", nomeBot: "Vera", generoVoz: "feminina" };
  return plano;
}

/**
 * NOD-198: abre o portão do `[[lento]]`/`[[conclui-antes]]` só depois de o driver ter tratado tudo o que o teste já
 * mandou. O driver trata cada mensagem do cérebro na hora em que ela chega, e o WebSocket entrega em ordem: o pong de
 * um ping enviado depois prova que o `interromper` já foi tratado. Sem relógio (antes, 50 ms contra 300 ms do fake).
 */
async function abrirPortaoDepoisDoQueFoiEnviado(canal: CanalFalso) {
  await new Promise<void>((r) => {
    canal.socket.once("pong", () => r());
    canal.socket.ping();
  });
  await writeFile(join(dir, "portao"), "");
}

const falaDe = (msgs: MsgCerebroCliente[], n: number) => msgs.flatMap((m) => (m.t === "fala" && m.n === n ? [m.delta] : [])).join("");

async function iniciar(plano = planoLigacao()) {
  const instance = await criarCodexCliDriver({ urlNod, proxyPath, sigtermParaSigkillMs: 50, prazoSondaMs: prazoSondaDoTeste() }).create(cfg);
  const sinais: (keyof SinaisTurno)[] = [];
  const eventos: EventoStream[] = [];
  const adapter = instance.adapter(plano);
  const resultado = adapter.rodarTurno({ sinal: async (s) => { sinais.push(s); }, delta: () => {}, evento: (e) => eventos.push(e) });
  return { adapter, resultado, sinais, eventos, canal: await cerebro };
}

it("vez vira fala e fala-fim; a aprovação pedida pelo app-server é negada; o fim entrega o resumo", async () => {
  const { resultado, sinais, eventos, canal } = await iniciar();
  expect(await canal.esperar((m) => m.t === "ola")).toEqual({ t: "ola", ligacaoId: "lig-1", capacidades: { interrupcao: true, harness: "codex-cli" } });
  // A vez 0 é o aquecimento: o modelo responde, mas nada é falado.
  canal.enviar({ t: "vez", n: 0, texto: "aquecimento" });
  canal.enviar({ t: "vez", n: 1, texto: "oi [[ferramenta]]" });
  await canal.esperar((m) => m.t === "fala-fim" && m.n === 1);
  expect(falaDe(canal.recebidas, 1)).toBe("Entendi: oi.");
  expect(canal.recebidas.some((m) => (m.t === "fala" || m.t === "fala-fim") && m.n === 0)).toBe(false);
  expect(canal.recebidas.filter((m) => m.t === "atividade")).toEqual([
    { t: "atividade", tipo: "inicio", nome: "mcp__nod__lembrar" },
    { t: "atividade", tipo: "fim", nome: "mcp__nod__lembrar" },
  ]);
  const seqs = canal.recebidas.flatMap((m) => (m.t === "fala" ? [m.seq] : []));
  expect(seqs).toEqual([...seqs].sort((a, b) => a - b));

  canal.enviar({ t: "fim", motivo: "pessoa_desligou" });
  const r = await resultado;
  expect(r).toMatchObject({ desfecho: "sucesso", texto: "Resumo da ligação: 2 turno(s).", sessaoCli: null, custoUsd: null, ferramentasChamadas: ["mcp__nod__lembrar"] });
  expect(r.tokens.entrada).toBeGreaterThan(0);
  expect(sinais.slice(0, 2)).toEqual(["attempted", "promptSubmitted"]);
  expect(sinais).toContain("producedOutput");
  expect(eventos.some((e) => e.tipo === "init")).toBe(true);

  const registro = JSON.parse(await readFile(join(dir, "registro.json"), "utf8"));
  // Negou o pedido de aprovação no formato do método (sem resposta, o turno travaria).
  expect(registro.aprovacao).toEqual({ decision: "decline" });
  // O modelo é o do plano (resolvido no servidor); a NOD_MODELO_LIGACAO_CODEX do Mac não muda nada nem chega ao filho.
  expect(registro.env.NOD_MODELO_LIGACAO_CODEX).toBeUndefined();
  expect(registro.thread).toMatchObject({ model: "gpt-6-luna-do-plano", ephemeral: true, approvalPolicy: "never", sandbox: "read-only", developerInstructions: "Você é a Vera, numa ligação. Fale curto." });
  expect(registro.turnos.map((t: { texto: string }) => t.texto)).toEqual(["aquecimento", "oi [[ferramenta]]", PEDIDO_DE_RESUMO]);
  expect(registro.turnos.every((t: { effort: string }) => t.effort === "low")).toBe(true);
  // Isolamento: o token só no launcher 0600, nunca no argv; nenhuma chave da OpenAI nem do banco no ambiente.
  expect(registro.args.join(" ")).not.toContain("segredo-do-turno");
  expect(registro.args).toEqual(expect.arrayContaining(["app-server", "features.shell_tool=false", "features.plugins=false", 'approval_policy="never"', "--ignore-user-config"]));
  expect(registro.args.indexOf("app-server")).toBeGreaterThan(registro.args.indexOf("features.plugins=false"));
  expect(registro.env.OPENAI_API_KEY).toBeUndefined();
  expect(registro.env.DATABASE_URL).toBeUndefined();
  expect(registro.launcher).toMatchObject({ ok: true, modo: 0o600 });
  expect(registro.launcher.conteudo).toContain("segredo-do-turno");
  // O diretório do launcher sumiu; só fica a pasta estável da ligação do bot.
  expect(await readdir(cfg.cwdBase)).toEqual(["ligacao-a"]);
});

it("fala no meio de um turno entra por turn/steer e a resposta sai com o número da vez nova", async () => {
  const { resultado, canal } = await iniciar();
  canal.enviar({ t: "vez", n: 1, texto: "pode demorar" });
  await canal.esperar((m) => m.t === "fala" && m.n === 1 && m.delta === "Pensando");
  canal.enviar({ t: "vez", n: 2, texto: "e a agenda?" });
  await canal.esperar((m) => m.t === "fala-fim" && m.n === 2);
  expect(falaDe(canal.recebidas, 2)).toBe("Entendi: e a agenda?.");
  canal.enviar({ t: "fim", motivo: "pessoa_desligou" });
  expect((await resultado).desfecho).toBe("sucesso");
  const registro = JSON.parse(await readFile(join(dir, "registro.json"), "utf8"));
  expect(registro.steers).toEqual(["e a agenda?"]);
  expect(registro.turnos).toHaveLength(2);
});

it("interromper duro vira turn/interrupt; o fim no meio de um turno interrompe antes do resumo", async () => {
  const { resultado, canal } = await iniciar();
  canal.enviar({ t: "vez", n: 1, texto: "pode demorar" });
  await canal.esperar((m) => m.t === "fala" && m.n === 1);
  canal.enviar({ t: "interromper", modo: "duro" });
  await canal.esperar((m) => m.t === "fala-fim" && m.n === 1);
  canal.enviar({ t: "vez", n: 2, texto: "outra vez demorar" });
  await canal.esperar((m) => m.t === "fala" && m.n === 2);
  canal.enviar({ t: "fim", motivo: "pessoa_desligou" });
  const r = await resultado;
  expect(r).toMatchObject({ desfecho: "sucesso", texto: "Resumo da ligação: 2 turno(s)." });
  const registro = JSON.parse(await readFile(join(dir, "registro.json"), "utf8"));
  expect(registro.interrupcoes).toBe(2);
});

it("Parar no meio da ligação encerra o app-server e sai interrompido", async () => {
  const { adapter, resultado, canal } = await iniciar();
  canal.enviar({ t: "vez", n: 1, texto: "pode demorar" });
  await canal.esperar((m) => m.t === "fala" && m.n === 1);
  await adapter.interromper();
  const r = await resultado;
  expect(r.desfecho).toBe("interrompido");
  expect(await readdir(cfg.cwdBase)).toEqual(["ligacao-a"]);
});

// ---- NOD-167 ----------------------------------------------------------------------------------------------------

it("NOD-167: turno mudo — o interromper duro do aviso de vez sem resposta vira turn/interrupt e a vez fecha sem fala", async () => {
  const { resultado, canal } = await iniciar();
  canal.enviar({ t: "vez", n: 1, texto: "[[mudo]] qual a minha agenda" });
  await new Promise((r) => setTimeout(r, 200));
  expect(canal.recebidas.some((m) => m.t === "fala")).toBe(false);
  canal.enviar({ t: "interromper", modo: "duro" });
  await canal.esperar((m) => m.t === "fala-fim" && m.n === 1);
  expect(falaDe(canal.recebidas, 1)).toBe("");
  // A ligação segue: a vez seguinte responde normalmente.
  canal.enviar({ t: "vez", n: 2, texto: "e amanhã" });
  await canal.esperar((m) => m.t === "fala-fim" && m.n === 2);
  expect(falaDe(canal.recebidas, 2)).toBe("Entendi: e amanhã.");
  canal.enviar({ t: "fim", motivo: "pessoa_desligou" });
  expect((await resultado).desfecho).toBe("sucesso");
  const registro = JSON.parse(await readFile(join(dir, "registro.json"), "utf8"));
  expect(registro.interrupcoes).toBe(1);
});

it("NOD-167: o interromper duro com o turn/start ainda sem resposta interrompe o turno assim que ele abre", async () => {
  const { resultado, canal } = await iniciar();
  canal.enviar({ t: "vez", n: 1, texto: "[[lento]] [[mudo]] oi" });
  canal.enviar({ t: "interromper", modo: "duro" });
  await abrirPortaoDepoisDoQueFoiEnviado(canal);
  await canal.esperar((m) => m.t === "fala-fim" && m.n === 1);
  canal.enviar({ t: "fim", motivo: "pessoa_desligou" });
  expect((await resultado).desfecho).toBe("sucesso");
  const registro = JSON.parse(await readFile(join(dir, "registro.json"), "utf8"));
  expect(registro.interrupcoes).toBe(1);
});

// Regressão (revisão NOD-167): o interrupt pedido para um turno que concluiu antes da resposta do turn/start ficava
// armado e cortava a vez seguinte, que a pessoa não interrompeu.
it("NOD-167: o interrupt de um turno que concluiu antes de abrir não corta a vez seguinte", async () => {
  const { resultado, canal } = await iniciar();
  canal.enviar({ t: "vez", n: 1, texto: "[[conclui-antes]] oi" });
  canal.enviar({ t: "interromper", modo: "duro" });
  await abrirPortaoDepoisDoQueFoiEnviado(canal);
  await canal.esperar((m) => m.t === "fala-fim" && m.n === 1);
  canal.enviar({ t: "vez", n: 2, texto: "e amanhã" });
  await canal.esperar((m) => m.t === "fala-fim" && m.n === 2);
  expect(falaDe(canal.recebidas, 2)).toBe("Entendi: e amanhã.");
  canal.enviar({ t: "fim", motivo: "pessoa_desligou" });
  expect((await resultado).desfecho).toBe("sucesso");
  const registro = JSON.parse(await readFile(join(dir, "registro.json"), "utf8"));
  expect(registro.interrupcoes).toBe(0);
});

it("NOD-167: a notificação que o laço não conhece é logada só pelo nome, uma vez", async () => {
  const linhas: string[] = [];
  const espiao = vi.spyOn(console, "log").mockImplementation((v: unknown) => { linhas.push(String(v)); });
  try {
    const { resultado, canal } = await iniciar();
    canal.enviar({ t: "vez", n: 1, texto: "oi" });
    await canal.esperar((m) => m.t === "fala-fim" && m.n === 1);
    canal.enviar({ t: "fim", motivo: "pessoa_desligou" });
    await resultado;
  } finally {
    espiao.mockRestore();
  }
  const ignoradas = linhas.filter((l) => l.includes("codex_ligacao_notificacao_ignorada"));
  expect(ignoradas).toHaveLength(1);
  expect(ignoradas[0]).toContain('"metodo":"account/rateLimits/updated"');
  expect(ignoradas[0]).not.toContain("não logar");
});

it("NOD-167: Codex sem app-server — o Mac anuncia (lacoDeVoz false) e o turno da ligação cai com a causa própria", async () => {
  cfg = { ...cfg, env: { ...cfg.env, TESTE_NOD_SEM_APP_SERVER: "1" } };
  const instance = await criarCodexCliDriver({ urlNod, proxyPath, sigtermParaSigkillMs: 50, prazoSondaMs: prazoSondaDoTeste() }).create(cfg);
  expect(await instance.lacoDeVoz?.()).toBe(false);
  const adapter = instance.adapter(planoLigacao());
  await expect(adapter.rodarTurno({ sinal: async () => {}, delta: () => {}, evento: () => {} })).rejects.toMatchObject({ codigo: "executor_indisponivel", cause: "codex_sem_app_server" });
});

it("NOD-167: com o app-server, lacoDeVoz é true; a sonda --seco mede tudo contra o falso e acha o Luna no model/list", async () => {
  const instance = await criarCodexCliDriver({ urlNod, proxyPath, sigtermParaSigkillMs: 50, prazoSondaMs: prazoSondaDoTeste() }).create(cfg);
  expect(await instance.lacoDeVoz?.()).toBe(true);
  const saida = join(dir, "sonda.txt");
  // NOD-198: era 60 s; a sonda sobe o falso e mede 6 passos, e sob carga o teste inteiro levou 73 s.
  const prazoDaSonda = PRAZO_TESTE_FALSO_MS / 2;
  const r = spawnSync(process.execPath, [fileURLToPath(new URL("../../../scripts/sonda-codex-app-server.ts", import.meta.url)), "--seco", "--saida", saida], { encoding: "utf8", timeout: prazoDaSonda, env: { ...process.env, NOD_MODELO_LIGACAO_CODEX: "" } });
  expect(r.stderr).toBe("");
  expect(r.status).toBe(0);
  const texto = await readFile(saida, "utf8");
  expect(texto).toContain(`model/list: ${MODELO_LUNA_CODEX} presente`);
  for (const medida of ["handshake:", "1º delta:", "turn/steer:", "turn/interrupt:", "aprovação negada:", "ferramenta mcp__nod__lembrar:", "steer no chat:"]) expect(texto).toContain(medida);
  // ADR-083 §6: a mensagem do meio do chat entra pelo steer com a moldura e a resposta sai no mesmo turno.
  expect(texto).toMatch(/^steer no chat: .*aceito.*1ª fala depois: "Recebi: A pessoa escreveu/m);
  expect(texto).toMatch(/^veredito: aprovada/m);
  expect(texto).toMatch(/^data: \d{4}-\d{2}-\d{2}T/m);
  expect(texto).toContain("codex: codex-cli teste");
});

// Regressão (revisão NOD-167): a sonda sem --seco é paga; no CI ela recusa antes de chamar qualquer Codex.
it("NOD-167: no CI, a sonda sem --seco sai 2 sem chamar o Codex", async () => {
  const marca = join(dir, "codex-chamado");
  const espiao = join(dir, "codex-espiao.sh");
  await writeFile(espiao, `#!/bin/sh\ntouch "${marca}"\n`, { mode: 0o755 });
  const saida = join(dir, "sonda-paga.txt");
  const r = spawnSync(process.execPath, [fileURLToPath(new URL("../../../scripts/sonda-codex-app-server.ts", import.meta.url)), "--codex", espiao, "--saida", saida], { encoding: "utf8", timeout: 60_000, env: { ...process.env, CI: "true" } });
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("no CI só roda com --seco");
  expect(existsSync(marca)).toBe(false);
  expect(existsSync(saida)).toBe(false);
});
