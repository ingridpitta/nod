/**
 * Sonda do laço de voz do Codex (NOD-167, ADR-076). PAGA: usa a assinatura do ChatGPT (quatro turnos curtos, centavos).
 * Fala JSON-RPC direto com o `codex app-server`, com os argumentos REAIS do laço (argsAppServer + configMcpCodex) e um
 * MCP falso `nod` no lugar do proxy (sem rede, sem servidor, sem banco). Mede, nesta ordem:
 *  - handshake (initialize + initialized + thread/start);
 *  - model/list: o id do Luna (MODELO_LUNA_CODEX ou --modelo) está na conta? com quais esforços?
 *  - turn/start até o 1º delta (frio), e o pedido de aprovação que o laço nega (com approval_policy=never, o esperado
 *    no Codex real é nenhum pedido);
 *  - uma ferramenta mcp__nod__lembrar: o item mcpToolCall aparece e o MCP falso recebe o tools/call?
 *  - turn/steer com o turno em curso: aceito? a fala muda?
 *  - turn/interrupt: o turno conclui "interrupted", e em quanto tempo?
 *  - steer no chat (ADR-083 §6, 2026-10-07): com uma ferramenta rodando, a mensagem da pessoa entra pelo turn/steer com
 *    a moldura do chat (molduraMensagemNoMeio); aceito? a primeira fala depois dele sai no mesmo turno?
 * A saída sai no terminal e num arquivo (com a data e a versão do Codex), para anexar na homologação.
 *
 * `--seco`: roda contra o app-server falso (tests/fixtures/codex-falso.mjs); é o que o CI exercita, sem Codex e sem custo.
 * Uso: node scripts/sonda-codex-app-server.ts [--modelo gpt-5.6-luna] [--esforco low] [--codex /caminho/do/codex]
 *      [--saida sonda.txt] [--bruto sonda.jsonl] [--seco]
 */
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { argsAppServer, FLAGS_OPCIONAIS_APP_SERVER } from "../src/adapters/executor/drivers/codex-ligacao.ts";
import { configMcpCodex } from "../src/adapters/executor/drivers/codex-comum.ts";
import { MODELO_LUNA_CODEX } from "../src/contracts/harness.ts";
import type { PlanoTurno } from "../src/contracts/plano-turno.ts";
import { montarAmbiente } from "../src/domain/ambiente-executor.ts";
import { molduraMensagemNoMeio } from "../src/domain/mensagem-no-meio.ts";
import {
  ESFORCO_LIGACAO_CODEX,
  type EsforcoCodex,
  type EventoAppServer,
  idDaThread,
  idDoTurno,
  interpretarLinhaAppServer,
  modelosDaLista,
  notificacaoInitialized,
  pedidoInitialize,
  pedidoModelList,
  pedidoThreadStart,
  pedidoTurnInterrupt,
  pedidoTurnStart,
  pedidoTurnSteer,
  respostaNegando,
} from "../src/domain/codex-app-server.ts";

const arg = (nome: string) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const seco = process.argv.includes("--seco");
// A rodada paga é do Mac de quem homologa: no CI só o modo seco, e antes de qualquer efeito (nem a pasta temporária).
if (!seco && process.env.CI) {
  process.stderr.write("sonda-codex-app-server: no CI só roda com --seco (a rodada sem --seco é paga e usa a conta do ChatGPT).\n");
  process.exit(2);
}
const modelo = arg("--modelo") ?? MODELO_LUNA_CODEX;
const esforco = (arg("--esforco") ?? ESFORCO_LIGACAO_CODEX) as EsforcoCodex;
const dir = mkdtempSync(join(tmpdir(), "sonda-codex-app-server-"));
const FALSO = fileURLToPath(new URL("../tests/fixtures/codex-falso.mjs", import.meta.url));
// No modo seco o "codex" é o falso rodando no node desta sonda; senão, o do PATH (ou --codex).
const bin = seco ? [process.execPath, FALSO] : [arg("--codex") ?? "codex"];
const env = montarAmbiente("local", process.env);
const linhasSaida: string[] = [];
const brutas: { em: number; linha: string }[] = [];
const inicio = Date.now();
const escrever = (s: string) => {
  linhasSaida.push(s);
  process.stdout.write(`${s}\n`);
};
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rodarSync = (args: string[]) => spawnSync(bin[0]!, [...bin.slice(1), ...args], { env, cwd: dir, encoding: "utf8", timeout: 20_000 });

