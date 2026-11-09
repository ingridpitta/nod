/**
 * Sonda do kit do terminal no Codex (ADR-103). PAGA: três turnos curtos na assinatura do ChatGPT (centavos), com o
 * driver de VERDADE (criarCodexCliDriver → chat no app-server), o hook do nod de verdade (hook-nativas.ts) e o Codex
 * instalado, contra um servidor do nod falso nesta mesma máquina (só a rota /api/interno/nativas, que nega o comando
 * com NEGAR) e um MCP falso no lugar do proxy. Mede:
 *  1. o hook fica confiado e decide: `git --version` roda, `echo NEGAR-2` é barrado com o motivo do servidor, o
 *     apply_patch cria o arquivo na pasta do bot e a busca na web avisa o servidor (contamina);
 *  2. a thread continua (`thread/resume`): o modelo lembra o primeiro comando do turno anterior;
 *  3. a thread bifurca (`thread/fork`): o id novo é outro.
 * A pasta do bot fica num HOME temporário; o Codex usa a conta de verdade (CODEX_HOME). O `config.toml` da conta é
 * guardado antes e devolvido no fim (a confiança gravada aqui é a do script desta pasta, não a do app).
 *
 * Uso: node scripts/sonda-codex-terminal.ts [--codex /caminho/do/codex] [--modelo gpt-5.6-luna] [--saida sonda.txt]
 */
import { createServer } from "node:http";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { criarCodexCliDriver } from "../src/adapters/executor/drivers/codex-cli.ts";
import type { PlanoTurno } from "../src/contracts/plano-turno.ts";
import { NATIVAS_DO_TERMINAL_CODEX } from "../src/domain/nativas.ts";

const arg = (nome: string) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
if (process.env.CI) {
  process.stderr.write("sonda-codex-terminal: é paga e usa a conta do ChatGPT; não roda no CI.\n");
  process.exit(2);
}
const codex = arg("--codex") ?? "codex";
const modelo = arg("--modelo") ?? "gpt-5.6-luna";
const linhas: string[] = [];
const escrever = (s: string) => {
  linhas.push(s);
  process.stdout.write(`${s}\n`);
};
const dir = mkdtempSync(join(tmpdir(), "sonda-codex-terminal-"));
const home = join(dir, "home");
mkdirSync(home);
const codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");
const configToml = join(codexHome, "config.toml");
const guardado = join(dir, "config.toml.antes");
if (existsSync(configToml)) copyFileSync(configToml, guardado);

// O MCP falso, no papel do proxy (o launcher do driver importa o módulo e chama `main()`).
const mcpFalso = join(dir, "mcp-falso.mjs");
writeFileSync(mcpFalso, `import { createInterface } from "node:readline";
export async function main() {
  const enviar = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
  const tools = [{ name: "lembrar", description: "Guarda um lembrete curto para a pessoa.", inputSchema: { type: "object", properties: { texto: { type: "string" } }, required: ["texto"] } }];
  createInterface({ input: process.stdin }).on("line", (l) => {
    let m; try { m = JSON.parse(l); } catch { return; }
    if (m.id === undefined) return;
    if (m.method === "initialize") enviar({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "nod", version: "sonda" } } });
    else if (m.method === "tools/list") enviar({ jsonrpc: "2.0", id: m.id, result: { tools } });
    else if (m.method === "tools/call") enviar({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "lembrete guardado" }] } });
    else enviar({ jsonrpc: "2.0", id: m.id, result: {} });
  });
  await new Promise((r) => process.stdin.on("end", r));
}
`);

// O servidor do nod falso: a rota das nativas nega o comando com NEGAR e libera o resto.
const pedidos: Record<string, unknown>[] = [];
const servidor = createServer((req, res) => {
  let corpo = "";
  req.on("data", (v: Buffer) => { corpo += v.toString("utf8"); });
  req.on("end", () => {
    const c = (corpo ? JSON.parse(corpo) : {}) as Record<string, unknown>;
    if (req.url === "/api/interno/nativas") pedidos.push(c);
    const negar = typeof c.comando === "string" && c.comando.includes("NEGAR");
    res.writeHead(negar ? 403 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify(negar ? { codigo: "nao_permitido", mensagem: "negado pela sonda" } : { ok: true }));
  });
});
await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
const porta = (servidor.address() as { port: number }).port;
const urlNod = `http://127.0.0.1:${porta}`;

const instancia = await criarCodexCliDriver({
  urlNod, proxyPath: mcpFalso, hookPath: fileURLToPath(new URL("../src/adapters/executor/hook-nativas.ts", import.meta.url)),
  nodePath: process.execPath, filaDoForno: false,
}).create({ bins: { "codex-cli": codex }, env: { ...(process.env as Record<string, string>), HOME: home, CODEX_HOME: codexHome }, cwdBase: join(dir, "turnos") });

