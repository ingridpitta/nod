import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { criarClaudeCliDriver } from "../../../src/adapters/executor/drivers/claude-cli.ts";
import { PEDIDO_DE_RESUMO, uuidDoEco } from "../../../src/adapters/executor/drivers/claude-ligacao.ts";
import { configDosDrivers } from "../../../src/adapters/executor/registry.ts";
import { PRAZO_TESTE_FALSO_MS, prazoSondaDoTeste } from "../../helpers/prazo-falso.ts";
import type { ConfigDriver } from "../../../src/adapters/executor/spi.ts";
import type { PlanoTurno } from "../../../src/contracts/plano-turno.ts";
import type { MsgCerebroCliente, MsgCerebroServidor } from "../../../src/contracts/voz.ts";
import { planoHarness } from "../../helpers/plano-harness.ts";

/**
 * O laço de voz do Claude Code (ADR-072) contra o cenário `ligacao-voz` de tests/fixtures/claude-falso.mjs, com um
 * servidor WebSocket local no papel do canal do cérebro. Sem Claude real e sem custo. O cenário imita o que a sonda
 * mediu em 2026-10-04 no CLI 2.1.289: a mensagem escrita com uma volta em curso é lida depois do `result` (texto
 * saindo) ou no meio da volta (ferramenta rodando), e o eco diz quando.
 */
const FALSO = fileURLToPath(new URL("../../fixtures/claude-falso.mjs", import.meta.url));
const proxyPath = fileURLToPath(new URL("../../../src/adapters/mcp-proxy/proxy.ts", import.meta.url));
const HELP_COM_ECO = "--input-format --output-format --system-prompt --no-session-persistence --replay-user-messages";
const HELP_SEM_ECO = "--input-format --output-format --system-prompt --no-session-persistence";

type CanalFalso = { socket: WebSocket; recebidas: MsgCerebroCliente[]; enviar(m: MsgCerebroServidor): void; esperar(pred: (m: MsgCerebroCliente) => boolean): Promise<MsgCerebroCliente> };

