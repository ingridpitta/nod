import { MODELO_SONDA_PADRAO } from "../src/contracts/modelos.ts";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ambienteDaSonda } from "../src/adapters/executor/sonda.ts";
import { resolverBinario } from "../src/adapters/executor/caminho.ts";
import { iniciarProcesso } from "../src/adapters/executor/processo.ts";
import { settingsDoTerminal } from "../src/adapters/executor/drivers/claude-cli.ts";
import { log } from "../src/obs/log.ts";

/**
 * Sonda do kit do terminal (ADR-052, 4.0; revista pela ADR-055): mede no CLI REAL, em `-p` e com `--settings` por
 * turno, o que o nod precisa para ligar as nativas com ele decidindo. Cada ponto custa UM turno (MODELO_SONDA_PADRAO). Rode a
 * cada versão nova do CLI (flag-floors.ts) e registre o resultado na tabela da ADR-055.
 *
 *   node scripts/sonda-nativas.ts
 *
 *  1. hook PreToolUse em -p via --settings: roda para toda nativa? o deny barra?
 *  2. --restricted: o hook roda? quais nativas sobram no init?
 *  3. Bash sem sandbox (ADR-055): grava fora da pasta e acessa a rede quando o hook permite?
 *  4. hook que ESPERA (a aprovação da pessoa, até TETO_HOOK_S): o CLI aguarda e o comando roda depois?
 *  5. WebFetch e WebSearch com o login da pessoa: funcionam, e o hook é consultado?
 *
 * Medido em 2026-09-28 (CLI 2.1.283, ADR-052): 1 sim, deny barra (e o caminho chega resolvido: /private/var/…);
 * 2 o hook roda; sem --tools, o --restricted tira Bash e WebFetch do init, com --tools explícito eles ficam;
 * 5 sim, e o hook é consultado nas duas. Os pontos 3 e 4 estão na tabela da ADR-055.
 */
try {
  process.loadEnvFile(".env");
} catch {
  // sem .env: variáveis vêm do ambiente
}

const modelo = process.env.NOD_MODELO_SONDA ?? MODELO_SONDA_PADRAO;
const home = process.env.HOME ?? tmpdir();
const ambiente = ambienteDaSonda(process.env, home);
const binario = await resolverBinario(process.env.NOD_CLAUDE_BIN, ambiente.PATH ?? "", home);
if (!binario) {
  log("erro", "sonda_nativas_sem_binario", { bin: process.env.NOD_CLAUDE_BIN ?? null });
  process.exit(1);
}

const raiz = realpathSync(mkdtempSync(join(tmpdir(), "nod-sonda-nativas-")));
const area = join(raiz, "area");
const fora = join(raiz, "fora");
mkdirSync(area);
mkdirSync(fora);
const registro = join(raiz, "hook.log");
const hook = join(raiz, "hook.mjs");
// Hook mínimo: registra a chamada, nega Write fora da área (para medir que o deny barra) e, no comando que cita
// "espera", segura 40 s antes de permitir — a aprovação da pessoa no hook do nod (ADR-055) faz o mesmo.
writeFileSync(hook, `import { appendFileSync, realpathSync } from "node:fs"; import { dirname, basename, join } from "node:path";
const real = (c) => { try { return realpathSync(c); } catch { return join(real(dirname(c)), basename(c)); } };
let s = ""; process.stdin.on("data", (d) => (s += d)); process.stdin.on("end", () => {
  const e = JSON.parse(s); appendFileSync(${JSON.stringify(registro)}, e.tool_name + "\\n");
  const negar = e.tool_name === "Write" && !real(e.tool_input.file_path ?? "").startsWith(${JSON.stringify(`${area}/`)});
  const responder = () => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: negar ? "deny" : "allow", permissionDecisionReason: "sonda" } }));
  if (e.tool_name === "Bash" && String(e.tool_input.command ?? "").includes("espera")) setTimeout(responder, 40_000); else responder();
});`);
const settings = settingsDoTerminal({ comandoHook: `'${process.execPath}' '${hook}'` });

async function ponto(nome: string, prompt: string, ferramentas: string, restrito = false): Promise<void> {
  let init: string[] = [];
  const usos: string[] = [];
  const erros: string[] = [];
  let custo: number | null = null;
  const proc = iniciarProcesso({
    bin: binario ?? "claude",
    args: ["-p", prompt, "--output-format", "stream-json", "--verbose", "--model", modelo, "--max-turns", "5",
      ...(restrito ? ["--restricted"] : ["--setting-sources", "project"]), "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
      "--tools", ferramentas, "--allowedTools", ferramentas, "--permission-mode", "default", "--settings", settings],
    env: ambiente,
    cwd: area,
    stdin: "ignore",
    aoLinha(linha) {
      let o: { type?: string; subtype?: string; tools?: string[]; message?: { content?: { type?: string; name?: string; is_error?: boolean; content?: unknown }[] }; total_cost_usd?: number };
      try { o = JSON.parse(linha) as typeof o; } catch { return; }
      if (o.type === "system" && o.subtype === "init") init = o.tools ?? [];
      for (const c of o.message?.content ?? []) {
        if (c.type === "tool_use" && c.name) usos.push(c.name);
        if (c.type === "tool_result" && c.is_error) erros.push(String(typeof c.content === "string" ? c.content : JSON.stringify(c.content)).slice(0, 120));
      }
      if (o.type === "result") custo = o.total_cost_usd ?? null;
    },
  });
  const relogio = setTimeout(() => void proc.interromper(), 180_000);
  await proc.fim;
  clearTimeout(relogio);
  log("info", "sonda_nativas_ponto", { ponto: nome, init: init.filter((t) => ["Read", "Write", "Bash", "WebFetch", "WebSearch"].includes(t)).join(","), usos: usos.join(","), erros: erros.join(" | "), custo_usd: custo });
}

await ponto("hook_write", `Com Write, crie ${join(area, "a.txt")} e depois ${join(fora, "b.txt")}. Diga o que aconteceu.`, "Write");
await ponto("restricted", `Com Write, crie ${join(area, "c.txt")}.`, "Write,Bash,WebFetch", true);
await ponto("bash_de_verdade", `Com Bash, um por vez: echo x > ${join(area, "d.txt")}; echo x > ${join(fora, "e.txt")}; curl -sS -m 5 -o /dev/null -w '%{http_code}' https://example.com. Diga o código HTTP.`, "Bash");
await ponto("hook_espera", `Com Bash, rode exatamente: echo espera > ${join(fora, "f.txt")}`, "Bash");
await ponto("web", "Com WebFetch, leia https://example.com e diga o título.", "WebFetch,WebSearch");
log("info", "sonda_nativas_fim", {
  hook_consultado: existsSync(registro) ? readFileSync(registro, "utf8").trim().split("\n").join(",") : "",
  dentro: ["a.txt", "c.txt", "d.txt"].map((f) => `${f}=${existsSync(join(area, f))}`).join(" "),
  // ADR-055: b.txt fora (Write negado pelo hook) = false; e.txt e f.txt (Bash sem sandbox, f depois da espera) = true.
  fora: ["b.txt", "e.txt", "f.txt"].map((f) => `${f}=${existsSync(join(fora, f))}`).join(" "),
});
