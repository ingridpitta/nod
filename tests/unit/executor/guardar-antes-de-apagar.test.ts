import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readdir, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guardarEApagar, temProcessoVivo, vencerGuardados, type OpcoesGuardar } from "../../../src/adapters/executor/guardar-antes-de-apagar.ts";
import { criarExecutarComando, limparOrfas, type ExecutarComando } from "../../../src/adapters/executor/limpeza-das-tasks.ts";
import { GUARDADO_VENCE_APERTADO_MS, GUARDADO_VENCE_MS, ORFA_SAI_APERTADO_MS, ORFA_SAI_MS, pedacoDeRef } from "../../../src/domain/guardado.ts";

// Repositórios git de verdade, `tar` e `rm` de verdade (vários processos por teste). medido em 2026-10-11: 0,2–0,9 s por
// teste com load ~40; o padrão de 5 s do projeto unit fica perto demais sob carga maior.
vi.setConfig({ testTimeout: 60_000 });

const ENV_GIT = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: ENV_GIT, stdio: "pipe" }).toString();
const DIA = 24 * 3_600_000;

let home: string;
let raiz: string;
let clone: string;

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), "nod-guardar-")));
  raiz = join(home, "nod");
  clone = join(home, "code", "acme");
  await mkdir(clone, { recursive: true });
  git(clone, "init", "-q", "-b", "main");
  await writeFile(join(clone, ".gitignore"), "node_modules/\n.env\n");
  await writeFile(join(clone, "README.md"), "acme\n");
  git(clone, "add", ".");
  git(clone, "commit", "-q", "-m", "inicio");
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

/** Sem o prefixo de prioridade baixa: o teste é da lógica, não do escalonador da máquina. */
const executarReal = (): ExecutarComando => criarExecutarComando(ENV_GIT, home, []);
const opcoes = (o: Partial<OpcoesGuardar> = {}): OpcoesGuardar => ({ raiz, executar: executarReal(), montagens: [], livre: async () => 100 * 1024 ** 3, agora: () => 1, ...o });

async function worktree(rel: string, branch: string): Promise<string> {
  const destino = join(raiz, rel);
  await mkdir(join(destino, ".."), { recursive: true });
  git(clone, "worktree", "add", destino, "-b", branch);
  return destino;
}

