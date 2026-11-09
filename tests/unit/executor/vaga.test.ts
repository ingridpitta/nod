import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invocarDoHook, pastaDaFila } from "../../../src/adapters/executor/drivers/claude-cli.ts";
import { decidirHook, filaDaMaquina, type Confirmar } from "../../../src/adapters/executor/hook-nativas.ts";
import { criarVaga, TETO_DA_VEZ_MS } from "../../../src/adapters/executor/vaga.ts";
import { chaveDoComando, type Historico } from "../../../src/domain/fila-do-forno.ts";

/**
 * A fila do forno (ADR-097, fase 1b). As decisões puras estão em tests/unit/domain/fila-do-forno.test.ts; aqui, o hook
 * que reescreve, a fila numa pasta de verdade e o comando reescrito rodando num shell de verdade com o script do hook.
 */
const HOOK = fileURLToPath(new URL("../../../src/adapters/executor/hook-nativas.ts", import.meta.url));
const pastas: string[] = [];
async function pasta(): Promise<string> {
  const p = await mkdtemp(join(tmpdir(), "nod-vaga-"));
  pastas.push(p);
  return p;
}
afterEach(async () => {
  for (const p of pastas.splice(0)) await rm(p, { recursive: true, force: true });
});

const permitir: Confirmar = async () => ({ permitir: true });
const evento = (command: string, tool_name = "Bash") => ({ tool_name, tool_input: { command, description: "x" }, cwd: "/home/nod/nod/Ze 1/task/gamefik" });

