import { describe, expect, it } from "vitest";
import { criarRecolherAdiado, type Relogio } from "../../../web/lib/recolher-adiado.ts";

/** Relógio de mentira: `passar(ms)` roda o que venceu. */
function relogioFalso(): Relogio & { passar: (ms: number) => Promise<void> } {
  let agora = 0;
  let seq = 0;
  const timers = new Map<number, { em: number; fn: () => void }>();
  return {
    agendar: (fn, ms) => { timers.set(++seq, { em: agora + ms, fn }); return seq; },
    cancelar: (t) => void timers.delete(t),
    async passar(ms) {
      agora += ms;
      for (const [t, x] of [...timers].sort((a, b) => a[1].em - b[1].em)) if (x.em <= agora) { timers.delete(t); x.fn(); }
      for (let i = 0; i < 5; i++) await Promise.resolve();
    },
  };
}

describe("recolher adiado (NOD-437, revisões 2 e 4 do PR #632)", () => {
  it("um clique: um PATCH só, depois da espera", async () => {
    const r = relogioFalso();
    const enviados: [string, boolean][] = [];
    const a = criarRecolherAdiado(async (id, v) => void enviados.push([id, v]), r, 300);
    a.pedir("t1", false, true);
    await r.passar(299);
    expect(enviados).toEqual([]);
    expect(a.pendente("t1")).toBe(true);
    await r.passar(1);
    expect(enviados).toEqual([["t1", true]]);
  });

  it("duplo clique (recolhe e desfaz): nenhum PATCH", async () => {
    const r = relogioFalso();
    const enviados: [string, boolean][] = [];
    const a = criarRecolherAdiado(async (id, v) => void enviados.push([id, v]), r, 300);
    a.pedir("t1", false, true);
    await r.passar(100);
    a.pedir("t1", true, false);
    await r.passar(1_000);
    expect(enviados).toEqual([]);
    expect(a.pendente("t1")).toBe(false);
  });

  it("dois cliques espaçados: dois PATCHes, em ordem, o segundo só depois do primeiro responder", async () => {
    const r = relogioFalso();
    const ordem: string[] = [];
    let soltarPrimeiro: () => void = () => {};
    const a = criarRecolherAdiado(async (_id, v) => {
      ordem.push(`ini ${v}`);
      if (v) await new Promise<void>((ok) => { soltarPrimeiro = ok; });
      ordem.push(`fim ${v}`);
    }, r, 300);
    a.pedir("t1", false, true);
    await r.passar(300);
    a.pedir("t1", true, false);
    await r.passar(300);
    expect(ordem).toEqual(["ini true"]);
    soltarPrimeiro();
    await r.passar(0);
    expect(ordem).toEqual(["ini true", "fim true", "ini false", "fim false"]);
  });

  it("a página fechando envia já o que esperava", async () => {
    const r = relogioFalso();
    const enviados: [string, boolean][] = [];
    const a = criarRecolherAdiado(async (id, v) => void enviados.push([id, v]), r, 300);
    a.pedir("t1", false, true);
    a.pedir("t2", true, false);
    a.enviarJa();
    await r.passar(0);
    expect(enviados).toEqual([["t1", true], ["t2", false]]);
    await r.passar(1_000);
    expect(enviados).toHaveLength(2);
  });

  it("um PATCH que falha não trava a fila do time", async () => {
    const r = relogioFalso();
    const enviados: boolean[] = [];
    const a = criarRecolherAdiado(async (_id, v) => { enviados.push(v); if (v) throw new Error("rede"); }, r, 300);
    a.pedir("t1", false, true);
    await r.passar(300);
    a.pedir("t1", true, false);
    await r.passar(300);
    expect(enviados).toEqual([true, false]);
  });
});
