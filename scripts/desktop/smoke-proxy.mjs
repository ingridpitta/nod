// Smoke do proxy MCP empacotado: roda o binário do app com ELECTRON_RUN_AS_NODE=1 (fuse RunAsNode) e manda um
// initialize. Prazo em NOD_SMOKE_PROXY_PRAZO_MS (padrão 60 s). Na falha imprime o tempo, o sinal, o stdout e o stderr
// parciais e, no macOS, um `sample` do processo travado antes do SIGKILL.
// NOD-133: no ensaio assinado, o job arm64 rodou o app x64 (o electron-builder gerava as duas arquiteturas e o `find`
// pegou release/mac). Pelo Rosetta, o primeiro launch do Electron x64 não respondeu em 10 s. Por isso o binário tem que
// conter a arquitetura deste Mac: a outra falha aqui, na hora, dizendo qual veio.
import { setTimeout, clearTimeout } from "node:timers";
import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";

const [executavel, proxy] = process.argv.slice(2);
if (!executavel || !proxy) throw new Error("Uso: node scripts/desktop/smoke-proxy.mjs <executavel> <proxy>");
const prazoMs = Number(process.env.NOD_SMOKE_PROXY_PRAZO_MS ?? 60_000);
if (!Number.isFinite(prazoMs) || prazoMs <= 0) throw new Error(`NOD_SMOKE_PROXY_PRAZO_MS inválido: ${process.env.NOD_SMOKE_PROXY_PRAZO_MS}`);

const LIPO = { arm64: "arm64", x64: "x86_64" };
if (process.platform === "darwin") {
  const lipo = spawnSync("lipo", ["-archs", resolve(executavel)], { encoding: "utf8" });
  const archs = (lipo.stdout ?? "").trim().split(/\s+/).filter(Boolean);
  if (lipo.status === 0 && !archs.includes(LIPO[process.arch])) {
    throw new Error(`O binário ${executavel} é ${archs.join(" ")}, e este Mac é ${LIPO[process.arch]}: rodaria pelo Rosetta. Use o app da arquitetura deste Mac.`);
  }
}

const inicio = Date.now();
const p = spawn(resolve(executavel), [resolve(proxy)], { env: { PATH: process.env.PATH, HOME: process.env.HOME, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["pipe", "pipe", "pipe"] });
let saida = "", erro = "", estourou = false;
p.stdout.on("data", (v) => { saida += v; });
p.stderr.on("data", (v) => { erro += v; });
const timer = setTimeout(() => {
  estourou = true;
  if (process.platform === "darwin" && p.pid) {
    // 3 s de amostra das pilhas: mostra se travou no dyld, no V8, no loader ESM ou lendo o stdin.
    const s = spawnSync("sample", [String(p.pid), "3"], { encoding: "utf8", timeout: 30_000 });
    process.stderr.write(`--- sample ${p.pid} ---\n${(s.stdout ?? "").slice(0, 20_000)}${s.stderr ?? ""}\n--- fim do sample ---\n`);
  }
  p.kill("SIGKILL");
}, prazoMs);
p.stdin.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "1" } } }) + "\n");
const [codigo, sinal] = await new Promise((r, j) => { p.once("error", j); p.once("exit", (c, s) => r([c, s])); });
clearTimeout(timer);
const gastoMs = Date.now() - inicio;
const detalhe = () => `\n  tempo: ${gastoMs} ms (prazo ${prazoMs} ms)\n  stdout: ${JSON.stringify(saida.slice(0, 2000))}\n  stderr: ${JSON.stringify(erro.slice(0, 2000))}`;
if (estourou) throw new Error(`Proxy empacotado não respondeu nem saiu no prazo (SIGKILL).${detalhe()}`);
if (codigo !== 0) throw new Error(`Proxy empacotado falhou (código ${codigo}, sinal ${sinal}).${detalhe()}`);
const respostas = saida.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
if (respostas.length !== 1 || respostas[0].id !== 1 || !respostas[0].result?.protocolVersion) throw new Error(`Proxy deve responder exatamente uma vez ao initialize.${detalhe()}`);
process.stdout.write(`Proxy MCP empacotado: initialize passou em ${gastoMs} ms, sem Node externo nem CLI real.\n`);
