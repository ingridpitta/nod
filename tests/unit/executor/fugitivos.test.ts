import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { executarColetando, iniciarProcesso, registrarGruposEm } from "../../../src/adapters/executor/processo.ts";
import {
  alvosFugitivos,
  descendentesDe,
  encerrarFugitivosDaInstancia,
  encerrarFugitivosDoTurno,
  nomeDoPrograma,
  type AlvoFugitivo,
} from "../../../src/adapters/executor/fugitivos.ts";
import { prefixoDaMarca, type ProcessoDoSistema } from "../../../src/adapters/executor/grupos-orfaos.ts";

/**
 * ADR-097 (fase 0): o que o turno abriu e saiu do grupo dele (o Postgres de teste, que abre sessão própria) morre no fim
 * do turno e no boot, provado pela marca NOD_GRUPO. medido em 2026-10-08 (processo-grupo.test.ts): filho e neto de
 * verdade custam até ~2 s por caso com o Mac carregado; as esperas vão a 20 s.
 */
const ESPERA_MS = 20_000;
vi.setConfig({ testTimeout: 3 * ESPERA_MS });

const vivo = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const esperarAte = async (cond: () => boolean, ms = ESPERA_MS) => {
  const fim = Date.now() + ms;
  while (!cond() && Date.now() < fim) await new Promise((r) => setTimeout(r, 20));
  return cond();
};

const T0 = new Date(2026, 9, 11, 10, 0, 0).getTime();
const EU = 4_242;
const proc = (pid: number, pgid: number, inicioMs: number, comando: string, ppid = 1): ProcessoDoSistema => ({ pid, ppid, pgid, inicioMs, comando });
const euNoPs = proc(EU, EU, T0 - 60_000, "node motor/main.ts", 1);
const MARCA = "ab12cd34-0011aa";
const env = (marca: string) => `PATH=/usr/bin NOD_GRUPO=${marca} HOME=/home/nod`;

/** Sinais anotados em vez de mandados; `teimosos` não morrem no SIGTERM. */
function sinais(teimosos: number[] = []) {
  const mandados: Array<{ pid: number; grupo: boolean; sinal: string }> = [];
  const mortos = new Set<number>();
  return {
    mandados,
    sinalizar: (a: AlvoFugitivo, sinal: NodeJS.Signals) => {
      mandados.push({ pid: a.pid, grupo: a.grupo, sinal });
      if (sinal === "SIGKILL" || !teimosos.includes(a.pid)) mortos.add(a.pid);
    },
    vivo: (a: AlvoFugitivo) => !mortos.has(a.pid),
  };
}

describe("quais processos marcados viram alvo (puro)", () => {
  it("o líder marcado leva o grupo; o membro do mesmo grupo não sai duas vezes", () => {
    const ps = [proc(500, 500, T0, "/home/nod/pg17/bin/postgres -D pgdata"), proc(501, 500, T0, "postgres: app db ::1 idle", 500)];
    expect(alvosFugitivos(ps, () => true, new Set())).toEqual([{ pid: 500, grupo: true, programa: "postgres" }]);
  });

  it("marcado cujo líder não tem a marca (ou morreu) vai sozinho; grupo excluído e o init ficam", () => {
    const ps = [proc(600, 600, T0, "/bin/zsh"), proc(601, 600, T0, "node servidor.js", 600), proc(700, 777, T0, "node orfao.js"), proc(800, 800, T0, "node vivo.js"), proc(1, 1, T0, "/sbin/init")];
    const marcados = new Set([601, 700, 800, 1]);
    const alvos = alvosFugitivos(ps, (pid) => marcados.has(pid), new Set([800]));
    expect(alvos).toEqual([
      { pid: 601, grupo: false, programa: "node" },
      { pid: 700, grupo: false, programa: "node" },
    ]);
  });

  it("o nome do programa sai sem caminho e sem argumentos", () => {
    expect(nomeDoPrograma("/usr/lib/postgresql/16/bin/postgres -D /tmp/x")).toBe("postgres");
    expect(nomeDoPrograma("postgres: gamefik gf_db ::1(37898) SELECT")).toBe("postgres");
    expect(nomeDoPrograma("")).toBe("?");
  });

  it("descendentes seguem a cadeia de ppid, sem o próprio", () => {
    const ps = [euNoPs, proc(10, 10, T0, "a", EU), proc(11, 10, T0, "b", 10), proc(12, 12, T0, "c", 1)];
    expect([...descendentesDe(ps, EU)].sort()).toEqual([10, 11]);
  });
});

