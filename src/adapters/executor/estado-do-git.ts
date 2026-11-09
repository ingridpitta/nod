import { basename } from "node:path";
import { cortarEmLinha, ESTADO_DO_GIT_MAX, TITULO_DO_GIT } from "../../domain/passagem-de-bastao.ts";
import type { ExecutarComando } from "./limpeza-das-tasks.ts";
import { worktreesNaPasta } from "./limpeza-das-tasks.ts";

/** NOD-310: cada comando do git/gh da passagem tem 5 s (a máquina dividida pode estar cheia). */
export const PRAZO_GIT_MS = 5_000;
const WORKTREES_MAX = 3;
const STAT_LINHAS_MAX = 40;

export const GIT_INDISPONIVEL = "estado do git indisponível nesta máquina. Localize o branch da task pelo nome (git branch -a, gh pr list) antes de agir.";

type Opcoes = { worktrees?: (pasta: string) => Promise<string[]>; teto?: number };

/**
 * definido em 2026-10-20 (NOD-310, emenda da ADR-108 §5): o "Estado do branch" da passagem de bastão, lido na pasta da
 * task NESTA máquina: por worktree, o branch, o SHA, os commits desde a base, o `diff --stat`, o que está por commitar e
 * o PR do branch (se o gh existir). O efeito feito pelo terminal (`gh pr create`) não passa pela trilha do servidor: é
 * este `gh pr list` que impede a IA nova de abrir o PR de novo. Nunca lança: em erro, diz que está indisponível.
 */
export async function estadoDoGit(pasta: string, executar: ExecutarComando, o: Opcoes = {}): Promise<string> {
  const teto = o.teto ?? ESTADO_DO_GIT_MAX;
  const fim = (corpo: string) => cortarEmLinha(`${TITULO_DO_GIT}\n${corpo}`, teto);
  let worktrees: string[];
  try {
    worktrees = (await (o.worktrees ?? worktreesNaPasta)(pasta)).slice(0, WORKTREES_MAX);
  } catch {
    return fim(GIT_INDISPONIVEL);
  }
  if (worktrees.length === 0) return fim(`nenhuma worktree na pasta desta task; ${GIT_INDISPONIVEL}`);
  const blocos: Bloco[] = [];
  for (const wt of worktrees) blocos.push(await daWorktree(wt, executar));
  return encaixar(blocos, teto);
}

/** O essencial (branch, SHA, PR, o que está por commitar) e o detalhe (commits, `diff --stat`) de uma worktree. */
type Bloco = { essencial: string[]; detalhe: string[] };

/**
 * Achado 1 do QA do PR #432: o essencial de TODAS as worktrees entra antes de qualquer detalhe — a linha "PR #N já existe
 * — não abra outro" nunca pode ser cortada pelo teto por causa de um `diff --stat` grande. O detalhe entra na ordem, até
 * caber; o que não cabe inteiro é cortado em linha e o resto sai.
 */
function encaixar(blocos: readonly Bloco[], teto: number): string {
  const escolhidos: string[][] = blocos.map(() => []);
  const render = () => `${TITULO_DO_GIT}\n${blocos.map((b, i) => [...b.essencial, ...escolhidos[i]!].join("\n")).join("\n\n")}`;
  let cheio = render().length >= teto;
  for (let i = 0; i < blocos.length && !cheio; i++) {
    for (const d of blocos[i]!.detalhe) {
      escolhidos[i]!.push(d);
      const tamanho = render().length;
      if (tamanho <= teto) continue;
      escolhidos[i]!.pop();
      const sobra = teto - render().length - 1;
      if (sobra > 80) escolhidos[i]!.push(cortarEmLinha(d, sobra));
      cheio = true;
      break;
    }
  }
  return cortarEmLinha(render(), teto);
}

