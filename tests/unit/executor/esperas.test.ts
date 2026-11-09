import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { esperasVivas, esquecerEsperasDoProcesso, iniciarEsperas, pastaDaEspera } from "../../../src/adapters/executor/esperas.ts";
import type { EsperaParaRodar, RelatoEspera, RespostaRelatoEspera } from "../../../src/contracts/espera.ts";

/**
 * ADR-099 item 4 (parte 2, definido em 2026-10-12): o laço das esperas na máquina, com processo de verdade (`sh -c`). Só
 * em teste o comando tem sleep: no catálogo do bot o laço com sleep é recusado. medido em 2026-10-12 (Mac, sem carga):
 * cada caso leva 0,1–1,2 s; a espera de cada condição vai a 20 s (~15x) pelo load 600–950 do AGENTS.md.
 */
const ESPERA_MS = 20_000;
vi.setConfig({ testTimeout: 2 * ESPERA_MS + 5_000 });

const esperarAte = async (cond: () => boolean, ms = ESPERA_MS) => {
  const fim = Date.now() + ms;
  while (!cond() && Date.now() < fim) await new Promise((r) => setTimeout(r, 20));
  return cond();
};

function ponteFalsa(lista: EsperaParaRodar[] | null, o: { seguir?: boolean } = {}) {
  const relatos: RelatoEspera[] = [];
  const ponte = {
    lista,
    async esperas(): Promise<EsperaParaRodar[] | null> { return ponte.lista; },
    async relatarEspera(_p: string, _m: string, r: RelatoEspera): Promise<RespostaRelatoEspera> { relatos.push(r); return { seguir: r.tipo === "iniciou" ? o.seguir ?? true : false }; },
  };
  return { ponte, relatos };
}

function casa() {
  const home = mkdtempSync(join(tmpdir(), "nod-esperas-"));
  mkdirSync(join(home, "nod", "Ada", "ci"), { recursive: true });
  return home;
}

const casas: string[] = [];
afterEach(async () => {
  await esquecerEsperasDoProcesso();
  for (const h of casas.splice(0)) rmSync(h, { recursive: true, force: true });
});

function ligar(lista: EsperaParaRodar[] | null, o: { seguir?: boolean } = {}) {
  const home = casa();
  casas.push(home);
  const { ponte, relatos } = ponteFalsa(lista, o);
  const esperas = iniciarEsperas({ ponte, pessoaId: "p", machineId: "m", home, env: { PATH: process.env.PATH ?? "/usr/bin:/bin" }, shell: "/bin/sh", intervaloMs: 60_000 });
  return { home, ponte, relatos, esperas };
}

describe("esperas na máquina (ADR-099, parte 2)", () => {
  it("roda o comando na pasta do turno, fora do CLI, e relata o começo e o fim com o código e as últimas linhas", async () => {
    const { relatos, esperas } = ligar([{ id: "e1", comando: "sleep 1; pwd; echo ok", pasta: "Ada/ci", iniciada: false }]);
    expect(await esperarAte(() => relatos.some((r) => r.tipo === "terminou"))).toBe(true);
    esperas.parar();
    expect(relatos[0]).toEqual({ id: "e1", tipo: "iniciou" });
    const fim = relatos.find((r) => r.tipo === "terminou");
    expect(fim).toMatchObject({ id: "e1", tipo: "terminou", codigo: 0 });
    if (fim?.tipo === "terminou") {
      expect(fim.saida.endsWith("ok")).toBe(true);
      expect(fim.saida).toContain(join("nod", "Ada", "ci"));
    }
    expect(esperasVivas()).toEqual([]);
  });

  it("o código de saída do comando volta como veio", async () => {
    const { relatos, esperas } = ligar([{ id: "e2", comando: "echo falhou >&2; exit 3", pasta: "Ada/ci", iniciada: false }]);
    expect(await esperarAte(() => relatos.some((r) => r.tipo === "terminou"))).toBe(true);
    esperas.parar();
    expect(relatos.find((r) => r.tipo === "terminou")).toMatchObject({ codigo: 3, saida: "falhou" });
  });

  it("saiu da lista (o Parar cancelou): o grupo morre e o fim não é relatado", async () => {
    const { ponte, relatos, esperas } = ligar([{ id: "e3", comando: "sleep 30", pasta: "Ada/ci", iniciada: false }]);
    expect(await esperarAte(() => esperasVivas().includes("e3") && relatos.length > 0)).toBe(true);
    ponte.lista = [];
    await esperas.passada();
    expect(esperasVivas()).toEqual([]);
    await new Promise((r) => setTimeout(r, 200));
    esperas.parar();
    expect(relatos.map((r) => r.tipo)).toEqual(["iniciou"]);
  });

  it("sem resposta do servidor (null), nada morre; o servidor recusando o começo (quedas demais), o grupo morre", async () => {
    const a = ligar([{ id: "e4", comando: "sleep 30", pasta: "Ada/ci", iniciada: true }]);
    expect(await esperarAte(() => esperasVivas().includes("e4"))).toBe(true);
    a.ponte.lista = null;
    await a.esperas.passada();
    expect(esperasVivas()).toContain("e4");
    a.esperas.parar();

    const b = ligar([{ id: "e5", comando: "sleep 30", pasta: "Ada/ci", iniciada: true }], { seguir: false });
    expect(await esperarAte(() => b.relatos.length > 0 && !esperasVivas().includes("e5"))).toBe(true);
    b.esperas.parar();
  });

  it("pasta que não existe ou fora de ~/nod: a espera cai na hora, sem rodar nada", async () => {
    const { relatos, esperas } = ligar([
      { id: "e6", comando: "echo nunca", pasta: "Ada/sumiu", iniciada: false },
      { id: "e7", comando: "echo nunca", pasta: "../fora", iniciada: false },
    ]);
    expect(await esperarAte(() => relatos.length === 2)).toBe(true);
    esperas.parar();
    expect(relatos).toEqual([{ id: "e6", tipo: "caiu", motivo: "pasta_ausente" }, { id: "e7", tipo: "caiu", motivo: "pasta_ausente" }]);
    const home = casa();
    casas.push(home);
    expect(pastaDaEspera(home, "Ada/ci")).toBe(join(home, "nod", "Ada", "ci"));
    expect(pastaDaEspera(home, "/etc")).toBeNull();
    expect(pastaDaEspera(home, "Ada/../../..")).toBeNull();
  });
});