let dir: string;
let wss: WebSocketServer;
let urlNod: string;
let cerebro: Promise<CanalFalso>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nod-claude-ligacao-"));
  wss = new WebSocketServer({ port: 0, host: "127.0.0.1", path: "/api/interno/voz/v1/cerebro" });
  await new Promise<void>((r) => wss.once("listening", () => r()));
  urlNod = `http://127.0.0.1:${(wss.address() as AddressInfo).port}`;
  cerebro = new Promise((resolver) => {
    wss.once("connection", (socket) => {
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
});

afterEach(async () => {
  for (const c of wss.clients) c.terminate();
  await new Promise<void>((r) => wss.close(() => r()));
  await rm(dir, { recursive: true, force: true });
});

function planoLigacao(voz: Partial<NonNullable<PlanoTurno["ligacaoVoz"]>> = {}): PlanoTurno {
  const plano = planoHarness();
  plano.tokenDeTurno = "segredo-do-turno";
  plano.modoTurno = "ligacao";
  plano.promptSistema = "Você é a Vera, numa ligação. Fale curto.";
  plano.ligacaoVoz = { ligacaoId: "lig-1", modelo: "claude-haiku-4-5-20251001", nomeBot: "Vera", generoVoz: "feminina", ...voz };
  return plano;
}

const falaDe = (msgs: MsgCerebroCliente[], n: number) => msgs.flatMap((m) => (m.t === "fala" && m.n === n ? [m.delta] : [])).join("");
const finsDe = (msgs: MsgCerebroCliente[]) => msgs.flatMap((m) => (m.t === "fala-fim" ? [m.n] : []));

async function iniciar(help = HELP_COM_ECO, o: { plano?: PlanoTurno; envDoMac?: Record<string, string> } = {}) {
  // As variáveis NOD_FALSO_* têm prefixo NOD_ e a denylist do executor as apagaria: vão fixas no shim.
  const bin = join(dir, "claude");
  const registro = join(dir, "registro.json");
  const stdin = join(dir, "stdin.txt");
  const wrapper = join(dir, "claude.mjs");
  await writeFile(
    wrapper,
    `import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args.includes("-p")) writeFileSync(${JSON.stringify(registro)}, JSON.stringify({ argv: args, env: process.env }));
const filho = spawn(process.execPath, [${JSON.stringify(FALSO)}, ...args], { stdio: ["pipe", "inherit", "inherit"], env: process.env });
process.stdin.on("data", (c) => { appendFileSync(${JSON.stringify(stdin)}, c); filho.stdin.write(c); });
process.stdin.on("end", () => filho.stdin.end());
process.on("SIGTERM", () => filho.kill("SIGTERM"));
filho.on("exit", (code) => process.exit(code ?? 143));
`,
  );
  await writeFile(bin, `#!/bin/sh\nexport NOD_FALSO_CENARIO="ligacao-voz"\nexport NOD_FALSO_HELP=${JSON.stringify(help)}\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(wrapper)} "$@"\n`);
  await chmod(bin, 0o755);
  const base = await configDosDrivers({ HOME: dir, PATH: process.env.PATH, NOD_HOME: join(dir, ".nod"), NOD_SESSAO_SEGREDO: "s", ...o.envDoMac }, { shellDeLogin: false, home: dir });
  const cfg: ConfigDriver = { ...base, bin };
  const instance = await criarClaudeCliDriver({ urlNod, proxyPath, sigtermParaSigkillMs: 50, prazoSondaMs: prazoSondaDoTeste() }).create(cfg);
  const adapter = instance.adapter(o.plano ?? planoLigacao());
  const resultado = adapter.rodarTurno({ sinal: async () => {}, delta: () => {}, evento: () => {} });
  const canal = await cerebro;
  const escritas = async () => (await readFile(stdin, "utf8")).trim().split("\n").map((l) => JSON.parse(l) as { type: string; uuid?: string; message?: { content: { text: string }[] } });
  const argv = async () => (JSON.parse(await readFile(registro, "utf8")) as { argv: string[] }).argv;
  // O shim grava o env que o filho recebeu (NOD-164): é o que prova a variável do thinking e a denylist.
  const envDoFilho = async () => (JSON.parse(await readFile(registro, "utf8")) as { env: Record<string, string> }).env;
  return { adapter, resultado, canal, escritas, argv, envDoFilho };
}

describe("laço de voz do Claude contra o CLI falso", { timeout: PRAZO_TESTE_FALSO_MS }, () => {
  it("NOD-164: --model e --effort vêm do plano, o thinking adaptativo sai pelo env do filho e a NOD_MODELO_LIGACAO_CLAUDE do Mac não muda nada", async () => {
    const plano = planoLigacao({ modelo: "claude-sonnet-4-6", esforco: "low", pensamentoAdaptativo: false });
    const { resultado, canal, argv, envDoFilho } = await iniciar(`${HELP_COM_ECO} --effort`, { plano, envDoMac: { NOD_MODELO_LIGACAO_CLAUDE: "claude-haiku-do-mac" } });
    await canal.esperar((m) => m.t === "ola");
    canal.enviar({ t: "fim", motivo: "pessoa_desligou" });
    await resultado;
    const a = await argv();
    expect(a[a.indexOf("--model") + 1]).toBe("claude-sonnet-4-6");
    expect(a[a.indexOf("--effort") + 1]).toBe("low");
    expect(a.join(" ")).not.toContain("haiku-do-mac");
    const env = await envDoFilho();
    expect(env).toMatchObject({ CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: "1", MAX_THINKING_TOKENS: "0", ENABLE_TOOL_SEARCH: "false" });
    expect(env.NOD_MODELO_LIGACAO_CLAUDE).toBeUndefined();
  });

  it("NOD-164: CLI sem --effort no help segue sem a flag e avisa no log; plano sem as opções (servidor antigo) não liga a variável do thinking", async () => {
    const linhas: string[] = [];
    const espiao = vi.spyOn(console, "log").mockImplementation((l: unknown) => void linhas.push(String(l)));
    try {
      const { resultado, canal } = await iniciar(HELP_COM_ECO, { plano: planoLigacao({ esforco: "low" }) });
      await canal.esperar((m) => m.t === "ola");
      canal.enviar({ t: "fim", motivo: "pessoa_desligou" });
      await resultado;
    } finally {
      espiao.mockRestore();
    }
    const aviso = linhas.find((l) => l.includes('"evento":"ligacao_sem_effort"'));
    expect(aviso && JSON.parse(aviso)).toMatchObject({ nivel: "aviso", esforco: "low" });
  });

  it("NOD-164: o CLI sem --effort no help não recebe a flag; sem pensamentoAdaptativo no plano a variável do thinking não vai", async () => {
    const { resultado, canal, argv, envDoFilho } = await iniciar(HELP_COM_ECO, { plano: planoLigacao({ esforco: "low" }) });
    await canal.esperar((m) => m.t === "ola");
    canal.enviar({ t: "fim", motivo: "pessoa_desligou" });
    await resultado;
    expect(await argv()).not.toContain("--effort");
    const env = await envDoFilho();
    expect(env.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING).toBeUndefined();
    expect(env.MAX_THINKING_TOKENS).toBe("0");
  });

  it("vez vira fala e fala-fim; a vez 0 não é falada; cada mensagem leva um uuid; o fim entrega o resumo", async () => {
    const { resultado, canal, escritas, argv } = await iniciar();
    expect(await canal.esperar((m) => m.t === "ola")).toEqual({ t: "ola", ligacaoId: "lig-1", capacidades: { interrupcao: true, harness: "claude-cli" } });
    canal.enviar({ t: "vez", n: 0, texto: "aquecimento" });
    canal.enviar({ t: "vez", n: 1, texto: "oi" });
    await canal.esperar((m) => m.t === "fala-fim" && m.n === 1);
    expect(falaDe(canal.recebidas, 1)).toBe("Entendi: oi.");
    expect(canal.recebidas.some((m) => (m.t === "fala" || m.t === "fala-fim") && m.n === 0)).toBe(false);

    canal.enviar({ t: "fim", motivo: "pessoa_desligou" });
    const r = await resultado;
    expect(r).toMatchObject({ desfecho: "sucesso", texto: "Resumo da ligação.", sessaoCli: null });
    expect(await argv()).toContain("--replay-user-messages");
    const linhas = await escritas();
    expect(linhas.map((l) => l.message?.content[0]?.text)).toEqual(["aquecimento", "oi", PEDIDO_DE_RESUMO]);
    expect(new Set(linhas.map((l) => l.uuid)).size).toBe(3);
    expect(linhas.every((l) => typeof l.uuid === "string" && l.uuid.length === 36)).toBe(true);
  });

  it("vez escrita com o texto da anterior ainda saindo: o resto da volta antiga fica com a vez antiga, e o fala-fim dela não fecha a nova", async () => {
    const { resultado, canal } = await iniciar();
    canal.enviar({ t: "vez", n: 1, texto: "pode demorar" });
    await canal.esperar((m) => m.t === "fala" && m.n === 1 && m.delta === "Pensando");
    canal.enviar({ t: "vez", n: 2, texto: "e a agenda?" });
    await canal.esperar((m) => m.t === "fala-fim" && m.n === 2);
    // Antes, " terminei." saía com n=2 e o `result` da volta antiga mandava fala-fim n=2 antes da resposta de verdade.
    expect(falaDe(canal.recebidas, 1)).toBe("Pensando terminei.");
    expect(falaDe(canal.recebidas, 2)).toBe("Entendi: e a agenda?.");
    expect(finsDe(canal.recebidas)).toEqual([1, 2]);
    const idx = (pred: (m: MsgCerebroCliente) => boolean) => canal.recebidas.findIndex(pred);
    expect(idx((m) => m.t === "fala-fim" && m.n === 2)).toBeGreaterThan(idx((m) => m.t === "fala" && m.n === 2));
    canal.enviar({ t: "fim", motivo: "pessoa_desligou" });
    expect((await resultado).desfecho).toBe("sucesso");
  });

  it("vez escrita com a ferramenta rodando entra na mesma volta: o texto seguinte é da vez nova e só ela ganha fala-fim", async () => {
    const { resultado, canal } = await iniciar();
    canal.enviar({ t: "vez", n: 1, texto: "anota isso [[ferramenta]]" });
    await canal.esperar((m) => m.t === "atividade" && m.tipo === "inicio");
    canal.enviar({ t: "vez", n: 2, texto: "e a agenda?" });
    await canal.esperar((m) => m.t === "fala-fim");
    expect(falaDe(canal.recebidas, 1)).toBe("Vou anotar.");
    expect(falaDe(canal.recebidas, 2)).toBe("Entendi: e a agenda?.");
    expect(finsDe(canal.recebidas)).toEqual([2]);
    canal.enviar({ t: "fim", motivo: "pessoa_desligou" });
    expect((await resultado).desfecho).toBe("sucesso");
  });

  // NOD-198: a ferramenta do falso termina por evento. Aqui a vez 3 já está na fila quando a volta da vez 2 chama a
  // ferramenta (as duas chegam enquanto a vez 1 ainda fala "Pensando"): a espera olha a fila antes e não trava.
  it("vez já na fila quando a ferramenta começa: entra na mesma volta sem esperar outra mensagem", async () => {
    const { resultado, canal } = await iniciar();
    canal.enviar({ t: "vez", n: 1, texto: "pode demorar" });
    await canal.esperar((m) => m.t === "fala" && m.n === 1 && m.delta === "Pensando");
    canal.enviar({ t: "vez", n: 2, texto: "anota isso [[ferramenta]]" });
    canal.enviar({ t: "vez", n: 3, texto: "e a agenda?" });
    await canal.esperar((m) => m.t === "fala-fim" && m.n === 3);
    expect(falaDe(canal.recebidas, 2)).toBe("Vou anotar.");
    expect(falaDe(canal.recebidas, 3)).toBe("Entendi: e a agenda?.");
    expect(finsDe(canal.recebidas)).toEqual([1, 3]);
    canal.enviar({ t: "fim", motivo: "pessoa_desligou" });
    expect((await resultado).desfecho).toBe("sucesso");
  });

  it("o fim com a ferramenta rodando: o pedido de resumo entra na mesma volta e o laço fecha no `result` dela", async () => {
    const { resultado, canal } = await iniciar();
    canal.enviar({ t: "vez", n: 1, texto: "anota isso [[ferramenta]]" });
    await canal.esperar((m) => m.t === "atividade" && m.tipo === "inicio");
    canal.enviar({ t: "fim", motivo: "pessoa_desligou" });
    const r = await resultado;
    expect(r).toMatchObject({ desfecho: "sucesso", texto: "Resumo da ligação." });
    // Depois do `fim` nada mais é falado.
    expect(canal.recebidas.some((m) => m.t === "fala" && m.delta.includes("Resumo"))).toBe(false);
  });

  it("interromper duro corta a volta; a vez seguinte responde com o número dela", async () => {
    const { resultado, canal } = await iniciar();
    canal.enviar({ t: "vez", n: 1, texto: "pode demorar [[ate-corte]]" }); // só o corte solta o "Pensando" (NOD-198)
    await canal.esperar((m) => m.t === "fala" && m.n === 1);
    canal.enviar({ t: "interromper", modo: "duro" });
    canal.enviar({ t: "vez", n: 2, texto: "outra coisa" });
    await canal.esperar((m) => m.t === "fala-fim" && m.n === 2);
    expect(falaDe(canal.recebidas, 1)).toBe("Pensando");
    expect(falaDe(canal.recebidas, 2)).toBe("Entendi: outra coisa.");
    canal.enviar({ t: "fim", motivo: "pessoa_desligou" });
    expect((await resultado).desfecho).toBe("sucesso");
  });

  it("mensagem na fila cancelada pelo interrupt (cancel_queued) nunca é lida; a vez escrita depois responde com o número dela", async () => {
    const { resultado, canal } = await iniciar();
    canal.enviar({ t: "vez", n: 1, texto: "pode demorar [[ate-corte]]" }); // só o corte solta o "Pensando" (NOD-198)
    await canal.esperar((m) => m.t === "fala" && m.n === 1);
    // A vez 2 fica na fila (o texto da 1 ainda está saindo) e é cancelada pelo interrupt.
    canal.enviar({ t: "vez", n: 2, texto: "esta não chega" });
    canal.enviar({ t: "interromper", modo: "duro" });
    canal.enviar({ t: "vez", n: 3, texto: "outra coisa" });
    await canal.esperar((m) => m.t === "fala-fim" && m.n === 3);
    expect(falaDe(canal.recebidas, 2)).toBe("");
    expect(falaDe(canal.recebidas, 3)).toBe("Entendi: outra coisa.");
    canal.enviar({ t: "fim", motivo: "pessoa_desligou" });
    expect((await resultado).desfecho).toBe("sucesso");
  });

  it("CLI sem o eco: a flag não vai e vale a última vez escrita, como antes", async () => {
    const { resultado, canal, argv } = await iniciar(HELP_SEM_ECO);
    canal.enviar({ t: "vez", n: 1, texto: "oi" });
    await canal.esperar((m) => m.t === "fala-fim" && m.n === 1);
    expect(falaDe(canal.recebidas, 1)).toBe("Entendi: oi.");
    canal.enviar({ t: "vez", n: 2, texto: "e a agenda?" });
    await canal.esperar((m) => m.t === "fala-fim" && m.n === 2);
    expect(falaDe(canal.recebidas, 2)).toBe("Entendi: e a agenda?.");
    canal.enviar({ t: "fim", motivo: "pessoa_desligou" });
    expect((await resultado).desfecho).toBe("sucesso");
    expect(await argv()).not.toContain("--replay-user-messages");
  });

  it("NOD-168: rate_limit `rejected` manda um `limite` só (mesmo em duas voltas) e o fim fecha a entrada sem pedir o resumo", async () => {
    const { resultado, canal, escritas } = await iniciar();
    await canal.esperar((m) => m.t === "ola");
    canal.enviar({ t: "vez", n: 1, texto: "[[limite]] oi" });
    await canal.esperar((m) => m.t === "limite");
    canal.enviar({ t: "vez", n: 2, texto: "[[limite]] de novo" });
    await canal.esperar((m) => m.t === "fala-fim" && m.n === 2);
    expect(canal.recebidas.filter((m) => m.t === "limite")).toHaveLength(1);
    canal.enviar({ t: "fim", motivo: "limite_da_assinatura" });
    await resultado;
    expect((await escritas()).map((l) => l.message?.content[0]?.text)).not.toContain(PEDIDO_DE_RESUMO);
  });

  it("NOD-168: rate_limit `allowed_warning` (perto do teto) não manda `limite` e a vez é respondida", async () => {
    const { resultado, canal } = await iniciar();
    await canal.esperar((m) => m.t === "ola");
    canal.enviar({ t: "vez", n: 1, texto: "[[limite-aviso]] oi" });
    await canal.esperar((m) => m.t === "fala-fim" && m.n === 1);
    expect(falaDe(canal.recebidas, 1)).toBe("Entendi: [[limite-aviso]] oi.");
    expect(canal.recebidas.some((m) => m.t === "limite")).toBe(false);
    canal.enviar({ t: "fim", motivo: "pessoa_desligou" });
    expect((await resultado).desfecho).toBe("sucesso");
  });
});

describe("uuidDoEco", () => {
  it("só o eco de uma mensagem nossa devolve o uuid", () => {
    expect(uuidDoEco(JSON.stringify({ type: "user", isReplay: true, uuid: "abc", message: { role: "user", content: [] } }))).toBe("abc");
    expect(uuidDoEco(JSON.stringify({ type: "user", uuid: "abc", message: { role: "user", content: [{ type: "tool_result" }] } }))).toBeNull();
    expect(uuidDoEco(JSON.stringify({ type: "assistant", isReplay: true, uuid: "abc" }))).toBeNull();
    expect(uuidDoEco('{"isReplay" quebrado')).toBeNull();
  });
});