// O MCP falso, no papel do proxy do nod: expõe só `lembrar` e anota cada tools/call num arquivo ao lado.
const recebido = join(dir, "mcp-recebido.log");
const mcpFalso = join(dir, "mcp-falso.mjs");
writeFileSync(mcpFalso, `import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
const enviar = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const tools = [{ name: "lembrar", description: "Guarda um lembrete curto para a pessoa.", inputSchema: { type: "object", properties: { texto: { type: "string" } }, required: ["texto"] } }];
createInterface({ input: process.stdin }).on("line", (l) => {
  let m; try { m = JSON.parse(l); } catch { return; }
  if (m.method === "tools/call") appendFileSync(${JSON.stringify(recebido)}, JSON.stringify(m.params ?? null) + "\\n");
  if (m.id === undefined) return;
  if (m.method === "initialize") enviar({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "nod", version: "sonda" } } });
  else if (m.method === "ping") enviar({ jsonrpc: "2.0", id: m.id, result: {} });
  else if (m.method === "tools/list") enviar({ jsonrpc: "2.0", id: m.id, result: { tools } });
  else if (m.method === "tools/call") enviar({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "lembrete guardado" }] } });
  else enviar({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "sonda" } });
});
process.stdin.on("end", () => process.exit(0));
`);

// Só os campos que configMcpCodex lê.
const plano = { catalogo: { ferramentas: [{ nome: "lembrar", nomeMcp: "mcp__nod__lembrar" }] }, politicaExecucao: { prazoMs: 30_000 } } as unknown as PlanoTurno;
const configMcp = configMcpCodex(plano, { urlNod: "http://127.0.0.1:9", proxyPath: mcpFalso });

const versao = (rodarSync(["--version"]).stdout ?? "").trim() || "(sem --version)";
const help = rodarSync(["app-server", "--help"]);
const flagsNoHelp = FLAGS_OPCIONAIS_APP_SERVER.filter((f) => `${help.stdout ?? ""}${help.stderr ?? ""}`.includes(f));
escrever(`data: ${new Date().toISOString()}`);
escrever(`codex: ${versao}${seco ? " (seco: app-server falso)" : ""}`);
escrever(`modelo: ${modelo} · esforço: ${esforco} · flags opcionais: ${flagsNoHelp.join(" ") || "(nenhuma)"}`);
if (help.status !== 0) {
  escrever(`app-server --help: saiu ${String(help.status)} (${(help.stderr ?? "").trim().slice(0, 160)})`);
  escrever("veredito: reprovada (Codex sem app-server)");
  finalizar();
  process.exit(1);
}

const proc = spawn(bin[0]!, [...bin.slice(1), ...argsAppServer({ configMcp, flagsNoHelp })], { cwd: dir, env, stdio: ["pipe", "pipe", "pipe"] });
const eventos: { em: number; e: EventoAppServer }[] = [];
let resto = "";
let stderr = "";
proc.stderr.on("data", (b: Buffer) => { stderr = (stderr + b.toString("utf8")).slice(-4000); });
proc.stdout.on("data", (b: Buffer) => {
  resto += b.toString("utf8");
  let n: number;
  while ((n = resto.indexOf("\n")) >= 0) {
    const l = resto.slice(0, n);
    resto = resto.slice(n + 1);
    brutas.push({ em: Date.now(), linha: l });
    const e = interpretarLinhaAppServer(l);
    eventos.push({ em: Date.now(), e });
    // Como o laço: todo pedido do servidor é negado na hora (sem resposta, o turno trava).
    if (e.tipo === "pedido_servidor") proc.stdin.write(respostaNegando(e.id, e.metodo));
  }
});
let proximoId = 1;
const mandar = (montar: (id: number) => string) => {
  const id = proximoId++;
  proc.stdin.write(montar(id));
  return id;
};
async function esperar(f: (e: EventoAppServer) => boolean, desde: number, ms = 60_000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const a = eventos.find((x) => x.em >= desde && f(x.e));
    if (a) return a;
    await dormir(10);
  }
  return null;
}
const respostaDe = (id: number, desde: number, ms?: number) => esperar((e) => (e.tipo === "resposta" || e.tipo === "resposta_erro") && e.id === id, desde, ms);
const concluido = (turnId: string | null, desde: number, ms?: number) => esperar((e) => e.tipo === "turno_concluido" && (turnId === null || e.turnId === turnId), desde, ms);
const ms = (a: { em: number } | null, t0: number) => (a ? `${a.em - t0} ms` : "não veio");
const falhas: string[] = [];