const plano = (texto: string, entrada: Partial<PlanoTurno["entrada"]> = {}): PlanoTurno => ({
  tenantId: "t", turnoId: "sonda", conversaId: "c", agenteId: "a", localidade: "local", machineId: "m", executor: "local", superficie: "maquina_da_pessoa",
  decididoPor: "regra:sonda", autoria: { autor_tipo: "agente", autor_id: "a", sob_procuracao_de: null, conta_de_execucao: "p", executor: "local", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: "m", decidido_por: "regra:sonda", regra_versao: 1 },
  confiancaEntrada: "confiavel", profundidade: 0,
  catalogo: { ferramentas: [{ nome: "lembrar", nomeMcp: "mcp__nod__lembrar", origem: "nod", conectorId: null, readOnlyHint: false, tocaDadoPessoal: false, schema: { type: "object" } }], servidores: [] },
  promptSistema: "Você é uma sonda de teste do nod. Faça exatamente o que a pessoa pedir, sem nada além. Responda em português.",
  entrada: { texto, sessaoCli: null, modelo, esforco: "low", ...entrada },
  semprePermitir: [], politicaExecucao: { prazoMs: 60_000, orcamentoResultadoChars: 8000 }, tokenDeTurno: "tok-sonda", expiraEm: Date.now() + 3_600_000,
  nativas: [...NATIVAS_DO_TERMINAL_CODEX], pastaDoBot: "Sonda", modoTurno: "conversa",
});
const sinks = { sinal: async () => {}, delta: () => {}, evento: () => {} };

let ok = true;
const conferir = (nome: string, passou: boolean, detalhe = "") => {
  ok &&= passou;
  escrever(`${passou ? "ok  " : "FALHOU"} ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
};

try {
  escrever(`data: ${new Date().toISOString()} · codex: ${codex} · modelo: ${modelo} · HOME do bot: ${home}`);
  const inventario = await instancia.sondar();
  escrever(`inventário: ${JSON.stringify(inventario)}`);
  if (inventario.estado !== "pronto") throw new Error("codex_indisponivel");
  const t1 = await instancia.adapter(plano("Faça, nesta ordem, cada passo numa chamada separada: (1) rode no terminal `git --version`; (2) rode no terminal `echo NEGAR-2`; (3) crie com apply_patch o arquivo nota.txt com o texto oi; (4) busque na web \"OpenAI Codex hooks\". No fim, diga em uma linha por passo se rodou e o que saiu, ou a mensagem exata de por que não rodou.")).rodarTurno(sinks);
  escrever(`turno 1: ${t1.desfecho} · sessão ${t1.sessaoCli} · ferramentas ${JSON.stringify(t1.ferramentasChamadas)}`);
  escrever(`fala: ${t1.texto.replace(/\n/g, " ⏎ ").slice(0, 600)}`);
  escrever(`pedidos ao servidor: ${JSON.stringify(pedidos.map((p) => ({ ferramenta: p.ferramenta, comando: p.comando, arquivo: p.arquivo, contamina: p.contamina })))}`);
  conferir("o hook decidiu o git --version", pedidos.some((p) => p.ferramenta === "Bash" && String(p.comando).includes("git --version")));
  conferir("o echo NEGAR foi barrado com o motivo", (t1.negacoesDoNod ?? []).some((n) => n.nome === "Bash" && n.motivo.includes("negado pela sonda")), JSON.stringify(t1.negacoesDoNod ?? []));
  conferir("o apply_patch passou pelo hook e criou o arquivo", pedidos.some((p) => p.ferramenta === "apply_patch") && existsSync(join(home, "nod", "Sonda", "nota.txt")));
  conferir("o arquivo dentro da pasta do bot não pediu o modo (sem `arquivo`)", pedidos.some((p) => p.ferramenta === "apply_patch" && p.arquivo === undefined));
  conferir("a busca na web avisou o servidor", pedidos.some((p) => p.ferramenta === "web_search" && p.contamina === true));
  const t2 = await instancia.adapter(plano("Qual foi o primeiro comando de terminal que você rodou na mensagem anterior? Responda só o comando.", { sessaoCli: t1.sessaoCli })).rodarTurno(sinks);
  escrever(`turno 2: ${t2.desfecho} · sessão ${t2.sessaoCli} · fala: ${t2.texto.slice(0, 200)}`);
  conferir("thread/resume: lembrou do turno anterior", t2.sessaoCli === t1.sessaoCli && t2.texto.includes("git --version"));
  const t3 = await instancia.adapter(plano("Repita, em uma linha, o comando da sua resposta anterior.", { sessaoCli: t1.sessaoCli, bifurcar: true })).rodarTurno(sinks);
  escrever(`turno 3: ${t3.desfecho} · sessão ${t3.sessaoCli} · fala: ${t3.texto.slice(0, 200)}`);
  conferir("thread/fork: outra thread, com a memória da original", t3.sessaoCli !== null && t3.sessaoCli !== t1.sessaoCli && t3.texto.includes("git --version"));
  const depois = existsSync(configToml) ? readFileSync(configToml, "utf8") : "";
  conferir("a pasta do bot não ficou em [projects] da config", !depois.includes(join(home, "nod")) && !depois.includes("/nod/Sonda"));
} catch (e) {
  ok = false;
  escrever(`erro: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  if (existsSync(guardado)) copyFileSync(guardado, configToml);
  servidor.close();
  escrever(`config.toml da conta devolvido ao de antes · veredito: ${ok ? "aprovada" : "reprovada"}`);
  const saida = arg("--saida");
  if (saida) writeFileSync(saida, `${linhas.join("\n")}\n`);
}
process.exit(ok ? 0 : 1);