describe("ADR-096 §4: guardar antes de apagar", () => {
  it("um `*.pid` de processo vivo segura a pasta (o Postgres de teste do bot); o de processo morto não", async () => {
    const pasta = join(raiz, "Ze 1", "qa-pg-aaaaaa");
    await mkdir(join(pasta, "pgdata"), { recursive: true });
    await writeFile(join(pasta, "pgdata", "postmaster.pid"), `${process.ppid}\n/tmp\n`);
    expect(await temProcessoVivo(pasta)).toBe(true);
    const r = await guardarEApagar(pasta, "t-1", opcoes());
    expect(r.motivo).toBe("processo_vivo");
    expect(existsSync(join(pasta, "pgdata", "postmaster.pid"))).toBe(true);
    // pid que não existe (o maior possível no Linux e no macOS fica abaixo disto).
    await writeFile(join(pasta, "pgdata", "postmaster.pid"), "4194304999\n");
    expect(await temProcessoVivo(pasta)).toBe(false);
  });

  it("guardado acima do teto: a pasta fica inteira e nenhum arquivo sobra", async () => {
    const pasta = join(raiz, "Ze 1", "grande-bbbbbb");
    await mkdir(pasta, { recursive: true });
    await writeFile(join(pasta, "dados.bin"), "x".repeat(50_000));
    const r = await guardarEApagar(pasta, "t-2", opcoes({ maxBytes: 10 }));
    expect(r.motivo).toBe("grande_demais");
    expect(existsSync(join(pasta, "dados.bin"))).toBe(true);
    expect(await readdir(join(raiz, ".guardado", "Ze 1"))).toEqual([]);
  });

  it("ADR-128: o guardado nunca leva o disco abaixo de 3 GB — sem folga, nem compacta; com pouca, passa a ser `sem_espaco`", async () => {
    const pasta = join(raiz, "Ze 1", "apertada-dddddd");
    await mkdir(pasta, { recursive: true });
    await writeFile(join(pasta, "dados.bin"), "x".repeat(50_000));
    const real = executarReal();
    const tars: string[] = [];
    const executar: ExecutarComando = async (bin, args, o) => { if (bin === "tar") tars.push(args[0]!); return real(bin, args, o); };
    const tresGb = 3 * 1024 ** 3;
    expect((await guardarEApagar(pasta, "t-4", opcoes({ executar, livre: async () => tresGb }))).motivo).toBe("sem_espaco");
    expect(tars).toEqual([]);
    // 10 bytes de folga: o `tar` roda, passa dela e sai; não é a pasta que é grande — fica 6 h (não um dia) sem novo `tar`.
    const grandes: NonNullable<OpcoesGuardar["grandes"]> = new Map();
    expect((await guardarEApagar(pasta, "t-4", opcoes({ executar, livre: async () => tresGb + 10, grandes }))).motivo).toBe("sem_espaco");
    expect(tars).toEqual(["-czf"]);
    expect(grandes.get(pasta)).toEqual({ ate: 1 + 6 * 3_600_000, motivo: "sem_espaco" });
    expect(existsSync(join(pasta, "dados.bin"))).toBe(true);
    expect(await readdir(join(raiz, ".guardado", "Ze 1"))).toEqual([]);
  });

  it("ADR-128: o `tar` é cortado assim que o `.parcial` passa do teto, sem esperar acabar", async () => {
    const pasta = join(raiz, "Ze 1", "enorme-eeeeee");
    await mkdir(pasta, { recursive: true });
    await writeFile(join(pasta, "dados.bin"), "x");
    const real = executarReal();
    let cortado = false;
    // Um `tar` lento que escreve 1 KB a cada 5 ms por até 10 s, até o sinal chegar.
    const executar: ExecutarComando = async (bin, args, o) => {
      if (bin !== "tar" || args[0] !== "-czf") return real(bin, args, o);
      const destino = args[1]!;
      for (let i = 0; i < 2_000; i++) {
        if (o?.sinal?.aborted) { cortado = true; return { codigo: -2, stdout: "", stderr: "" }; }
        await appendFile(destino, "y".repeat(1024));
        await new Promise((r) => setTimeout(r, 5));
      }
      return { codigo: 0, stdout: "", stderr: "" };
    };
    const inicio = Date.now();
    const r = await guardarEApagar(pasta, "t-5", opcoes({ executar, maxBytes: 20 * 1024, vigiaMs: 10 }));
    expect(r.motivo).toBe("grande_demais");
    expect(cortado).toBe(true);
    expect(Date.now() - inicio).toBeLessThan(5_000);
    expect(await readdir(join(raiz, ".guardado", "Ze 1"))).toEqual([]);
  });

  it("ADR-128: a pasta que deu `grande_demais` fica um dia sem novo `tar`", async () => {
    const pasta = join(raiz, "Ze 1", "grande-ffffff");
    await mkdir(pasta, { recursive: true });
    await writeFile(join(pasta, "dados.bin"), "x".repeat(50_000));
    const real = executarReal();
    let tars = 0;
    const executar: ExecutarComando = async (bin, args, o) => { if (bin === "tar" && args[0] === "-czf") tars++; return real(bin, args, o); };
    const grandes: NonNullable<OpcoesGuardar["grandes"]> = new Map();
    let agora = 1_000;
    const o = opcoes({ executar, maxBytes: 10, grandes, agora: () => agora });
    expect((await guardarEApagar(pasta, "t-6", o)).motivo).toBe("grande_demais");
    agora += DIA - 1;
    expect((await guardarEApagar(pasta, "t-6", o)).motivo).toBe("grande_demais");
    expect(tars).toBe(1);
    agora += 1;
    expect((await guardarEApagar(pasta, "t-6", o)).motivo).toBe("grande_demais");
    expect(tars).toBe(2);
  });

  it("revisão do #528: sem leitura do livre (erro ou NaN) não há `tar` — `sem_espaco`", async () => {
    const pasta = join(raiz, "Ze 1", "semlivre-gggggg");
    await mkdir(pasta, { recursive: true });
    await writeFile(join(pasta, "dados.bin"), "x");
    const real = executarReal();
    let tars = 0;
    const executar: ExecutarComando = async (bin, args, o) => { if (bin === "tar") tars++; return real(bin, args, o); };
    expect((await guardarEApagar(pasta, "t-7", opcoes({ executar, livre: async () => Number.NaN }))).motivo).toBe("sem_espaco");
    expect((await guardarEApagar(pasta, "t-7", opcoes({ executar, livre: async () => { throw new Error("statfs"); } }))).motivo).toBe("sem_espaco");
    expect(tars).toBe(0);
    expect(existsSync(join(pasta, "dados.bin"))).toBe(true);
  });

  it("revisão do #528 (achado alto): o teto do `tar` é medido depois dos bundles — se eles comeram a folga, nem compacta", async () => {
    const pasta = join(raiz, "Ze 1", "bundle-hhhhhh");
    await mkdir(pasta, { recursive: true });
    await writeFile(join(pasta, "dados.bin"), "x");
    const real = executarReal();
    let tars = 0;
    const executar: ExecutarComando = async (bin, args, o) => { if (bin === "tar") tars++; return real(bin, args, o); };
    const leituras = [100 * 1024 ** 3, 3 * 1024 ** 3];
    const livre = async () => leituras.shift() ?? 0;
    const grandes: NonNullable<OpcoesGuardar["grandes"]> = new Map();
    expect((await guardarEApagar(pasta, "t-8", opcoes({ executar, livre, grandes }))).motivo).toBe("sem_espaco");
    expect(tars).toBe(0);
    expect(grandes.get(pasta)?.motivo).toBe("sem_espaco");
    expect(existsSync(join(pasta, "dados.bin"))).toBe(true);
  });

  it("revisão do #528 (achado médio): o vigia corta o `tar` quando o disco cai abaixo do piso no meio, e a pasta espera 6 h", async () => {
    const pasta = join(raiz, "Ze 1", "caiu-iiiiii");
    await mkdir(pasta, { recursive: true });
    await writeFile(join(pasta, "dados.bin"), "x");
    const real = executarReal();
    let cortado = false;
    let tarComecou = false;
    const executar: ExecutarComando = async (bin, args, o) => {
      if (bin !== "tar" || args[0] !== "-czf") return real(bin, args, o);
      tarComecou = true;
      for (let i = 0; i < 2_000; i++) {
        if (o?.sinal?.aborted) { cortado = true; return { codigo: -2, stdout: "", stderr: "" }; }
        await appendFile(args[1]!, "y");
        await new Promise((r) => setTimeout(r, 5));
      }
      return { codigo: 0, stdout: "", stderr: "" };
    };
    // Folga de sobra até o `tar` começar; depois, outro bot enche o disco.
    const livre = async () => (tarComecou ? 2 * 1024 ** 3 : 100 * 1024 ** 3);
    const grandes: NonNullable<OpcoesGuardar["grandes"]> = new Map();
    const r = await guardarEApagar(pasta, "t-9", opcoes({ executar, livre, vigiaMs: 10, grandes }));
    expect(r.motivo).toBe("sem_espaco");
    expect(cortado).toBe(true);
    expect(grandes.get(pasta)?.motivo).toBe("sem_espaco");
    expect(existsSync(join(pasta, "dados.bin"))).toBe(true);
    expect(await readdir(join(raiz, ".guardado", "Ze 1"))).toEqual([]);
  });

  it.runIf(process.platform === "linux")("revisão do #528: o sinal mata o programa de verdade, também atrás do prefixo de prioridade baixa", async () => {
    const marca = `${30 + Math.floor(Math.random() * 1000) / 1000}`;
    const corte = new AbortController();
    setTimeout(() => corte.abort(), 100);
    const r = await criarExecutarComando(ENV_GIT, home)("sleep", [marca], { prazoMs: 60_000, fundo: true, sinal: corte.signal });
    expect(r.codigo).toBe(-2);
    await new Promise((res) => setTimeout(res, 200));
    const vivos = (() => { try { return execFileSync("pgrep", ["-f", `sleep ${marca}`]).toString().trim(); } catch { return ""; } })();
    expect(vivos).toBe("");
  });

  it("revisão 2 do #528: a pasta que passou da espera e foi guardada sai do mapa", async () => {
    const pasta = join(raiz, "Ze 1", "voltou-jjjjjj");
    await mkdir(pasta, { recursive: true });
    await writeFile(join(pasta, "dados.bin"), "x");
    const grandes: NonNullable<OpcoesGuardar["grandes"]> = new Map([[pasta, { ate: 0, motivo: "grande_demais" }]]);
    expect((await guardarEApagar(pasta, "t-10", opcoes({ grandes }))).motivo).toBeNull();
    expect(grandes.has(pasta)).toBe(false);
    expect(existsSync(pasta)).toBe(false);
  });

  it("ADR-128: o executor corta o programa pelo sinal (código -2)", async () => {
    const corte = new AbortController();
    setTimeout(() => corte.abort(), 50);
    const inicio = Date.now();
    const r = await executarReal()("sleep", ["30"], { prazoMs: 60_000, sinal: corte.signal });
    expect(r.codigo).toBe(-2);
    expect(Date.now() - inicio).toBeLessThan(5_000);
  });

  it("o `tar` que falha (ou um guardado que não se lê) não apaga nada nem deixa `.parcial`", async () => {
    const wt = await worktree("Ze 1/falha-cccccc/acme", "feat/falha");
    await writeFile(join(wt, "rascunho.txt"), "não commitado\n");
    const real = executarReal();
    const chamadas: string[] = [];
    const falhaNaConferencia: ExecutarComando = async (bin, args, o) => {
      chamadas.push([bin, ...args].join(" "));
      if (bin === "tar" && args[0] === "-tzf") return { codigo: 2, stdout: "", stderr: "corrompido" };
      return real(bin, args, o);
    };
    const r = await guardarEApagar(join(raiz, "Ze 1", "falha-cccccc"), "t-3", opcoes({ executar: falhaNaConferencia }));
    expect(r.motivo).toBe("erro");
    expect(existsSync(join(wt, "rascunho.txt"))).toBe(true);
    expect(await readdir(join(raiz, ".guardado", "Ze 1"))).toEqual([]);
    expect(chamadas.some((c) => c.includes("worktree remove") || c.startsWith("rm "))).toBe(false);
  });

  it("montagem de container dentro da pasta, ou worktree travada, seguram a pasta", async () => {
    const wt = await worktree("Eng 1/montada-dddddd/acme", "feat/montada");
    await mkdir(join(wt, "infra", "init"), { recursive: true });
    expect((await guardarEApagar(join(raiz, "Eng 1", "montada-dddddd"), "t-4", opcoes({ montagens: [join(wt, "infra", "init")] }))).motivo).toBe("montagem");
    git(clone, "worktree", "lock", wt);
    expect((await guardarEApagar(join(raiz, "Eng 1", "montada-dddddd"), "t-4", opcoes())).motivo).toBe("travada");
    expect(existsSync(wt)).toBe(true);
  });

  it("nunca fora de `~/nod/<bot>/<x>`: a raiz, o bot inteiro e a pasta escondida são recusados", async () => {
    await mkdir(join(raiz, "Ze 1", ".escondida"), { recursive: true });
    for (const alvo of [raiz, join(raiz, "Ze 1"), join(raiz, "Ze 1", ".escondida"), join(home, "code")]) {
      expect((await guardarEApagar(alvo, "t", opcoes())).motivo, alvo).toBe("fora_da_pasta");
    }
    expect(existsSync(join(home, "code", "acme", ".git"))).toBe(true);
  });

  it("ADR-119 §8: o clone da máquina (`~/nod/.clones`) nunca é pasta de task", async () => {
    const bare = join(raiz, ".clones", "acme", "app.git");
    await mkdir(bare, { recursive: true });
    git(bare, "init", "-q", "--bare");
    for (const alvo of [join(raiz, ".clones"), join(raiz, ".clones", "acme"), bare]) {
      expect((await guardarEApagar(alvo, "t", opcoes())).motivo, alvo).toBe("fora_da_pasta");
    }
    expect(existsSync(join(bare, "HEAD"))).toBe(true);
  });

  it("o guardado vence em 30 dias, ou em 7 com o disco apertado; o `.parcial` esquecido sai em 1 dia", async () => {
    const pasta = join(raiz, ".guardado", "Ze 1");
    await mkdir(pasta, { recursive: true });
    const agora = Date.now();
    const criar = async (nome: string, idade: number) => {
      await writeFile(join(pasta, nome), "x");
      const t = (agora - idade) / 1000;
      await utimes(join(pasta, nome), t, t);
    };
    await criar("velho.tar.gz", GUARDADO_VENCE_MS + DIA);
    await criar("semana.tar.gz", GUARDADO_VENCE_APERTADO_MS + DIA);
    await criar("novo.tar.gz", DIA);
    await criar("morto.tar.gz.parcial", 2 * DIA);
    await criar("anotacao.txt", GUARDADO_VENCE_MS + DIA);
    expect(await vencerGuardados(raiz, agora, false)).toBe(2);
    expect((await readdir(pasta)).sort()).toEqual(["anotacao.txt", "novo.tar.gz", "semana.tar.gz"]);
    expect(await vencerGuardados(raiz, agora, true)).toBe(1);
    expect((await readdir(pasta)).sort()).toEqual(["anotacao.txt", "novo.tar.gz"]);
  });

  it("o nome da referência é seguro para o git", () => {
    for (const [nome, ref] of [["acme", "acme"], ["acme/.claude/worktrees/agent-1", "acme-.claude-worktrees-agent-1"], ["Zé 1", "Ze-1"], ["..", "x"], ["a.lock", "a-lock"], ["", "x"]] as const) expect(pedacoDeRef(nome), nome).toBe(ref);
    for (const nome of ["acme/.claude/worktrees/agent-1", "Zé 1", "a b c", "a.lock"]) git(clone, "check-ref-format", `refs/nod/guardado/t/${pedacoDeRef(nome)}`);
  });
});

