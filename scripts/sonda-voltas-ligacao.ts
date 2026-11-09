/**
 * Sonda do laço de voz: quando o `claude -p` em stream-json LÊ uma mensagem escrita com uma volta em curso (definido em
 * 2026-10-04). PAGA: usa a assinatura do Claude Code (o modelo padrão da ligação, centavos). Roda o CLI com os argumentos do laço
 * de voz, `--replay-user-messages` e um MCP de uma ferramenta lenta (este mesmo arquivo com `--mcp`), e mostra a linha
 * do tempo de cada caso:
 *  1. falar antes da ferramenta: o texto sai antes do `tool_use`? o que o CLI faz se o modelo não escreve nada depois?
 *  2. mensagem escrita com a FERRAMENTA rodando: entra na mesma volta (um `result`) ou abre outra?
 *  3. mensagem escrita com o TEXTO saindo: idem.
 *  4. `interrupt` com `cancel_queued` e uma mensagem na fila: a mensagem é cancelada? o processo segue?
 *  5. `interrupt` e, na hora, outra mensagem: ela é respondida?
 * O eco (`user` com `isReplay`) marca o instante em que o CLI leu cada mensagem; o driver (claude-ligacao.ts) usa esse
 * eco para saber de qual vez é o texto que segue.
 * NOD-164: modelo e opções no formato do servidor (lerModelosLigacao), ambiente do driver (ambienteDaLigacao).
 * Uso: node scripts/sonda-voltas-ligacao.ts [--modelo claude-sonnet-4-6] [--esforco low] [--pensamento adaptativo|desligado]
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { MODELOS_LIGACAO_PADRAO } from "../src/contracts/modelos.ts";
import { lerModelosLigacao } from "../src/domain/modelo-ligacao.ts";
import { ambienteDaLigacao } from "../src/adapters/executor/drivers/claude-ligacao.ts";
import { lerFlagsDoHelp } from "../src/adapters/executor/sonda.ts";
import { montarAmbiente } from "../src/domain/ambiente-executor.ts";

type Json = Record<string, unknown>;
const obj = (x: unknown): Json | null => (typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Json) : null);
const escrever = (s: string) => process.stdout.write(`${s}\n`);
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** O MCP da sonda: uma ferramenta `anotar` que leva 2,5 s (tempo de sobra para escrever uma mensagem no meio). */
function servirMcp(): void {
  const enviar = (o: Json) => process.stdout.write(`${JSON.stringify(o)}\n`);
  const ferramentas = [{ name: "anotar", description: "Anota um campo. Chame depois de responder falando.", inputSchema: { type: "object", properties: { campo: { type: "string" }, valor: { type: "string" } }, required: ["campo", "valor"], additionalProperties: false } }];
  createInterface({ input: process.stdin }).on("line", (linha) => {
    let msg: Json | null = null;
    try {
      msg = obj(JSON.parse(linha));
    } catch {
      return;
    }
    if (!msg) return;
    const { id, method } = msg;
    if (method === "initialize") enviar({ jsonrpc: "2.0", id, result: { protocolVersion: obj(msg.params)?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "lento", version: "0.1.0" } } });
    else if (method === "tools/list") enviar({ jsonrpc: "2.0", id, result: { tools: ferramentas } });
    else if (method === "tools/call") setTimeout(() => enviar({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "Anotado." }] } }), 2500);
    else if (id !== undefined) enviar({ jsonrpc: "2.0", id, result: {} });
  });
}