async function turno(texto: string): Promise<{ t0: number; turnId: string | null }> {
  const t0 = Date.now();
  const id = mandar((i) => pedidoTurnStart(i, { threadId, texto, esforco }));
  const r = await respostaDe(id, t0);
  if (r?.e.tipo !== "resposta") throw new Error(`turn/start falhou: ${r?.e.tipo === "resposta_erro" ? `código ${String(r.e.codigo)}` : "sem resposta"}`);
  return { t0, turnId: idDoTurno(r.e.resultado) };
}
const falaDoTurno = (turnId: string | null, desde: number) => eventos.filter((x) => x.em >= desde && x.e.tipo === "delta" && (turnId === null || x.e.turnId === turnId)).map((x) => (x.e.tipo === "delta" ? x.e.texto : "")).join("");

let threadId = "";
async function main(): Promise<void> {
  // Handshake.
  let t0 = Date.now();
  const init = await respostaDe(mandar((i) => pedidoInitialize(i, { nome: "nod-sonda", versao: "0" })), t0, 20_000);
  if (init?.e.tipo !== "resposta") throw new Error(`initialize: ${init ? "erro" : "sem resposta"}`);
  proc.stdin.write(notificacaoInitialized());
  const thread = await respostaDe(mandar((i) => pedidoThreadStart(i, { modelo, instrucoes: "Você está numa ligação de voz. Responda em português do Brasil, curto, sem markdown.", cwd: dir })), t0, 20_000);
  if (thread?.e.tipo !== "resposta" || !idDaThread(thread.e.resultado)) {
    throw new Error(`thread/start: ${thread?.e.tipo === "resposta_erro" ? `código ${String(thread.e.codigo)} (modelo ${modelo}?)` : "sem thread"}`);
  }
  threadId = idDaThread(thread.e.resultado)!;
  escrever(`handshake: ${ms(thread, t0)} (initialize ${ms(init, t0)})`);

  // model/list.
  t0 = Date.now();
  const lista = await respostaDe(mandar((i) => pedidoModelList(i)), t0, 20_000);
  if (lista?.e.tipo === "resposta") {
    const modelos = modelosDaLista(lista.e.resultado);
    const luna = modelos.find((m) => m.id === modelo);
    if (luna) escrever(`model/list: ${modelo} presente (esforços: ${luna.esforcos.join(", ") || "?"}; padrão ${luna.esforcoPadrao ?? "?"}) em ${lista.em - t0} ms`);
    else {
      escrever(`model/list: ${modelo} AUSENTE; a conta lista: ${modelos.map((m) => m.id).join(", ") || "(nada)"}`);
      falhas.push("modelo ausente do model/list");
    }
    if (luna && luna.esforcos.length > 0 && !luna.esforcos.includes(esforco)) falhas.push(`esforço ${esforco} fora da lista do modelo`);
  } else {
    escrever(`model/list: ${lista ? `erro código ${lista.e.tipo === "resposta_erro" ? String(lista.e.codigo) : "?"}` : "sem resposta"}`);
    falhas.push("model/list sem resposta");
  }

  // 1º turno: tempo até o 1º delta; o pedido de aprovação (se vier) é negado pelo leitor acima.
  const t1 = await turno("Diga só: alô.");
  const d1 = await esperar((e) => e.tipo === "delta", t1.t0);
  const c1 = await concluido(t1.turnId, t1.t0);
  escrever(`1º delta: ${ms(d1, t1.t0)} · turno ${c1?.e.tipo === "turno_concluido" ? c1.e.status : "não concluiu"} em ${ms(c1, t1.t0)}`);
  if (!d1) falhas.push("1º turno sem delta");
  const pedidos = eventos.filter((x) => x.e.tipo === "pedido_servidor").map((x) => (x.e.tipo === "pedido_servidor" ? x.e.metodo : ""));
  escrever(`aprovação negada: ${pedidos.length > 0 ? `${pedidos.join(", ")} (negado; o turno ${c1 ? "seguiu" : "TRAVOU"})` : "nenhum pedido (approval_policy=never)"}`);
  if (pedidos.length > 0 && !c1) falhas.push("turno travou depois da aprovação negada");

  // Ferramenta do nod.
  const t2 = await turno("Use a ferramenta lembrar com o texto \"sonda\" e depois diga só: feito. [[ferramenta]]");
  const item = await esperar((e) => e.tipo === "item" && e.fase === "inicio" && e.ferramenta === "mcp__nod__lembrar", t2.t0);
  const c2 = await concluido(t2.turnId, t2.t0);
  let chamadas = 0;
  try { chamadas = readFileSync(recebido, "utf8").split("\n").filter(Boolean).length; } catch { /* nenhuma */ }
  escrever(`ferramenta mcp__nod__lembrar: item ${ms(item, t2.t0)} · tools/call no MCP: ${chamadas}${seco ? " (seco: o falso não chama o MCP)" : ""} · turno ${c2?.e.tipo === "turno_concluido" ? c2.e.status : "não concluiu"}`);
  if (!item) falhas.push("nenhum item mcp__nod__lembrar");
  if (!seco && chamadas === 0) falhas.push("o MCP falso não recebeu tools/call");

  // turn/steer com o turno em curso: manda logo no 1º delta.
  const t3 = await turno("Conte devagar de um a trinta, por extenso, um número por frase, sem demorar.");
  await esperar((e) => e.tipo === "delta" && e.turnId === t3.turnId, t3.t0);
  const tSteer = Date.now();
  const rSteer = await respostaDe(mandar((i) => pedidoTurnSteer(i, { threadId, texto: "Pare de contar e diga só: mudei.", turnoEsperado: t3.turnId ?? "" })), tSteer, 15_000);
  const c3 = await concluido(t3.turnId, t3.t0);
  const fala3 = falaDoTurno(t3.turnId, t3.t0);
  escrever(`turn/steer: ${rSteer?.e.tipo === "resposta" ? `aceito em ${rSteer.em - tSteer} ms` : rSteer ? `recusado (código ${rSteer.e.tipo === "resposta_erro" ? String(rSteer.e.codigo) : "?"})` : "sem resposta"} · fala depois: "${fala3.slice(-60)}" · turno ${c3?.e.tipo === "turno_concluido" ? c3.e.status : "não concluiu"}`);
  if (rSteer?.e.tipo !== "resposta") falhas.push("turn/steer não aceito");

  // turn/interrupt no meio de uma fala longa.
  const t4 = await turno("Conte devagar de um a cinquenta, por extenso, um número por frase, sem demorar.");
  await esperar((e) => e.tipo === "delta" && e.turnId === t4.turnId, t4.t0);
  const tInt = Date.now();
  const rInt = await respostaDe(mandar((i) => pedidoTurnInterrupt(i, { threadId, turnId: t4.turnId ?? "" })), tInt, 15_000);
  const c4 = await concluido(t4.turnId, tInt, 15_000);
  const status4 = c4?.e.tipo === "turno_concluido" ? c4.e.status : null;
  escrever(`turn/interrupt: resposta ${ms(rInt, tInt)} · turno ${status4 ?? "não concluiu"} em ${ms(c4, tInt)}`);
  if (status4 !== "interrupted") falhas.push("turn/interrupt não concluiu o turno como interrupted");

  // O processo segue vivo depois do interrupt?
  const t5 = await turno("Diga só: voltei.");
  const d5 = await esperar((e) => e.tipo === "delta" && e.turnId === t5.turnId, t5.t0, 20_000);
  await concluido(t5.turnId, t5.t0, 20_000);
  escrever(`depois do interrupt responde: ${d5 ? `sim (${d5.em - t5.t0} ms)` : "não"}`);
  if (!d5) falhas.push("não respondeu depois do interrupt");

  // Steer no chat (ADR-083 §6): a mensagem do meio entra com a moldura enquanto uma ferramenta roda, como o driver do
  // chat (codex-chat.ts) faz; a resposta a ela tem de sair no mesmo turno, antes de ele concluir.
  const t6 = await turno("Use a ferramenta lembrar com o texto \"chat\" e depois diga só: terminei. [[chat-steer]]");
  const ferramenta6 = await esperar((e) => e.tipo === "item" && e.fase === "inicio" && e.ferramenta !== null, t6.t0);
  const tSteer6 = Date.now();
  const rSteer6 = ferramenta6 ? await respostaDe(mandar((i) => pedidoTurnSteer(i, { threadId, texto: molduraMensagemNoMeio("qual é a capital da França?"), turnoEsperado: t6.turnId ?? "" })), tSteer6, 15_000) : null;
  const c6 = await concluido(t6.turnId, t6.t0);
  // NOD-198: "depois" é pela ORDEM dos eventos (os que vieram após o início da ferramenta), não pelo relógio: sob
  // carga o "Começando." e o início da ferramenta chegam no mesmo pedaço do stdout, no mesmo milissegundo de tSteer6.
  const depoisDaFerramenta = ferramenta6 ? eventos.slice(eventos.indexOf(ferramenta6) + 1) : [];
  const falasDepois = depoisDaFerramenta.filter((x) => x.e.tipo === "item" && x.e.fase === "fim" && x.e.texto).map((x) => (x.e.tipo === "item" ? x.e.texto ?? "" : ""));
  escrever(`steer no chat: ferramenta ${ms(ferramenta6, t6.t0)} · steer ${rSteer6?.e.tipo === "resposta" ? `aceito em ${rSteer6.em - tSteer6} ms` : rSteer6 ? "recusado" : "não enviado"} · 1ª fala depois: "${(falasDepois[0] ?? "").slice(0, 80)}" · turno ${c6?.e.tipo === "turno_concluido" ? c6.e.status : "não concluiu"}`);
  if (!ferramenta6) falhas.push("steer no chat: nenhuma ferramenta para mandar a mensagem no meio");
  else if (rSteer6?.e.tipo !== "resposta") falhas.push("steer no chat não aceito com a ferramenta rodando");
  else if (falasDepois.length === 0) falhas.push("steer no chat sem fala depois da mensagem");

  const ignoradas = [...new Set(eventos.flatMap((x) => (x.e.tipo === "ignorado" && x.e.metodo ? [x.e.metodo] : [])))];
  escrever(`notificações que o laço ignora: ${ignoradas.join(", ") || "(nenhuma)"}`);
  const tokens = eventos.filter((x) => x.e.tipo === "uso").at(-1);
  if (tokens?.e.tipo === "uso") escrever(`tokens (último uso): entrada ${tokens.e.tokens.entrada} · cache ${tokens.e.tokens.cacheLeitura} · saída ${tokens.e.tokens.saida}`);
  escrever(`veredito: ${falhas.length === 0 ? "aprovada" : `reprovada (${falhas.join("; ")})`}`);
}

function finalizar(): void {
  const saida = arg("--saida") ?? `sonda-codex-app-server-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
  writeFileSync(saida, `${linhasSaida.join("\n")}\n`);
  // `--bruto <arquivo>`: as linhas JSON-RPC com o instante relativo, para investigar uma medição estranha.
  const bruto = arg("--bruto");
  if (bruto) for (const b of brutas) appendFileSync(bruto, `${JSON.stringify({ ms: b.em - inicio, linha: b.linha })}\n`);
}

main()
  .then(async () => {
    proc.stdin.end();
    await Promise.race([new Promise((r) => proc.on("exit", r)), dormir(5_000)]);
    proc.kill();
    finalizar();
    process.exit(falhas.length === 0 ? 0 : 1);
  })
  .catch((e: unknown) => {
    escrever(`erro: ${e instanceof Error ? e.message : String(e)}${stderr ? ` · stderr: ${stderr.trim().slice(-300)}` : ""}`);
    escrever("veredito: reprovada");
    proc.kill();
    finalizar();
    process.exit(1);
  });
