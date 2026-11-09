import { describe, expect, it } from "vitest";
import type { PlanoTurno } from "../../../src/contracts/plano-turno.ts";
import type { PonteInterna } from "../../../src/contracts/ponte.ts";
import { iniciarPoolDeLacos } from "../../../src/adapters/executor/pool-lacos.ts";

const esperarAte = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 2));
  expect(cond()).toBe(true);
};

/**
 * Ponte com fila controlada pelo teste e um laço mínimo (puxa → roda até liberar → puxa de novo). `daPessoa` é o que a
 * pessoa espera agora (ADR-130): sai primeiro, e é a única que sai quando o puxar pede `soDaPessoa`.
 */
function cenario() {
  const fila: string[] = [];
  const daPessoa: string[] = [];
  const liberar = new Map<string, () => void>();
  const rodando = new Set<string>();
  const ponte = {
    conectar: async () => {},
    puxar: async (_pessoa: string, _maquina?: unknown, opcoes?: { soDaPessoa?: boolean }) => {
      const dela = daPessoa.shift();
      const id = dela ?? (opcoes?.soDaPessoa ? undefined : fila.shift());
      return id ? ({ turnoId: id, daPessoa: dela !== undefined } as PlanoTurno) : null;
    },
    renovar: async () => ({ ativo: true, versaoMinimaApp: "0" }),
    entregar: async () => {},
    desconectar: async () => {},
  } satisfies PonteInterna;
  const criar = (p: PonteInterna) => {
    let parado = false;
    let atual: string | null = null;
    const corrida = (async () => {
      while (!parado) {
        const plano = await p.puxar("pessoa");
        if (parado) break;
        if (!plano) { await new Promise((r) => setTimeout(r, 1)); continue; }
        atual = plano.turnoId;
        rodando.add(plano.turnoId);
        await new Promise<void>((r) => liberar.set(plano.turnoId, r));
        rodando.delete(plano.turnoId);
        atual = null;
      }
    })();
    return { parar: async () => { parado = true; await corrida; }, turnoAtual: () => atual };
  };
  return { fila, daPessoa, liberar, rodando, pool: iniciarPoolDeLacos(criar, ponte) };
}

describe("pool elástico de laços: um ocioso sempre, um a mais por turno rodando", () => {
  it("três turnos (de agentes diferentes) rodam juntos; ao acabarem, volta a um laço só", async () => {
    const { fila, liberar, rodando, pool } = cenario();
    expect(pool.tamanho()).toBe(1);
    fila.push("nina", "taga", "gil");
    await esperarAte(() => rodando.size === 3);
    expect(pool.tamanho()).toBe(4);
    expect(pool.turnosAtuais().sort()).toEqual(["gil", "nina", "taga"]);
    for (const id of ["nina", "taga", "gil"]) liberar.get(id)?.();
    await esperarAte(() => pool.tamanho() === 1);
    await pool.parar();
  });

  it("ADR-100: drenar não puxa trabalho novo e deixa o que roda terminar; desligar volta a puxar", async () => {
    const { fila, liberar, rodando, pool } = cenario();
    fila.push("nina");
    await esperarAte(() => rodando.size === 1);
    pool.drenar("fundo");
    fila.push("taga");
    await new Promise((r) => setTimeout(r, 30));
    expect(pool.turnosAtuais()).toEqual(["nina"]);
    expect(fila).toEqual(["taga"]);
    liberar.get("nina")?.();
    await esperarAte(() => pool.turnosAtuais().length === 0);
    expect(fila).toEqual(["taga"]);
    pool.drenar(false);
    await esperarAte(() => rodando.has("taga"));
    liberar.get("taga")?.();
    await pool.parar();
  });

  it("ADR-130: drenando, a fala da pessoa ainda sai; o fundo espera a atualização", async () => {
    const { fila, daPessoa, liberar, rodando, pool } = cenario();
    pool.drenar("fundo");
    fila.push("rotina-da-ada");
    daPessoa.push("fala-do-marlon");
    await esperarAte(() => rodando.has("fala-do-marlon"));
    await new Promise((r) => setTimeout(r, 30));
    expect(fila).toEqual(["rotina-da-ada"]);
    liberar.get("fala-do-marlon")?.();
    pool.drenar(false);
    await esperarAte(() => rodando.has("rotina-da-ada"));
    liberar.get("rotina-da-ada")?.();
    await pool.parar();
  });

  it("ADR-131: conta os turnos da pessoa à parte do fundo; drenando tudo, nem a fala dela começa", async () => {
    const { fila, daPessoa, liberar, rodando, pool } = cenario();
    fila.push("frente-1", "frente-2");
    await esperarAte(() => rodando.size === 2);
    expect(pool.turnosDaPessoa()).toBe(0);
    daPessoa.push("fala-do-marlon");
    await esperarAte(() => rodando.has("fala-do-marlon"));
    expect(pool.turnosAtuais().length).toBe(3);
    expect(pool.turnosDaPessoa()).toBe(1);
    liberar.get("fala-do-marlon")?.();
    await esperarAte(() => !rodando.has("fala-do-marlon"));
    await esperarAte(() => pool.turnosDaPessoa() === 0);
    pool.drenar("tudo");
    daPessoa.push("outra-fala");
    await new Promise((r) => setTimeout(r, 30));
    expect(daPessoa).toEqual(["outra-fala"]);
    pool.drenar("fundo");
    await esperarAte(() => rodando.has("outra-fala"));
    for (const id of ["frente-1", "frente-2", "outra-fala"]) liberar.get(id)?.();
    await pool.parar();
  });

  it("parar() encerra todos, inclusive os que estão rodando", async () => {
    const { fila, liberar, rodando, pool } = cenario();
    fila.push("nina");
    await esperarAte(() => rodando.size === 1);
    const parou = pool.parar();
    liberar.get("nina")?.();
    await parou;
    expect(pool.tamanho()).toBe(0);
  });
});