async function sondar(): Promise<void> {
  const arg = (nome: string) => {
    const i = process.argv.indexOf(nome);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  // Sem --modelo, o padrão vai inteiro (com o esforço dele); com --modelo, vale como no config.env: só as opções dadas.
  const padrao = MODELOS_LIGACAO_PADRAO["claude-cli"];
  const esforco = arg("--esforco") ?? (arg("--modelo") ? undefined : padrao.esforco);
  const opcoes = [["esforco", esforco], ["pensamento", arg("--pensamento")]].filter(([, v]) => v).map(([k, v]) => `${k}=${v}`);
  const cfg = lerModelosLigacao({ NOD_MODELO_LIGACAO_CLAUDE: [arg("--modelo") ?? padrao.modelo, ...opcoes].join(" ") })["claude-cli"];
  // A mesma denylist do driver (CLAUDE_EFFORT, CLAUDE_CODE_*, ANTHROPIC_*, NOD_*…): rodada de dentro do Claude Code, o
  // esforço herdado mudaria o que a sonda mede.
  const envBase = montarAmbiente("local", process.env);
  const env = ambienteDaLigacao(envBase, cfg);
  // Mesmo gate do driver: `--effort` só se o `--help` do CLI listar a flag.
  const help = await lerFlagsDoHelp("claude", env);
  const flags = "flags" in help ? help.flags : null;
  if (cfg.esforco && !flags?.includes("--effort")) escrever(`aviso: o CLI não lista --effort; esforco=${cfg.esforco} ignorado`);
  const cwd = mkdtempSync(join(tmpdir(), "sonda-voltas-"));
  const mcpJson = join(cwd, "mcp.json");
  writeFileSync(mcpJson, JSON.stringify({ mcpServers: { lento: { command: process.execPath, args: [fileURLToPath(import.meta.url), "--mcp"] } } }));
  const prompt =
    'Você é a Nina, numa ligação de voz. Responda em português do Brasil, curto, falado, sem markdown. Quando a pessoa disser como quer ser chamada, responda falando primeiro (uma reação curta e a pergunta "Como você conheceu o nod?") e só então chame a ferramenta anotar com campo=apelido, na mesma resposta. Não anuncie a ferramenta. Depois da ferramenta, não escreva mais nada.';
  const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--replay-user-messages", "--model", cfg.modelo,
    ...(cfg.esforco && flags?.includes("--effort") ? ["--effort", cfg.esforco] : []),
    "--setting-sources", "project", "--strict-mcp-config", "--mcp-config", mcpJson, "--tools", "", "--allowedTools", "mcp__lento__anotar", "--permission-mode", "default",
    "--system-prompt", prompt, "--no-session-persistence", "--session-id", randomUUID()];
  const proc = spawn("claude", args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  const linhas: { em: number; o: Json }[] = [];
  let resto = "";
  proc.stdout.on("data", (b: Buffer) => {
    resto += b.toString("utf8");
    let n: number;
    while ((n = resto.indexOf("\n")) >= 0) {
      const l = resto.slice(0, n);
      resto = resto.slice(n + 1);
      try {
        const o = obj(JSON.parse(l));
        if (o) linhas.push({ em: Date.now(), o });
      } catch {
        // não JSON
      }
    }
  });
  const mandar = (texto: string, uuid: string = randomUUID()) => proc.stdin.write(`${JSON.stringify({ type: "user", uuid, message: { role: "user", content: [{ type: "text", text: texto }] } })}\n`);
  const interromper = () => proc.stdin.write(`${JSON.stringify({ type: "control_request", request_id: `int_${randomUUID()}`, request: { subtype: "interrupt", cancel_queued: true } })}\n`);
  const textoDoDelta = (o: Json): string | null => {
    const ev = obj(o.event);
    const delta = obj(ev?.delta);
    return o.type === "stream_event" && ev?.type === "content_block_delta" && delta?.type === "text_delta" ? String(delta.text) : null;
  };
  const resumir = (o: Json): string | null => {
    const conteudo = obj(o.message)?.content;
    const blocos = Array.isArray(conteudo) ? conteudo.map((b) => obj(b)) : [];
    if (o.type === "assistant") {
      const tu = blocos.find((b) => b?.type === "tool_use");
      return tu ? `tool_use ${String(tu.name)}` : null;
    }
    if (o.type === "user") {
      if (blocos.some((b) => b?.type === "tool_result")) return "tool_result";
      const texto = blocos.map((b) => String(b?.text ?? "")).join(" ").slice(0, 60);
      return o.isReplay === true ? `eco uuid=${String(o.uuid).slice(0, 8)} ${JSON.stringify(texto)}` : `mensagem do próprio CLI ${JSON.stringify(texto)}`;
    }
    if (o.type === "result") return `RESULT ${String(o.subtype)}`;
    if (o.type === "control_response") return `control_response ${JSON.stringify(o.response).slice(0, 120)}`;
    return null;
  };
  const mostrar = (desde: number, t0: number) => {
    let deltas: { em: number; t: string }[] = [];
    const sair = () => {
      if (deltas.length === 0) return;
      escrever(`  +${String(deltas[0]!.em - t0).padStart(5)} ms  texto ${JSON.stringify(deltas.map((d) => d.t).join("")).slice(0, 120)}`);
      deltas = [];
    };
    for (const x of linhas.slice(desde)) {
      const t = textoDoDelta(x.o);
      if (t !== null) {
        deltas.push({ em: x.em, t });
        continue;
      }
      const r = resumir(x.o);
      if (r === null) continue;
      sair();
      escrever(`  +${String(x.em - t0).padStart(5)} ms  ${r}`);
    }
    sair();
  };
  const results = (desde: number) => linhas.slice(desde).filter((x) => x.o.type === "result").length;
  const esperar = async (f: (o: Json) => boolean, desde: number, ms = 40_000) => {
    const fim = Date.now() + ms;
    while (Date.now() < fim && !linhas.slice(desde).some((x) => f(x.o))) await dormir(20);
  };
  const esperarResults = async (n: number, desde: number, ms = 40_000) => {
    const fim = Date.now() + ms;
    while (Date.now() < fim && results(desde) < n) await dormir(50);
    await dormir(1500);
  };
  const caso = async (titulo: string, fn: (desde: number) => Promise<void>) => {
    const desde = linhas.length;
    const t0 = Date.now();
    escrever(`\n== ${titulo}`);
    await fn(desde);
    mostrar(desde, t0);
    escrever(`  results: ${results(desde)}`);
  };
  const temFerramenta = (o: Json) => resumir(o)?.startsWith("tool_use") === true;
  const temTexto = (o: Json) => textoDoDelta(o) !== null;

  escrever(`modelo: ${cfg.modelo} · esforço: ${cfg.esforco ?? "padrão"} · adaptativo: ${cfg.pensamentoAdaptativo ? "ligado" : "desligado"}`);
  await caso("0. aquecimento", async (desde) => {
    mandar("[nod] A ligação começou. Não responda nada além de ok.");
    await esperarResults(1, desde);
  });
  await caso("1. falar antes da ferramenta, sem escrever nada depois", async (desde) => {
    mandar("Pode me chamar de Marlon.");
    await esperarResults(1, desde);
  });
  await caso("2. mensagem escrita com a FERRAMENTA rodando", async (desde) => {
    mandar("Na verdade, pode me chamar de Ana.");
    await esperar(temFerramenta, desde);
    await dormir(300);
    mandar("Um amigo me indicou.", "bbbbbbbb-0000-4000-8000-000000000002");
    await esperarResults(2, desde, 30_000);
  });
  await caso("3. mensagem escrita com o TEXTO saindo", async (desde) => {
    mandar("Conte de um a quinze, por extenso, um número por frase.");
    await esperar(temTexto, desde);
    await dormir(300);
    mandar("Agora diga só: fim.", "cccccccc-0000-4000-8000-000000000003");
    await esperarResults(2, desde, 30_000);
  });
  await caso("4. interrupt (cancel_queued) com uma mensagem na fila; depois outra", async (desde) => {
    mandar("Conte de um a trinta, por extenso, um número por frase.");
    await esperar(temTexto, desde);
    await dormir(300);
    mandar("Diga só: na fila.", "dddddddd-0000-4000-8000-000000000004");
    await dormir(200);
    interromper();
    await dormir(4000);
    mandar("Diga só: depois.", "eeeeeeee-0000-4000-8000-000000000005");
    await dormir(8000);
  });
  await caso("5. interrupt e, na hora, outra mensagem", async (desde) => {
    mandar("Conte de um a trinta, por extenso, um número por frase.");
    await esperar(temTexto, desde);
    await dormir(500);
    interromper();
    mandar("Diga só: cheguei.", "ffffffff-0000-4000-8000-000000000006");
    await dormir(9000);
  });
  proc.stdin.end();
  await new Promise((r) => proc.on("exit", r));
  const custo = linhas.filter((x) => x.o.type === "result").map((x) => Number(x.o.total_cost_usd ?? 0)).at(-1);
  escrever(`\ncusto equivalente da sessão: US$ ${custo?.toFixed(4) ?? "?"}`);
}

if (process.argv.includes("--mcp")) servirMcp();
else
  sondar().catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