describe("fim do turno (dependências montadas)", () => {
  const turno = { pgid: 300, desdeMs: T0 + 300, marca: MARCA };

  it("leva só o que nasceu depois do spawn, tem a marca do turno e está fora dos grupos poupados", async () => {
    const ps = [
      euNoPs,
      proc(300, 300, T0 + 1_000, "claude -p", EU), // o grupo do turno: já levou SIGKILL em processo.ts
      proc(310, 310, T0 + 5_000, "/x/bin/postgres -D pgdata"), // fugiu: sessão própria, marca do turno
      proc(320, 320, T0 - 3_600_000, "/x/bin/postgres -D velho"), // nasceu antes do spawn: não é deste turno
      proc(330, 330, T0 + 6_000, "/x/bin/postgres -D outro"), // marca de outro turno
      proc(340, 340, T0 + 7_000, "claude -p"), // grupo de um turno vivo
    ];
    const ambientes = new Map([[300, env(MARCA)], [310, env(MARCA)], [320, env(MARCA)], [330, env("ab12cd34-ffff00")], [340, env(MARCA)]]);
    const s = sinais();
    const alvos = await encerrarFugitivosDoTurno(turno, [340], { listar: async () => ps, ambientes: async () => ambientes, pidAtual: EU, sinalizar: s.sinalizar, vivo: s.vivo, esperaAteSigkillMs: 50 });
    expect(alvos.map((a) => a.pid)).toEqual([310]);
    expect(s.mandados).toEqual([{ pid: 310, grupo: true, sinal: "SIGTERM" }]);
  });

  it("quem não sai no SIGTERM leva SIGKILL depois da espera", async () => {
    const ps = [euNoPs, proc(310, 310, T0 + 5_000, "/x/bin/postgres -D pgdata")];
    const s = sinais([310]);
    await encerrarFugitivosDoTurno(turno, [], { listar: async () => ps, ambientes: async () => new Map([[310, env(MARCA)]]), pidAtual: EU, sinalizar: s.sinalizar, vivo: s.vivo, esperaAteSigkillMs: 50 });
    expect(s.mandados.map((m) => m.sinal)).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("sem marca (registro desligado), sem `ps` ou sem o próprio pid no `ps`: nada morre", async () => {
    const ps = [proc(310, 310, T0 + 5_000, "/x/bin/postgres -D pgdata")];
    const ambientes = async () => new Map([[310, env(MARCA)]]);
    const s = sinais();
    expect(await encerrarFugitivosDoTurno({ ...turno, marca: "" }, [], { listar: async () => ps, ambientes, pidAtual: EU, sinalizar: s.sinalizar })).toEqual([]);
    expect(await encerrarFugitivosDoTurno(turno, [], { listar: async () => null, ambientes, pidAtual: EU, sinalizar: s.sinalizar })).toEqual([]);
    expect(await encerrarFugitivosDoTurno(turno, [], { listar: async () => ps, ambientes, pidAtual: EU, sinalizar: s.sinalizar })).toEqual([]);
    expect(s.mandados).toEqual([]);
  });

  it("nunca o grupo deste processo nem o de um ancestral, mesmo com a marca", async () => {
    // Um bot que religou o próprio servidor com setsid: o servidor novo herda a marca e é este processo.
    const pai = proc(900, 900, T0 + 2_000, "node scripts/dev.mjs");
    const eu = proc(EU, 900, T0 + 3_000, "node server.ts", 900);
    const s = sinais();
    const alvos = await encerrarFugitivosDoTurno(turno, [], { listar: async () => [pai, eu], ambientes: async () => new Map([[900, env(MARCA)], [EU, env(MARCA)]]), pidAtual: EU, sinalizar: s.sinalizar, vivo: s.vivo });
    expect(alvos).toEqual([]);
  });
});

describe("boot (dependências montadas)", () => {
  const arquivo = "/home/nod/.config/nod-motor/executor/grupos-vivos.json";
  const prefixo = prefixoDaMarca(arquivo);

  it("leva o que tem o prefixo desta instância; poupa outra instância e o que este processo abriu nesta vida", async () => {
    const ps = [
      euNoPs,
      proc(410, 410, T0 - 7_200_000, "/x/bin/postgres -D pgdata"), // de uma vida anterior
      proc(420, 420, T0 - 7_200_000, "/x/bin/postgres -D outro"), // de outra instância (outro prefixo)
      proc(430, 430, T0, "node sonda.js", EU), // filho deste processo, com a marca herdada
      proc(440, 440, T0, "/x/bin/postgres -D sem-marca"),
    ];
    const ambientes = new Map([[410, env(`${prefixo}-aa11bb22cc33`)], [420, env("ffffffff-aa11bb22cc33")], [430, env(`${prefixo}-aa11bb22cc33`)], [440, "PATH=/usr/bin"]]);
    const s = sinais();
    const alvos = await encerrarFugitivosDaInstancia(arquivo, { listar: async () => ps, ambientes: async () => ambientes, pidAtual: EU, sinalizar: s.sinalizar, vivo: s.vivo, esperaAteSigkillMs: 50 });
    expect(alvos.map((a) => a.pid)).toEqual([410]);
  });

  it("o prefixo sozinho, sem o resto da marca, não prova nada", async () => {
    const ps = [euNoPs, proc(410, 410, T0, "/x/bin/postgres -D pgdata")];
    const s = sinais();
    const alvos = await encerrarFugitivosDaInstancia(arquivo, { listar: async () => ps, ambientes: async () => new Map([[410, env(`${prefixo}-`)]]), pidAtual: EU, sinalizar: s.sinalizar, vivo: s.vivo });
    expect(alvos).toEqual([]);
  });
});

// O líder abre um neto em sessão própria (detached = setsid, como o Postgres) e sai; o neto escreve o pid e fica.
const LIDER = `
const { spawn } = require("node:child_process");
const neto = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", detached: true });
neto.unref();
process.stdout.write(String(neto.pid) + "\\n");
`;

function lancarLider(marca: string): Promise<{ lider: number; neto: number }> {
  return new Promise((resolver, rejeitar) => {
    const filho = spawn(process.execPath, ["-e", LIDER], { env: { PATH: process.env.PATH ?? "", NOD_GRUPO: marca }, stdio: ["ignore", "pipe", "inherit"], detached: true });
    let saida = "";
    filho.stdout.setEncoding("utf8");
    filho.stdout.on("data", (d: string) => (saida += d));
    filho.on("error", rejeitar);
    filho.on("close", () => resolver({ lider: filho.pid!, neto: Number(saida.trim()) }));
  });
}

describe("processos de verdade", () => {
  it("o neto em sessão própria com a marca do turno morre; o de outra marca fica", async () => {
    const desdeMs = Date.now();
    const marca = `fe11de00-${Date.now().toString(16)}`;
    const deste = await lancarLider(marca);
    const deOutro = await lancarLider(`fe11de00-outro${Date.now().toString(16)}`);
    try {
      expect(vivo(deste.neto)).toBe(true);
      expect(vivo(deOutro.neto)).toBe(true);
      const alvos = await encerrarFugitivosDoTurno({ pgid: deste.lider, desdeMs, marca }, [], { esperaAteSigkillMs: 2_000 });
      expect(alvos.map((a) => a.pid)).toEqual([deste.neto]);
      expect(await esperarAte(() => !vivo(deste.neto))).toBe(true);
      expect(vivo(deOutro.neto)).toBe(true);
    } finally {
      for (const pid of [deste.neto, deOutro.neto]) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // já saiu
        }
      }
    }
  });

  it("pelo caminho do turno: o líder sai sozinho e o neto em sessão própria vai junto", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nod-fugitivos-"));
    registrarGruposEm(join(dir, "grupos-vivos.json"));
    let neto = 0;
    try {
      const linhas: string[] = [];
      const p = iniciarProcesso({ bin: process.execPath, args: ["-e", LIDER], env: { PATH: process.env.PATH ?? "" }, cwd: process.cwd(), stdin: "ignore", aoLinha: (l) => linhas.push(l) });
      await p.fim;
      neto = Number(linhas[0]);
      expect(neto).toBeGreaterThan(1);
      expect(await esperarAte(() => !vivo(neto))).toBe(true);
    } finally {
      registrarGruposEm(null);
      if (neto > 1 && vivo(neto)) process.kill(neto, "SIGKILL");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("executarColetando (sonda) não procura fugitivos", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nod-fugitivos-"));
    registrarGruposEm(join(dir, "grupos-vivos.json"));
    let neto = 0;
    try {
      const r = await executarColetando({ bin: process.execPath, args: ["-e", LIDER], env: { PATH: process.env.PATH ?? "" }, cwd: process.cwd(), timeoutMs: ESPERA_MS });
      neto = Number(r.stdout.trim());
      await new Promise((resolver) => setTimeout(resolver, 1_000));
      expect(vivo(neto)).toBe(true);
    } finally {
      registrarGruposEm(null);
      if (neto > 1 && vivo(neto)) process.kill(neto, "SIGKILL");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
