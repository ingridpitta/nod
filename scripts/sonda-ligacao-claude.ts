/**
 * Sonda da fase 0 do modo ligação (definido em 2026-10-04, docs/plano-modo-ligacao.md "Fase 0"). PAGA: usa a assinatura
 * do Claude Code (poucas centenas de tokens). Roda o `claude -p` com os argumentos e o ambiente REAIS do laço de voz
 * (montarArgsLigacao + ambienteDaLigacao, MCP vazio) e mede:
 *  - as capacidades do `system/init` (interrupt_receipt_v1, interrupt_cancel_queued_v1);
 *  - o tempo até o primeiro texto, frio (1ª mensagem) e quente (2ª);
 *  - a interrupção in-band: um `control_request interrupt` no meio de uma resposta longa — chega `control_response`?
 *    o `result` sai, e o processo segue vivo para a próxima mensagem?
 *  - o pedido escrito com uma volta em curso: entra na mesma volta (um `result`) ou abre outra?
 * NOD-164: o modelo e as opções vêm no mesmo formato do servidor (lerModelosLigacao); sem opções, vale o padrão
 * (MODELOS_LIGACAO_PADRAO). `--effort` só entra se o `--help` do CLI listar a flag, como no driver.
 * NOD-164 (continuação): `--apps N` mede o peso do catálogo. Um MCP falso `nod` (sem rede, custo zero) expõe o kit
 * REAL da ligação (FERRAMENTAS_NOD_POR_MODO.ligacao, com os schemas de FERRAMENTAS_NOD) mais N apps sintéticos de
 * FERRAMENTAS_POR_APP ferramentas cada, no formato de um conector (`<app>__<ACAO>`, descrição e 5 campos). Com 0, só o kit.
 * Uso: node scripts/sonda-ligacao-claude.ts [--modelo claude-sonnet-4-6] [--esforco low] [--pensamento adaptativo|desligado] [--apps 2] [--bruto sonda.jsonl]
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODELOS_LIGACAO_PADRAO } from "../src/contracts/modelos.ts";
import type { PlanoTurno } from "../src/contracts/plano-turno.ts";
import { lerModelosLigacao } from "../src/domain/modelo-ligacao.ts";
import { ambienteDaLigacao, montarArgsLigacao } from "../src/adapters/executor/drivers/claude-ligacao.ts";
import { lerFlagsDoHelp } from "../src/adapters/executor/sonda.ts";
import { FERRAMENTAS_NOD } from "../src/contracts/ferramentas-nod.ts";
import { FERRAMENTAS_NOD_POR_MODO } from "../src/domain/plano-turno.ts";
import { montarAmbiente } from "../src/domain/ambiente-executor.ts";

const arg = (nome: string) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
// Sem --modelo, o padrão vai inteiro (com o esforço dele); com --modelo, vale como no config.env: só as opções dadas.
const padrao = MODELOS_LIGACAO_PADRAO["claude-cli"];
const esforco = arg("--esforco") ?? (arg("--modelo") ? undefined : padrao.esforco);
const opcoes = [["esforco", esforco], ["pensamento", arg("--pensamento")]].filter(([, v]) => v).map(([k, v]) => `${k}=${v}`);
const cfg = lerModelosLigacao({ NOD_MODELO_LIGACAO_CLAUDE: [arg("--modelo") ?? padrao.modelo, ...opcoes].join(" ") })["claude-cli"];
const escrever = (s: string) => process.stdout.write(`${s}\n`);
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
// A mesma denylist do driver (CLAUDE_EFFORT, CLAUDE_CODE_*, ANTHROPIC_*, NOD_*…): rodada de dentro do Claude Code, o
// esforço herdado mudaria o que a sonda mede.
const envBase = montarAmbiente("local", process.env);
const voz = { ligacaoId: "sonda", modelo: cfg.modelo, nomeBot: "Sonda", generoVoz: "feminina" as const, pensamentoAdaptativo: cfg.pensamentoAdaptativo, ...(cfg.esforco ? { esforco: cfg.esforco } : {}) };
const env = ambienteDaLigacao(envBase, voz);
const dir = mkdtempSync(join(tmpdir(), "sonda-ligacao-"));
const mcpJson = join(dir, "mcp.json");
const FERRAMENTAS_POR_APP = 20;
// Só dígitos: Number() aceitaria "", " 2", "1e1" e "0x2", e `--apps` sem valor viraria 0 em silêncio.
const appsDado = process.argv.includes("--apps") ? (arg("--apps") ?? "") : "0";
if (!/^\d+$/.test(appsDado)) throw new Error(`--apps precisa ser um inteiro ≥ 0 (veio "${appsDado}")`);
const apps = Number(appsDado);
const ACOES = ["LISTAR", "BUSCAR", "VER", "CRIAR", "ATUALIZAR"];
const ferramentas = [
  ...FERRAMENTAS_NOD_POR_MODO.ligacao.map((nome) => ({ name: nome, description: String(FERRAMENTAS_NOD[nome].description ?? nome), inputSchema: FERRAMENTAS_NOD[nome] })),
  ...Array.from({ length: apps * FERRAMENTAS_POR_APP }, (_, i) => {
    const app = `app${Math.floor(i / FERRAMENTAS_POR_APP) + 1}`;
    const acao = `${ACOES[i % ACOES.length]}_ITEM_${i % FERRAMENTAS_POR_APP}`;
    return {
      name: `${app}__${acao}`,
      description: `Ferramenta do conector ${app}: ${acao.toLowerCase().replace(/_/g, " ")}. Recebe o identificador do item, filtros opcionais e paginação; devolve os campos principais do item em JSON. Use quando a pessoa pedir algo deste app.`,
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Identificador do item no app (UUID ou chave curta)." },
          consulta: { type: "string", description: "Texto livre para filtrar os itens." },
          limite: { type: "integer", description: "Quantos itens devolver, de 1 a 100.", minimum: 1, maximum: 100 },
          cursor: { type: "string", description: "Cursor da próxima página, devolvido pela chamada anterior." },
          campos: { type: "array", items: { type: "string" }, description: "Campos a incluir na resposta." },
        },
        additionalProperties: false,
      },
    };
  }),
];
// O MCP falso, no papel do proxy do nod: responde initialize e tools/list; nenhuma ferramenta é chamada pela sonda.
const mcpFalso = join(dir, "mcp-falso.mjs");
writeFileSync(mcpFalso, `import { createInterface } from "node:readline";
const tools = ${JSON.stringify(ferramentas)};
const enviar = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
createInterface({ input: process.stdin }).on("line", (l) => {
  let m; try { m = JSON.parse(l); } catch { return; }
  if (m.method === "initialize") enviar({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "nod", version: "0" } } });
  else if (m.method === "tools/list") enviar({ jsonrpc: "2.0", id: m.id, result: { tools } });
  else if (m.id !== undefined) enviar({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "sonda" } });
});
process.stdin.on("end", () => process.exit(0));
`);
writeFileSync(mcpJson, JSON.stringify({ mcpServers: { nod: { type: "stdio", command: process.execPath, args: [mcpFalso] } } }));
// Só os campos que montarArgsLigacao lê: voz, catálogo e o prompt de sistema.
const plano = { ligacaoVoz: voz, catalogo: { ferramentas: ferramentas.map((f) => ({ nomeMcp: `mcp__nod__${f.name}` })) }, promptSistema: "Você está numa ligação de voz. Responda em português do Brasil, curto, sem markdown." } as unknown as PlanoTurno;
const help = await lerFlagsDoHelp("claude", env);
const flagsNoHelp = ("flags" in help ? help.flags : null) ?? [];
const args = montarArgsLigacao({ plano, mcpJson, sessaoId: randomUUID(), flagsNoHelp });
escrever(`modelo: ${cfg.modelo} · esforço: ${args.includes("--effort") ? cfg.esforco : cfg.esforco ? `${cfg.esforco} (CLI sem --effort: ignorado)` : "padrão"} · adaptativo: ${cfg.pensamentoAdaptativo ? "ligado" : "desligado"} · apps: ${apps} (${ferramentas.length} ferramentas)`);
const proc = spawn("claude", args, { cwd: dir, env, stdio: ["pipe", "pipe", "pipe"] });
const linhas: { em: number; o: Record<string, unknown> }[] = [];
let resto = "";
proc.stdout.on("data", (b: Buffer) => {
  resto += b.toString("utf8");
  let n: number;
  while ((n = resto.indexOf("\n")) >= 0) {
    const l = resto.slice(0, n);
    resto = resto.slice(n + 1);
    try { linhas.push({ em: Date.now(), o: JSON.parse(l) as Record<string, unknown> }); } catch { /* não JSON */ }
  }
});
const mandar = (texto: string) => proc.stdin.write(`${JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: texto }] } })}\n`);
const ehDelta = (o: Record<string, unknown>) => o.type === "stream_event" && JSON.stringify(o).includes('"text_delta"');
async function esperar(f: (o: Record<string, unknown>) => boolean, desde: number, ms = 60_000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const a = linhas.find((x) => x.em >= desde && f(x.o));
    if (a) return a;
    await dormir(20);
  }
  return null;
}

