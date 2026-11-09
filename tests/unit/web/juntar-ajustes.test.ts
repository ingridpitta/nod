import { describe, expect, it, vi } from "vitest";
import { juntarAjustes } from "../../../web/lib/juntar-ajustes.ts";

// definido em 2026-10-30 (NOD-20, revisão 1 M2): mexer na voz e na velocidade da ligação grava UMA versão, não uma por clique.
vi.setConfig({ testTimeout: 30_000 });

function relogioFalso() {
  let proximo = 1;
  const timers = new Map<number, () => void>();
  return {
    setTimeout: (f: () => void) => { const id = proximo++; timers.set(id, f); return id; },
    clearTimeout: (id: number) => { timers.delete(id); },
    correr: () => { const fs = [...timers.values()]; timers.clear(); fs.forEach((f) => f()); },
    pendentes: () => timers.size,
  };
}

describe("juntarAjustes", () => {
  it("junta ajustes em sequência numa chamada só, com o último valor de cada campo", () => {
    const r = relogioFalso();
    const fn = vi.fn();
    const enviar = juntarAjustes<{ voz?: string; vozVelocidade?: number }>(fn, 1_200, r);
    enviar({ voz: "a" });
    enviar({ vozVelocidade: 1.1 });
    enviar({ vozVelocidade: 1.2 });
    enviar({ voz: "b" });
    expect(fn).not.toHaveBeenCalled();
    expect(r.pendentes()).toBe(1);
    r.correr();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ voz: "b", vozVelocidade: 1.2 });
  });

  it("agora() despacha o pendente na hora e não repete depois", () => {
    const r = relogioFalso();
    const fn = vi.fn();
    const enviar = juntarAjustes<{ voz?: string }>(fn, 1_200, r);
    enviar({ voz: "a" });
    enviar.agora();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(r.pendentes()).toBe(0);
    r.correr();
    enviar.agora();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("agora() sem nada pendente não chama", () => {
    const fn = vi.fn();
    juntarAjustes(fn, 1_200, relogioFalso()).agora();
    expect(fn).not.toHaveBeenCalled();
  });
});
