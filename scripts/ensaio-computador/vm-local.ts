/**
 * NOD-93 (passo 11, ADR-127): o ensaio de ponta a ponta da VM local no Mac. Manual, no Mac arm64 (e Intel, se houver),
 * com o app aberto com `NOD_VM_LOCAL=1` e o servidor no ar. Não roda em CI nem fora do macOS.
 *
 * Roteiro:
 *  1. Liga pela API (`POST /computador` acordar) e abre um site por `/agentes/:id/computador/acoes` (navegar + observar).
 *  2. A tela chegou; o Chromium está vivo na VM (`limactl shell nod pgrep -f chrome`) e não há Chromium do nod no Mac.
 *  3. Com o Docker Desktop ligado: `docker context show` e `~/.docker` iguais antes e depois.
 *  4. Com `--sono`: 15 min sem ação → VM parada; a ação seguinte religa em ≤ 60 s.
 *  5. Com `--app <caminho.app>`: `codesign --verify --deep --strict` e `spctl -a -vv` no release.
 * Depois de `pmset sleepnow`, rode de novo com `--sono` (o resume acorda a VM sob demanda).
 *
 * Uso: node scripts/ensaio-computador/vm-local.ts [--api http://127.0.0.1:8889] [--agente <id>] [--sono] [--app /Applications/nod.app]
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Api } from "./rodar.ts";

export const SONO_MS = 15 * 60_000;
export const RELIGAR_MAX_MS = 60_000;
const SITE = "https://example.com/";

/** Recusa fora do Mac, em CI ou sem `NOD_VM_LOCAL=1` (a VM local fica desligada por padrão). Null = pode rodar. */
export function recusaVmLocal(o: { plataforma: string; ambiente: Record<string, string | undefined> }): string | null {
  const ci = o.ambiente.CI;
  if (ci && ci !== "false" && ci !== "0") return "Recusado: o ensaio da VM local não roda em CI. Rode no Mac.";
  if (o.plataforma !== "darwin") return `Recusado: o ensaio da VM local roda só no Mac (plataforma ${o.plataforma}).`;
  if (o.ambiente.NOD_VM_LOCAL !== "1") return "Recusado: ligue NOD_VM_LOCAL=1 (no app e aqui) para ensaiar a VM local.";
  return null;
}

export type OpcoesVmLocal = { api: string; agente: string | null; sono: boolean; app: string | null };

export function lerOpcoesVmLocal(argv: string[]): OpcoesVmLocal {
  const com = new Set(["--api", "--agente", "--app"]);
  const sem = new Set(["--sono"]);
  const o: OpcoesVmLocal = { api: process.env.NOD_ENSAIO_API ?? "http://127.0.0.1:8889", agente: null, sono: false, app: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (sem.has(a)) { o.sono = true; continue; }
    if (!com.has(a)) throw new Error(`opção inválida: ${a} (use ${[...com, ...sem].join(" ")})`);
    const v = argv[++i];
    if (v === undefined || v.startsWith("--")) throw new Error(`${a} sem valor`);
    if (a === "--api") o.api = v; else if (a === "--agente") o.agente = v; else o.app = v;
  }
  return o;
}

/** A impressão do `~/.docker` (caminho, tamanho e conteúdo de cada arquivo); o nod não pode mexer nele. */
export function impressaoDaPasta(raiz: string): string {
  if (!existsSync(raiz)) return "ausente";
  const h = createHash("sha256");
  const andar = (p: string) => {
    for (const nome of readdirSync(p).sort()) {
      const c = join(p, nome);
      const s = statSync(c, { throwIfNoEntry: false });
      if (!s) continue;
      if (s.isDirectory()) { h.update(`d:${c}\n`); andar(c); } else if (s.isFile()) h.update(`f:${c}:${s.size}:`).update(readFileSync(c));
    }
  };
  andar(raiz);
  return h.digest("hex");
}

const sh = (cmd: string, args: string[]) => { try { return { ok: true, saida: execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() }; } catch (e) { return { ok: false, saida: String((e as { stderr?: string }).stderr ?? e).trim() }; } };
const log = (s: string) => process.stderr.write(`${s}\n`);
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

function docker(): { contexto: string; pasta: string } {
  return { contexto: sh("docker", ["context", "show"]).saida, pasta: impressaoDaPasta(join(homedir(), ".docker")) };
}

async function main(): Promise<void> {
  const recusa = recusaVmLocal({ plataforma: process.platform, ambiente: process.env });
  if (recusa) { log(recusa); process.exitCode = 2; return; }
  const o = lerOpcoesVmLocal(process.argv.slice(2));
  const falhas: string[] = [];
  const conferir = (ok: boolean, o_que: string) => { log(`${ok ? "✓" : "✗"} ${o_que}`); if (!ok) falhas.push(o_que); };

  const dockerAntes = docker();
  const api = new Api(o.api);
  await api.entrar();
  const agente = o.agente ?? (await api.chamar<{ agente: { id: string } }>("POST", "agentes", { dono: "pessoa" })).agente.id;
  const acao = (a: Record<string, unknown>) => api.chamar<{ tela?: unknown }>("POST", `agentes/${agente}/computador/acoes`, a);

  await api.chamar("POST", "computador", { operacao: "acordar" });
  const pc = await api.chamar<{ estado: string; preparo?: { estado: string } }>("GET", "computador");
  log(`computador: ${pc.estado} · preparo: ${pc.preparo?.estado ?? "—"}`);
  await acao({ tipo: "navegar", url: SITE });
  const tela = await acao({ tipo: "observar", forcar: true });
  conferir(Boolean(tela.tela), "a tela chegou (observar devolveu a tela)");

  conferir(sh("limactl", ["shell", "nod", "pgrep", "-f", "chrome"]).ok, "Chromium vivo na VM (limactl shell nod pgrep -f chrome)");
  const noMac = sh("pgrep", ["-fl", "nod-chromium|nod/.*Chrom"]);
  conferir(!noMac.ok || noMac.saida === "", "nenhum Chromium do nod no Mac");

  if (o.sono) {
    log(`esperando ${SONO_MS / 60_000} min sem ação…`);
    await dormir(SONO_MS + 30_000);
    conferir(sh("limactl", ["list", "nod", "--format", "{{.Status}}"]).saida === "Stopped", "15 min sem ação → VM parada");
    const t0 = Date.now();
    await acao({ tipo: "navegar", url: SITE });
    const ms = Date.now() - t0;
    conferir(ms <= RELIGAR_MAX_MS, `a ação seguinte religou em ${Math.round(ms / 1000)} s (≤ 60 s)`);
  }

  const dockerDepois = docker();
  conferir(dockerAntes.contexto === dockerDepois.contexto, `docker context show igual (${dockerAntes.contexto || "sem docker"})`);
  conferir(dockerAntes.pasta === dockerDepois.pasta, "~/.docker igual antes e depois");

  if (o.app) {
    conferir(sh("codesign", ["--verify", "--deep", "--strict", o.app]).ok, `codesign --verify ${o.app}`);
    conferir(sh("spctl", ["-a", "-vv", o.app]).ok, `spctl -a ${o.app}`);
  }

  log(falhas.length ? `\n${falhas.length} falha(s): ${falhas.join("; ")}` : "\nensaio da VM local OK");
  process.exitCode = falhas.length ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => { log(e instanceof Error ? e.message : String(e)); process.exit(1); });
}
