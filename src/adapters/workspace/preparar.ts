import { spawn } from "node:child_process";
import { copyFile, lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { PedidoWorkspace, WorkspacePreparado } from "../../contracts/workspace.ts";
import { ErroDeDominio } from "../../domain/erro.ts";

/** definido em 2026-09-18: não herdar redirecionamentos de repositório nem executar hooks/fsmonitor. */
async function git(cwd: string, args: string[], entrada?: string): Promise<string> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  return new Promise((ok, falha) => {
    const p = spawn("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], {
      cwd, env: { ...env, GIT_TERMINAL_PROMPT: "0" }, stdio: ["pipe", "pipe", "pipe"],
    });
    let saida = "";
    let excedeu = false;
    const timer = setTimeout(() => { excedeu = true; p.kill("SIGKILL"); }, 30_000);
    p.stdout.on("data", (b: Buffer) => {
      if (excedeu) return;
      saida += b.toString();
      if (saida.length > 8_000_000) { excedeu = true; p.kill("SIGKILL"); }
    });
    p.stderr.resume();
    p.stdin.on("error", () => undefined);
    p.on("error", () => { clearTimeout(timer); falha(new ErroDeDominio("estado_invalido")); });
    p.on("close", code => {
      clearTimeout(timer);
      if (code === 0 && !excedeu) ok(saida);
      else falha(new ErroDeDominio("estado_invalido"));
    });
    p.stdin.end(entrada ?? "");
  });
}

async function pasta(caminho: string): Promise<string> {
  if (!isAbsolute(caminho) || caminho.includes("\0")) throw new ErroDeDominio("entrada_invalida");
  const canonico = await realpath(caminho);
  if (!(await stat(canonico)).isDirectory() || canonico === dirname(canonico) || canonico === await realpath(homedir())) {
    throw new ErroDeDominio("nao_permitido");
  }
  return canonico;
}

