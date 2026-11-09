import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { getPriority, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { abrirGrupoDoTurno, definirGruposDaMaquina, fecharGrupoDoTurno, prepararGruposDaMaquina } from "../../../src/adapters/executor/grupos-da-maquina.ts";
import { iniciarProcesso } from "../../../src/adapters/executor/processo.ts";
import { criarVaga } from "../../../src/adapters/executor/vaga.ts";
import { GENTILEZA_DO_PESADO, PESO_DO_MOTOR } from "../../../src/domain/grupos-da-maquina.ts";

/**
 * Os grupos de controle das tasks (ADR-097, fase 2). O /sys/fs/cgroup só existe no Linux: aqui a árvore é uma pasta
 * temporária com os mesmos arquivos (o cgroupfs de verdade aceita `rmdir` com os arquivos dentro; a pasta não).
 */
const pastas: string[] = [];
afterEach(async () => {
  definirGruposDaMaquina(null);
  for (const p of pastas.splice(0)) await rm(p, { recursive: true, force: true });
});

async function arvore(o: { controladores?: string; gravavel?: boolean } = {}) {
  const base = await mkdtemp(join(tmpdir(), "nod-cgroup-"));
  pastas.push(base);
  const raiz = join(base, "sys", "system.slice", "nod-motor.service");
  await mkdir(join(raiz, "turno-velho"), { recursive: true });
  await writeFile(join(raiz, "cgroup.controllers"), o.controladores ?? "cpuset cpu io memory pids\n");
  await writeFile(join(raiz, "cgroup.subtree_control"), "");
  await writeFile(join(raiz, "cgroup.procs"), "4321\n");
  if (o.gravavel === false) await chmod(join(raiz, "cgroup.subtree_control"), 0o444);
  await writeFile(join(base, "cgroup"), "0::/system.slice/nod-motor.service\n");
  await writeFile(join(base, "meminfo"), "MemTotal:       33554432 kB\n");
  return { base, raiz, opcoes: { sysfs: join(base, "sys"), procSelfCgroup: join(base, "cgroup"), meminfo: join(base, "meminfo"), pid: 999, plataforma: "linux" } };
}

describe("grupos da máquina no boot do motor (ADR-097, fase 2)", () => {
  it("com a delegação: o motor vai para motor/ com peso maior, a raiz liga cpu e memory e o grupo velho sai", async () => {
    const a = await arvore();
    const g = await prepararGruposDaMaquina(a.opcoes);
    expect(g).toEqual({ raiz: a.raiz, memoriaMax: 32 * 1024 ** 3 - 1.5 * 1024 ** 3 });
    expect(await readFile(join(a.raiz, "cgroup.subtree_control"), "utf8")).toBe("+cpu +memory");
    // A pasta falsa guarda só a última escrita; no cgroupfs cada escrita move um pid (aqui, o 4321 e o próprio motor).
    expect(["4321", "999"]).toContain(await readFile(join(a.raiz, "motor", "cgroup.procs"), "utf8"));
    expect(await readFile(join(a.raiz, "motor", "cpu.weight"), "utf8")).toBe(String(PESO_DO_MOTOR));
    expect((await readdir(a.raiz)).includes("turno-velho")).toBe(false);
  });

  it("sem a delegação, sem os controladores, sem cgroup v2 ou fora do Linux, não liga", async () => {
    expect(await prepararGruposDaMaquina({ ...(await arvore({ gravavel: false })).opcoes })).toBeNull();
    expect(await prepararGruposDaMaquina({ ...(await arvore({ controladores: "pids\n" })).opcoes })).toBeNull();
    const v1 = await arvore();
    await writeFile(join(v1.base, "cgroup"), "4:memory:/system.slice/nod-motor.service\n");
    expect(await prepararGruposDaMaquina(v1.opcoes)).toBeNull();
    expect(await prepararGruposDaMaquina({ ...(await arvore()).opcoes, plataforma: "darwin" })).toBeNull();
  });

  it("o grupo do turno nasce com o teto e o peso; fecha quando esvazia; desligado, não abre", async () => {
    expect(abrirGrupoDoTurno()).toBeNull();
    const a = await arvore();
    await prepararGruposDaMaquina(a.opcoes);
    const dir = abrirGrupoDoTurno()!;
    expect(dir.startsWith(join(a.raiz, "turno-"))).toBe(true);
    expect(await readFile(join(dir, "memory.max"), "utf8")).toBe(String(32 * 1024 ** 3 - 1.5 * 1024 ** 3));
    expect(await readFile(join(dir, "cpu.weight"), "utf8")).toBe("100");
    expect(await readFile(join(dir, "memory.swap.max"), "utf8")).toBe(String(2 * 1024 ** 3));
    await rm(join(dir, "memory.swap.max"));
    // Na pasta falsa os arquivos ficam (ENOTEMPTY, como um grupo com processo): desiste depois das tentativas.
    expect(await fecharGrupoDoTurno(dir, { tentativas: 2, esperaMs: 10 })).toBe(false);
    await rm(join(dir, "memory.max"));
    await rm(join(dir, "cpu.weight"));
    expect(await fecharGrupoDoTurno(dir, { tentativas: 2, esperaMs: 10 })).toBe(true);
    expect(await fecharGrupoDoTurno(dir)).toBe(true);
  });

  it("o turno de verdade nasce no grupo: o pid do programa vai para cgroup.procs, e a saída é a do programa", async () => {
    const a = await arvore();
    await prepararGruposDaMaquina(a.opcoes);
    const linhas: string[] = [];
    const p = iniciarProcesso({ bin: process.execPath, args: ["-e", "console.log('pid=' + process.pid)"], env: { PATH: process.env.PATH ?? "" }, cwd: a.base, aoLinha: (l) => linhas.push(l) });
    const fim = await p.fim;
    expect(fim.exitCode).toBe(0);
    const grupo = (await readdir(a.raiz)).find((n) => n.startsWith("turno-"))!;
    expect(linhas).toEqual([`pid=${p.pid}`]);
    expect((await readFile(join(a.raiz, grupo, "cgroup.procs"), "utf8")).trim()).toBe(String(p.pid));
  });

  it("a sonda (executarColetando) e quem pede repartir: false não abrem grupo", async () => {
    const a = await arvore();
    await prepararGruposDaMaquina(a.opcoes);
    const p = iniciarProcesso({ bin: process.execPath, args: ["-e", "0"], env: {}, cwd: a.base, aoLinha: () => {}, repartir: false });
    await p.fim;
    expect((await readdir(a.raiz)).filter((n) => n.startsWith("turno-"))).toEqual([]);
  });
});

describe("o comando pesado roda mais gentil (ADR-097, fase 2)", () => {
  it("ao pegar a vez, o shell do comando ganha nice 10 (Linux e Mac)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nod-vaga-nice-"));
    pastas.push(dir);
    const shell = spawn("sleep", ["10"], { stdio: "ignore" });
    try {
      const v = criarVaga({ dir, livreMb: async () => 9999, vivo: () => true, soltarVigia: () => null, avisar: () => {} });
      await v.pegar("g\nnpm test", shell.pid!);
      expect(getPriority(shell.pid!)).toBe(GENTILEZA_DO_PESADO);
    } finally {
      shell.kill("SIGKILL");
    }
  });
});