async function daWorktree(wt: string, executar: ExecutarComando): Promise<Bloco> {
  const git = (...args: string[]) => executar("git", args, { cwd: wt, prazoMs: PRAZO_GIT_MS, fundo: true });
  const sha = await git("rev-parse", "HEAD");
  if (sha.codigo !== 0) return { essencial: [`- ${basename(wt)}: ${GIT_INDISPONIVEL}`], detalhe: [] };
  const ref = await git("symbolic-ref", "--short", "HEAD");
  const branch = ref.codigo === 0 ? ref.stdout.trim() : null;
  const essencial = [`- ${basename(wt)}: branch ${branch ?? "(HEAD solto)"}, último SHA ${sha.stdout.trim()}`];
  const detalhe: string[] = [];

  if (branch) {
    const pr = await executar("gh", ["pr", "list", "--head", branch, "--state", "all", "--json", "number,url,state"], { cwd: wt, prazoMs: PRAZO_GIT_MS, fundo: true });
    if (pr.codigo === 0) {
      const prs = lerPrs(pr.stdout);
      if (prs === null) essencial.push("  PR: não deu para ler a lista do gh.");
      else if (prs.length === 0) essencial.push("  Nenhum PR deste branch ainda.");
      else for (const p of prs) essencial.push(`  PR #${p.number} já existe (${p.state}) — não abra outro: ${p.url}`);
    }
    // Sem o gh (-1) ou sem login, nenhuma linha de PR: a IA nova confere pelo nome do branch.
  }
  const status = await git("status", "--porcelain");
  if (status.codigo === 0) {
    const n = status.stdout.split("\n").filter((l) => l.trim()).length;
    essencial.push(n ? `  ${n} ${n === 1 ? "arquivo" : "arquivos"} por commitar.` : "  Nada por commitar.");
  }

  // A base: origin/main; sem ela, o merge-base com origin/HEAD; sem nenhum, só os últimos 5 commits.
  const temMain = (await git("rev-parse", "--verify", "-q", "origin/main")).codigo === 0;
  const mb = temMain ? null : await git("merge-base", "HEAD", "origin/HEAD");
  const base = temMain ? "origin/main" : mb && mb.codigo === 0 ? mb.stdout.trim() : null;
  if (base) {
    const log = await git("log", "--oneline", "-n", "10", `${base}..HEAD`);
    if (log.codigo === 0) detalhe.push(log.stdout.trim() ? `  Commits desde ${temMain ? "origin/main" : "a base"}:\n${indentar(log.stdout)}` : `  Nenhum commit desde ${temMain ? "origin/main" : "a base"}.`);
    const stat = await git("diff", "--stat", `${base}...HEAD`);
    if (stat.codigo === 0 && stat.stdout.trim()) {
      const todas = stat.stdout.trimEnd().split("\n");
      const cortadas = todas.length > STAT_LINHAS_MAX ? [...todas.slice(0, STAT_LINHAS_MAX), `(…mais ${todas.length - STAT_LINHAS_MAX} linhas)`] : todas;
      detalhe.push(`  Arquivos mexidos:\n${indentar(cortadas.join("\n"))}`);
    }
  } else {
    const log = await git("log", "--oneline", "-n", "5");
    if (log.codigo === 0 && log.stdout.trim()) detalhe.push(`  Últimos commits:\n${indentar(log.stdout)}`);
  }
  return { essencial, detalhe };
}

const indentar = (t: string) => t.trimEnd().split("\n").map((l) => `    ${l}`).join("\n");

function lerPrs(stdout: string): { number: number; url: string; state: string }[] | null {
  try {
    const v: unknown = JSON.parse(stdout || "[]");
    if (!Array.isArray(v)) return null;
    return v.flatMap((p) => (p && typeof p === "object" && typeof (p as { number?: unknown }).number === "number" ? [{ number: (p as { number: number }).number, url: String((p as { url?: unknown }).url ?? ""), state: String((p as { state?: unknown }).state ?? "") }] : []));
  } catch {
    return null;
  }
}