describe("ADR-096 §4: as órfãs da raiz do bot", () => {
  const o = (extra: Partial<Parameters<typeof limparOrfas>[0]> = {}) => ({ home, executar: executarReal(), montagens: async () => [], livre: async () => 100 * 1024 ** 3, ...extra });

  it("parada há 30 dias: a limpa sai pelo git (a branch fica); a suja é guardada antes; a recente fica", async () => {
    const limpa = await worktree("Teodora/qa-194", "qa/194");
    const suja = await worktree("Teodora/qa-195", "qa/195");
    await writeFile(join(suja, "notas.md"), "achados do QA\n");
    const agora = Date.now();
    expect(await limparOrfas(o(), agora + DIA, false)).toMatchObject({ removidas: 0, guardadas: 0 });
    const r = await limparOrfas(o(), agora + ORFA_SAI_MS + DIA, false);
    expect(r).toMatchObject({ removidas: 1, guardadas: 1 });
    expect(existsSync(limpa)).toBe(false);
    expect(existsSync(suja)).toBe(false);
    expect(git(clone, "branch", "--list", "qa/194")).toContain("qa/194");
    expect(execFileSync("tar", ["-xzOf", join(raiz, ".guardado", "Teodora", "qa-195.tar.gz"), "qa-195/notas.md"]).toString()).toBe("achados do QA\n");
    expect(git(clone, "rev-parse", "refs/nod/guardado/orfa/qa-195").trim()).toBe(git(clone, "rev-parse", "qa/195").trim());
  });

  it("com o disco apertado, 7 dias bastam; com um turno daquele bot rodando, nada sai; pasta de task não é órfã", async () => {
    const orfa = await worktree("Dev 1/nod-200", "feat/200");
    await worktree("Dev 1/task-abcdef/nod", "feat/task");
    const agora = Date.now() + ORFA_SAI_APERTADO_MS + DIA;
    expect(await limparOrfas(o({ emUso: (p) => p === "Dev 1" || p.startsWith("Dev 1/") }), agora, true)).toMatchObject({ removidas: 0 });
    expect(existsSync(orfa)).toBe(true);
    expect(await limparOrfas(o(), agora, false)).toMatchObject({ removidas: 0 });
    const r = await limparOrfas(o(), agora, true);
    expect(r).toMatchObject({ removidas: 1, guardadas: 0 });
    expect(existsSync(orfa)).toBe(false);
    expect(existsSync(join(raiz, "Dev 1", "task-abcdef", "nod"))).toBe(true);
  });

  it("Docker instalado e mudo: nenhuma órfã sai", async () => {
    const orfa = await worktree("Dev 1/nod-201", "feat/201");
    const r = await limparOrfas(o({ montagens: async () => null }), Date.now() + ORFA_SAI_MS + DIA, false);
    expect(r).toMatchObject({ removidas: 0, guardadas: 0 });
    expect(existsSync(orfa)).toBe(true);
  });
});