function bash(comando: string, env: Record<string, string> = {}): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolver) => {
    execFile("bash", ["-c", comando], { env: { ...process.env, ...env }, timeout: 60_000 }, (erro, stdout, stderr) => {
      resolver({ status: erro ? Number((erro as NodeJS.ErrnoException & { code?: number }).code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

async function ate<T>(fn: () => Promise<T | null>, ms = 15_000): Promise<T> {
  const fim = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v !== null) return v;
    if (Date.now() > fim) throw new Error("tempo esgotado");
    await new Promise((r) => setTimeout(r, 200));
  }
}

const lerHistorico = async (dir: string) => JSON.parse(await readFile(join(dir, "historico.json"), "utf8").catch(() => "null")) as Historico | null;

describe("o hook põe o comando pesado na fila (ADR-097)", () => {
  const vaga = { dir: "/home/nod/.nod/vaga", invocar: "'node' '/m/hook-nativas.mjs'" };

  it("o Bash que altera, nunca medido, sai reescrito com a vez em volta; o resto da entrada fica", async () => {
    const r = await decidirHook(evento("npm run check"), permitir, undefined, filaDaMaquina(vaga, () => ({})));
    expect(r.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(r.hookSpecificOutput.updatedInput).toMatchObject({ description: "x" });
    const comando = String(r.hookSpecificOutput.updatedInput?.command);
    expect(comando).toContain("'node' '/m/hook-nativas.mjs' vaga pegar ");
    expect(comando).toContain("{ npm run check\n}");
    expect(comando).toContain("'/home/nod/.nod/vaga'");
  });

  it("o que não pesa, o que já se mostrou leve e o que o servidor negou rodam como vieram", async () => {
    const leve: Historico = { [chaveDoComando("npm run lint", "gamefik/gamefik")]: { picos: [90], em: 1 } };
    const fila = filaDaMaquina(vaga, () => leve, () => "gamefik/gamefik");
    expect((await decidirHook(evento("git status"), permitir, undefined, fila)).hookSpecificOutput.updatedInput).toBeUndefined();
    expect((await decidirHook(evento("npm run lint"), permitir, undefined, fila)).hookSpecificOutput.updatedInput).toBeUndefined();
    const negado = await decidirHook(evento("npm test"), async () => ({ permitir: false, motivo: "não" }), undefined, fila);
    expect(negado.hookSpecificOutput).toMatchObject({ permissionDecision: "deny" });
    expect(negado.hookSpecificOutput.updatedInput).toBeUndefined();
  });

  it("o segundo plano e o Monitor também fazem fila (é como o prompt manda rodar teste demorado)", async () => {
    const fila = filaDaMaquina(vaga, () => ({}));
    const emFundo = { tool_name: "Bash", tool_input: { command: "npm test", run_in_background: true }, cwd: "/x/gamefik" };
    expect((await decidirHook(emFundo, permitir, undefined, fila)).hookSpecificOutput.updatedInput).toMatchObject({ run_in_background: true, command: expect.stringContaining("vaga pegar") });
    expect((await decidirHook(evento("npm test", "Monitor"), permitir, undefined, fila)).hookSpecificOutput.updatedInput?.command).toContain("vaga pegar");
  });

  it("o comando que já veio reescrito não é envolvido de novo; sem a fila na config, nada muda", async () => {
    const fila = filaDaMaquina(vaga, () => ({}));
    const uma = String((await decidirHook(evento("npm test"), permitir, undefined, fila)).hookSpecificOutput.updatedInput?.command);
    expect((await decidirHook(evento(uma), permitir, undefined, fila)).hookSpecificOutput.updatedInput).toBeUndefined();
    expect((await decidirHook(evento("npm test"), permitir)).hookSpecificOutput.updatedInput).toBeUndefined();
  });

  it("a chave vem da origem do git da pasta do comando: o pico vale em qualquer task do mesmo repositório", async () => {
    const repo = await pasta();
    await new Promise<void>((r, f) => execFile("git", ["init", "-q", repo], (e) => (e ? f(e) : r())));
    await new Promise<void>((r, f) => execFile("git", ["-C", repo, "remote", "add", "origin", "git@github.com:gamefik/gamefik.git"], (e) => (e ? f(e) : r())));
    const fila = filaDaMaquina(vaga, () => ({}));
    const comando = String((await decidirHook({ tool_name: "Bash", tool_input: { command: "npm test" }, cwd: repo }, permitir, undefined, fila)).hookSpecificOutput.updatedInput?.command);
    const chave64 = / vaga pegar (\S+) /.exec(comando)?.[1] ?? "";
    expect(Buffer.from(chave64, "base64url").toString("utf8")).toBe("gamefik/gamefik\nnpm test");
  });

  it("o driver: a pasta da fila ao lado de turnos, e o nod-vaga chamado pelo mesmo node do hook", () => {
    expect(pastaDaFila("/home/nod/.nod/turnos")).toBe("/home/nod/.nod/vaga");
    expect(invocarDoHook({ nodePath: "/n", hookPath: "/h.mjs", electronComoNode: true })).toBe("ELECTRON_RUN_AS_NODE=1 '/n' '/h.mjs'");
  });
});

describe("a fila numa pasta (ADR-097)", () => {
  it("sem ninguém com a vez, entra na hora; com a memória sem folga, o segundo espera até o primeiro soltar", async () => {
    const dir = await pasta();
    const avisos: string[] = [];
    const vivos = new Set([1001, 1002]);
    const v = criarVaga({ dir, livreMb: async () => 1500, reservaMb: 1024, vivo: (p) => vivos.has(p), soltarVigia: () => null, dormir: () => new Promise((r) => setTimeout(r, 20)), avisar: (t) => avisos.push(t) });
    const primeiro = await v.pegar("gamefik\nnpm test", 1001);
    let segundoEntrou = false;
    const segundo = v.pegar("gamefik\nnpm run check", 1002).then((id) => ((segundoEntrou = true), id));
    await new Promise((r) => setTimeout(r, 200));
    expect(segundoEntrou).toBe(false);
    expect(avisos[0]).toMatch(/^nod: este comando espera a vez de rodar: 1 comando pesado roda nesta máquina/);
    // O shell do primeiro sumiu sem soltar (o bot foi parado): a vez sai do mesmo jeito.
    vivos.delete(1001);
    await segundo;
    expect(segundoEntrou).toBe(true);
    expect(avisos.at(-1)).toMatch(/^nod: a vez chegou depois de 1 min/);
    expect((await readdir(join(dir, "com-a-vez"))).sort()).toEqual([`${await segundo}.json`]);
    expect(primeiro).not.toBe(await segundo);
  });

  it("ordem de chegada: quem chegou depois espera quem está na frente, mesmo que coubesse", async () => {
    const dir = await pasta();
    let livre = 1500;
    const vivos = new Set([1, 2, 3].map((n) => 2000 + n));
    const v = criarVaga({ dir, livreMb: async () => livre, reservaMb: 1024, vivo: (p) => vivos.has(p), soltarVigia: () => null, dormir: () => new Promise((r) => setTimeout(r, 20)), avisar: () => {} });
    // O pesado (3 GB medidos) espera; o leve que chega depois não passa na frente.
    await writeFile(join(dir, "historico.json"), JSON.stringify({ "g\ngrande": { picos: [3000], em: 1 }, "g\npequeno": { picos: [300], em: 1 } }));
    await v.pegar("g\nprimeiro", 2001);
    const ordem: string[] = [];
    const grande = v.pegar("g\ngrande", 2002).then(() => ordem.push("grande"));
    await new Promise((r) => setTimeout(r, 100));
    const pequeno = v.pegar("g\npequeno", 2003).then(() => ordem.push("pequeno"));
    await new Promise((r) => setTimeout(r, 200));
    expect(ordem).toEqual([]);
    livre = 10_000;
    await Promise.all([grande, pequeno]);
    expect(ordem).toEqual(["grande", "pequeno"]);
  });

  it("quem tem a vez há mais de 20 min (um servidor em primeiro plano) não segura mais a fila", async () => {
    const dir = await pasta();
    let relogio = 1_000_000;
    const v = criarVaga({ dir, agora: () => relogio, livreMb: async () => 100, reservaMb: 1024, vivo: () => true, soltarVigia: () => null, dormir: async () => { relogio += 60_000; }, avisar: () => {} });
    await v.pegar("g\nnpm run dev", 4001);
    const inicio = relogio;
    await v.pegar("g\nnpm test", 4002);
    expect(relogio - inicio).toBeGreaterThanOrEqual(TETO_DA_VEZ_MS);
    expect(relogio - inicio).toBeLessThan(TETO_DA_VEZ_MS + 3 * 60_000);
  });

  it("sem leitura da memória, a fila deixa passar", async () => {
    const dir = await pasta();
    const v = criarVaga({ dir, livreMb: async () => null, vivo: () => true, soltarVigia: () => null, avisar: () => {} });
    await v.pegar("a\nx", 3001);
    await v.pegar("a\ny", 3002);
    expect(await readdir(join(dir, "com-a-vez"))).toHaveLength(2);
  });

  it("o vigia guarda o pico da árvore do shell; o comando morto pela falta de memória (137) reserva mais na próxima", async () => {
    const dir = await pasta();
    let rss = 100 * 1024;
    // Sem relógio de parede (flake no CI sob carga): cada fase dura até o vigia medir DUAS vezes com o valor dela (a
    // segunda começa depois da troca, então a medida é do valor novo, e não de uma volta em curso).
    let medidas = 0;
    const v = criarVaga({ dir, livreMb: async () => 9999, vivo: () => true, soltarVigia: () => null, ps: async () => { medidas++; return `  500   1  1000\n  501 500 ${rss}\n  777 500 99999\n`; }, dormir: () => new Promise((r) => setTimeout(r, 1)), avisar: () => {} });
    const id = await v.pegar("g\nnpm test", 500);
    const vigiando = v.vigiar(id, 777);
    const medir = async () => {
      const alvo = medidas + 2;
      await vi.waitFor(() => expect(medidas).toBeGreaterThanOrEqual(alvo), { timeout: 10_000, interval: 2 });
    };
    await medir();
    rss = 900 * 1024;
    await medir();
    rss = 200 * 1024;
    await medir();
    await v.soltar(id, "137");
    await vigiando;
    expect((await lerHistorico(dir))?.["g\nnpm test"]).toMatchObject({ picos: [900], faltou: true });
    expect(await readdir(join(dir, "com-a-vez"))).toEqual([]);
  });

  it("soltar um id que não existe (ou estranho) não grava nada", async () => {
    const dir = await pasta();
    await mkdir(join(dir, "com-a-vez"), { recursive: true });
    const v = criarVaga({ dir });
    await v.soltar("../../etc/passwd", "0");
    await v.soltar("naoexiste", "0");
    expect(await readdir(join(dir, "com-a-vez"))).toEqual([]);
  });
});

describe("o comando reescrito num shell de verdade, com o script do hook (ADR-097)", () => {
  async function reescrito(comando: string, dir: string): Promise<string> {
    const fila = filaDaMaquina({ dir, invocar: invocarDoHook({ nodePath: process.execPath, hookPath: HOOK }) }, () => ({}));
    const r = await decidirHook({ tool_name: "Bash", tool_input: { command: comando }, cwd: dir }, permitir, undefined, fila);
    return String(r.hookSpecificOutput.updatedInput?.command);
  }

  it("o status, o cd e as variáveis do comando valem depois dele; o pico vai para o histórico", async () => {
    const dir = await pasta();
    await mkdir(join(dir, "sub"));
    const pesado = `node -e "const b = Buffer.alloc(300 * 1024 * 1024, 1); setTimeout(() => console.log(b.length > 0 ? 'alocou' : ''), 3000)"`;
    const comando = await reescrito(`cd sub && export NOD_X=42 && ${pesado} && exit_code=7 && (exit 7)`, dir);
    const r = await bash(`cd ${JSON.stringify(dir)} && ${comando}; echo "status=$? pasta=$(basename "$PWD") x=$NOD_X"`);
    expect(r.stdout).toContain("alocou");
    expect(r.stdout).toContain("status=7 pasta=sub x=42");
    const chave = Object.keys((await ate(() => lerHistorico(dir))) ?? {})[0]!;
    // Fora de um repositório, a chave é só o texto.
    expect(chave.startsWith("\ncd sub")).toBe(true);
    const h = await ate(async () => ((await lerHistorico(dir))?.[chave]?.picos.length ? (await lerHistorico(dir))![chave]! : null));
    expect(h.picos[0]).toBeGreaterThan(250);
    expect(await ate(async () => ((await readdir(join(dir, "com-a-vez"))).length === 0 ? true : null))).toBe(true);
  }, 60_000);

  it("com a memória simulada sem folga, o segundo comando espera o primeiro e o bot lê o aviso", async () => {
    const dir = await pasta();
    const um = await reescrito(`sleep 2; echo um-fim $(date +%s%N)`, dir);
    const dois = await reescrito(`echo dois-comeca $(date +%s%N)`, dir);
    const env = { NOD_SIMULAR_LIVRE_MB: "100" };
    const primeiro = bash(um, env);
    await ate(async () => ((await readdir(join(dir, "com-a-vez")).catch(() => [])).length > 0 ? true : null));
    const segundo = await bash(dois, env);
    const r1 = await primeiro;
    const fimDoUm = Number(/um-fim (\d+)/.exec(r1.stdout)?.[1]);
    const comecoDoDois = Number(/dois-comeca (\d+)/.exec(segundo.stdout)?.[1]);
    expect(comecoDoDois).toBeGreaterThan(fimDoUm);
    expect(segundo.stderr).toContain("nod: este comando espera a vez de rodar");
    expect(segundo.status).toBe(0);
  }, 60_000);

  it("sem a pasta da fila gravável, o comando roda direto e na hora (a fila nunca impede um comando)", async () => {
    // Uma pasta "dentro" de um arquivo não se cria em nenhum sistema; sem NOD_HOME, a pasta da fila também não.
    const arquivo = join(await pasta(), "um-arquivo");
    await writeFile(arquivo, "x");
    for (const dir of [join(arquivo, "vaga"), join(await pasta(), "sem-nod-home", "vaga")]) {
      const comando = await reescrito(`node -e "console.log('rodou')"`, dir);
      expect(comando).toContain("vaga pegar");
      const inicio = Date.now();
      const r = await bash(comando);
      expect(r.stdout).toContain("rodou");
      expect(r.status).toBe(0);
      expect(Date.now() - inicio).toBeLessThan(10_000);
    }
  }, 60_000);
});