const inicio = Date.now();
async function main(): Promise<void> {
  let t0 = Date.now();
  mandar("Diga só: alô.");
  const init = await esperar((o) => o.type === "system" && o.subtype === "init", 0);
  escrever(`capacidades: ${JSON.stringify((init?.o.capabilities as unknown) ?? "(nenhuma)")}`);
  const mcp = (init?.o.mcp_servers as { name: string; status: string }[] | undefined) ?? [];
  escrever(`mcp: ${mcp.map((m) => `${m.name}=${m.status}`).join(", ") || "(nenhum)"} · ferramentas no init: ${((init?.o.tools as unknown[] | undefined) ?? []).length}`);
  const d1 = await esperar(ehDelta, t0);
  await esperar((o) => o.type === "result", t0);
  escrever(`1º texto (frio): ${d1 ? d1.em - t0 : "—"} ms`);
  t0 = Date.now();
  mandar("Diga só: tudo bem.");
  const d2 = await esperar(ehDelta, t0);
  const r2 = await esperar((o) => o.type === "result", t0);
  escrever(`1º texto (quente): ${d2 ? d2.em - t0 : "—"} ms · result ttft_ms=${String(r2?.o.ttft_ms ?? "?")}`);
  escrever(`custo até a 2ª volta (alô + tudo bem): US$ ${Number(r2?.o.total_cost_usd ?? NaN).toFixed(4)}`);

  t0 = Date.now();
  mandar("Conte devagar de um a cinquenta, por extenso, um número por frase.");
  await esperar(ehDelta, t0);
  await dormir(700);
  const tInt = Date.now();
  proc.stdin.write(`${JSON.stringify({ type: "control_request", request_id: "int_sonda", request: { subtype: "interrupt", cancel_queued: true } })}\n`);
  const resp = await esperar((o) => o.type === "control_response", tInt, 10_000);
  const r3 = await esperar((o) => o.type === "result", tInt, 15_000);
  escrever(`interrupt: control_response ${resp ? `${resp.em - tInt} ms ${JSON.stringify(resp.o).slice(0, 160)}` : "não veio"} · result ${r3 ? `${r3.em - tInt} ms subtype=${String(r3.o.subtype)}` : "não veio"}`);

  t0 = Date.now();
  mandar("Diga só: voltei.");
  const d4 = await esperar(ehDelta, t0, 20_000);
  escrever(`depois do interrupt o processo responde: ${d4 ? `sim (${d4.em - t0} ms)` : "não"}`);
  await esperar((o) => o.type === "result", t0);

  t0 = Date.now();
  mandar("Conte de um a dez, por extenso.");
  await esperar(ehDelta, t0);
  mandar("Agora diga só: fim.");
  await dormir(12_000);
  const results = linhas.filter((x) => x.em >= t0 && x.o.type === "result").length;
  escrever(`mensagem escrita com a volta em curso: ${results} result(s) em 12 s (1 = entra na mesma volta)`);
  proc.stdin.end();
  await new Promise((r) => proc.on("exit", r));
  // `--bruto <arquivo>`: as linhas do stream-json com o instante relativo, para investigar uma medição estranha.
  const bruto = arg("--bruto");
  if (bruto) writeFileSync(bruto, linhas.map((x) => JSON.stringify({ ms: x.em - inicio, ...x.o })).join("\n"));
  const custo = linhas.filter((x) => x.o.type === "result").map((x) => Number(x.o.total_cost_usd ?? 0)).at(-1);
  escrever(`custo equivalente da sessão: US$ ${custo?.toFixed(4) ?? "?"}`);
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  proc.kill();
  process.exit(1);
});