async function metadados(caminho: string): Promise<WorkspacePreparado["git"]> {
  // definido em 2026-09-18: uma pasta sem Git continua sendo um workspace válido.
  const raiz = await git(caminho, ["rev-parse", "--show-toplevel"]).then(s => s.trim(), () => null);
  if (!raiz) return null;
  const diretorioComum = (await git(caminho, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim();
  const commitInicial = await git(caminho, ["rev-parse", "--verify", "HEAD"]).then(s => s.trim(), () => null);
  const branch = await git(caminho, ["symbolic-ref", "--quiet", "--short", "HEAD"]).then(s => s.trim(), () => null);
  return { raiz: await realpath(raiz), diretorioComum: await realpath(diretorioComum), commitInicial, branch };
}

async function copiarNovos(origem: string, destino: string): Promise<void> {
  const nomes = (await git(origem, ["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
  for (const nome of nomes) {
    const fonte = resolve(origem, nome);
    const relativo = relative(origem, fonte);
    if (!relativo || relativo.startsWith(`..${sep}`) || isAbsolute(relativo)) throw new ErroDeDominio("nao_permitido");
    // definido em 2026-09-18: copiar somente arquivos regulares, sem seguir links para fora da concessão.
    if (!(await lstat(fonte)).isFile() || await realpath(fonte) !== fonte) throw new ErroDeDominio("nao_permitido");
    const alvo = join(destino, relativo);
    await mkdir(dirname(alvo), { recursive: true });
    await copyFile(fonte, alvo);
  }
}

/**
 * definido em 2026-09-18: este adapter prepara um recurso; não concede acesso nem executa tarefas.
 * A autorização por pessoa/agente/máquina pertence ao chamador. A raiz é privada do Nod.
 * Manifesto por id preserva o workspace nas continuações; falhas não apagam trabalho recuperável.
 */
export function criarPreparadorWorkspace(raizWorkspaces: string) {
  return async function preparar(pedido: PedidoWorkspace): Promise<WorkspacePreparado> {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(pedido.id) ||
      !["auto", "direto", "worktree"].includes(pedido.modo) || !isAbsolute(raizWorkspaces) ||
      (pedido.referencia !== undefined && (!pedido.referencia.trim() || /[\0\r\n]/.test(pedido.referencia)))) {
      throw new ErroDeDominio("entrada_invalida");
    }
    const origem = await pasta(pedido.pastaAutorizada);
    const origemGit = await metadados(origem);
    let modo = pedido.modo === "auto" ? (origemGit?.raiz === origem && origemGit.commitInicial ? "worktree" : "direto") : pedido.modo;
    // Uma pasta concedida dentro de um repo não autoriza copiar arquivos acima dela.
    if (modo === "worktree" && origemGit?.raiz !== origem) throw new ErroDeDominio("nao_permitido");
    if (modo === "direto" && pedido.referencia !== undefined) throw new ErroDeDominio("entrada_invalida");

    await mkdir(raizWorkspaces, { recursive: true, mode: 0o700 });
    const raiz = await realpath(raizWorkspaces);
    const dentroDaOrigem = relative(origem, raiz);
    if (dentroDaOrigem === "" || (!dentroDaOrigem.startsWith(`..${sep}`) && dentroDaOrigem !== ".." && !isAbsolute(dentroDaOrigem))) {
      throw new ErroDeDominio("nao_permitido");
    }
    const registro = join(raiz, pedido.id);
    const manifesto = join(registro, "workspace.json");
    const existente = await readFile(manifesto, "utf8").catch((e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return null;
      throw e;
    });
    if (existente) {
      const salvo = JSON.parse(existente) as { pedido: PedidoWorkspace; workspace: WorkspacePreparado };
      const w = salvo.workspace;
      // definido em 2026-09-18: auto decide uma única vez, inclusive quando uma pasta passa a ter Git depois.
      if (pedido.modo === "auto" && (w.modo === "direto" || w.modo === "worktree")) modo = w.modo;
      if (w.id !== pedido.id || w.origem !== origem || w.modo !== modo || salvo.pedido.referencia !== pedido.referencia) {
        throw new ErroDeDominio("estado_invalido");
      }
      if (w.caminho !== (modo === "direto" ? origem : join(registro, "arquivos"))) throw new ErroDeDominio("estado_invalido");
      if (await pasta(w.caminho) !== w.caminho) throw new ErroDeDominio("estado_invalido");
      if (modo === "worktree") {
        const atual = await metadados(w.caminho);
        if (!atual || atual.raiz !== w.caminho || atual.diretorioComum !== w.git?.diretorioComum) throw new ErroDeDominio("estado_invalido");
      }
      return w;
    }
    // definido em 2026-09-18: referências inválidas falham antes de reservar o id.
    const commit = modo === "worktree" ? (await git(origem, ["rev-parse", "--verify", "--end-of-options", `${pedido.referencia ?? "HEAD"}^{commit}`])).trim() : null;
    // definido em 2026-09-18: mkdir exclusivo arbitra pedidos simultâneos; falhas parciais preservam arquivos para recuperação.
    await mkdir(registro, { mode: 0o700 });
    let workspace: WorkspacePreparado = { id: pedido.id, origem, modo, caminho: origem, git: origemGit };
    if (modo === "worktree" && origemGit && commit) {
      const caminho = resolve(registro, "arquivos");
      const branch = `codex/nod-${pedido.id}`;
      await git(origem, ["worktree", "add", "-b", branch, caminho, commit]);
      if (pedido.referencia === undefined) {
        // definido em 2026-09-18: preservar alterações e novos arquivos; ignorados não são transferidos.
        const patch = await git(origem, ["diff", "--binary", "--no-ext-diff", "--no-textconv", "HEAD", "--"]);
        if (patch) await git(caminho, ["apply", "--binary", "-"], patch);
        await copiarNovos(origem, caminho);
      }
      workspace = { id: pedido.id, origem, modo, caminho: await realpath(caminho), git: { ...origemGit, raiz: await realpath(caminho), commitInicial: commit, branch } };
    }
    await writeFile(manifesto, JSON.stringify({ pedido: { ...pedido, pastaAutorizada: origem }, workspace }), { flag: "wx", mode: 0o600 });
    return workspace;
  };
}
