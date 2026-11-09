import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesfazerParaRodar, RelatoDesfazer } from "../../../src/contracts/checkpoint.ts";
import { CAMINHO_ILEGIVEL } from "../../../src/domain/checkpoints.ts";
import { esquecerDesfazeresDoProcesso, iniciarDesfazeres, PROGRESSO_A_CADA_MS, SINAL_A_CADA_MS, TETO_RELATO } from "../../../src/adapters/executor/desfazeres.ts";

const P = "pessoa";
const M = "maquina";
const T = "11111111-1111-4111-8111-111111111111";

function ponteFalsa(lista: DesfazerParaRodar[], aceita: () => boolean = () => true) {
  const relatos: RelatoDesfazer[] = [];
  const ponte = {
    desfazeres: vi.fn(async () => lista.splice(0)),
    relatarDesfazer: vi.fn(async (_p: string, _m: string, r: RelatoDesfazer) => {
      relatos.push(r);
      return aceita() ? { ok: true } : null;
    }),
  };
  return { ponte, relatos };
}

afterEach(() => esquecerDesfazeresDoProcesso());

describe("laço dos desfazeres da máquina (NOD-54)", () => {
  it("roda o pedido, manda progresso com teto de frequência e o fim", async () => {
    const { ponte, relatos } = ponteFalsa([{ turnoId: T, pastaDoBot: "Bot", forcar: ["~/nod/Bot/a.md"], tentativa: 1 }]);
    let t = 0;
    const desfazer = vi.fn(async (o: { forcar: string[]; aoProgresso?: (f: number, t: number) => Promise<void> }) => {
      expect(o.forcar).toEqual(["~/nod/Bot/a.md"]);
      for (let i = 1; i <= 3; i++) {
        t += PROGRESSO_A_CADA_MS / 5;
        await o.aoProgresso?.(i, 3);
      }
      return { arquivos: [{ caminho: "~/nod/Bot/a.md", desfecho: "voltou" as const }] };
    });
    const d = iniciarDesfazeres({ ponte: ponte as never, pessoaId: P, machineId: M, home: "/tmp/nada", intervaloMs: 60_000, desfazer: desfazer as never, agora: () => t + PROGRESSO_A_CADA_MS });
    await d.passada();
    await vi.waitFor(() => expect(relatos.some((r) => r.resultado)).toBe(true));
    d.parar();
    const progresso = relatos.filter((r) => !r.resultado && !r.falha);
    expect(progresso).toEqual([{ turnoId: T, tentativa: 1, feitos: 1, total: 3 }]);
    expect(relatos.at(-1)).toEqual({ turnoId: T, tentativa: 1, feitos: 1, total: 1, resultado: { arquivos: [{ caminho: "~/nod/Bot/a.md", desfecho: "voltou" }] } });
    expect(desfazer).toHaveBeenCalledTimes(1);
  });

  it("a rede pendurada no progresso não segura o desfazer (nem a trava do bot): um relato no ar por vez (revisão 13, M1)", async () => {
    const { ponte, relatos } = ponteFalsa([{ turnoId: T, pastaDoBot: "Bot", forcar: [], tentativa: 1 }]);
    let t = 0;
    let soltar = () => undefined as void;
    const pendurado = new Promise<void>((r) => { soltar = r; });
    const relatar = ponte.relatarDesfazer.getMockImplementation()!;
    ponte.relatarDesfazer.mockImplementation(async (p, m, r) => {
      if (!r.resultado) { relatos.push(r); await pendurado; return { ok: true }; }
      return relatar(p, m, r);
    });
    let terminou = false;
    const desfazer = vi.fn(async (o: { aoProgresso?: (f: number, t: number) => Promise<void> | void }) => {
      for (let i = 1; i <= 4; i++) {
        t += PROGRESSO_A_CADA_MS * 2;
        await o.aoProgresso?.(i, 5);
      }
      terminou = true;
      return { arquivos: [{ caminho: "~/nod/Bot/a.md", desfecho: "voltou" as const }] };
    });
    const d = iniciarDesfazeres({ ponte: ponte as never, pessoaId: P, machineId: M, home: "/tmp/nada", intervaloMs: 60_000, desfazer: desfazer as never, agora: () => t });
    await d.passada();
    await vi.waitFor(() => expect(relatos.some((r) => r.resultado)).toBe(true));
    expect(terminou).toBe(true);
    expect(relatos.filter((r) => !r.resultado)).toEqual([{ turnoId: T, tentativa: 1, feitos: 1, total: 5 }]);
    soltar();
    d.parar();
  });

  it("sem a foto relata sem_checkpoint; exceção relata erro", async () => {
    const T2 = "22222222-2222-4222-8222-222222222222";
    const { ponte, relatos } = ponteFalsa([{ turnoId: T, pastaDoBot: "Bot", forcar: [], tentativa: 1 }, { turnoId: T2, pastaDoBot: "Bot", forcar: [], tentativa: 1 }]);
    const desfazer = vi.fn(async (o: { turnoId: string }) => {
      if (o.turnoId === T) return "sem_checkpoint" as const;
      throw new Error("disco");
    });
    const d = iniciarDesfazeres({ ponte: ponte as never, pessoaId: P, machineId: M, home: "/tmp/nada", intervaloMs: 60_000, desfazer: desfazer as never });
    await vi.waitFor(() => expect(relatos).toHaveLength(2));
    d.parar();
    expect(relatos[0]).toMatchObject({ turnoId: T, falha: "sem_checkpoint" });
    expect(relatos[1]).toMatchObject({ turnoId: T2, falha: "erro" });
  });

  it("o fim recusado fica guardado, não roda de novo e é reenviado na passada seguinte", async () => {
    let aceita = false;
    const lista = [{ turnoId: T, pastaDoBot: "Bot", forcar: [], tentativa: 1 }];
    const { ponte, relatos } = ponteFalsa(lista, () => aceita);
    ponte.desfazeres = vi.fn(async () => (aceita ? [] : [{ turnoId: T, pastaDoBot: "Bot", forcar: [], tentativa: 1 }]));
    const desfazer = vi.fn(async () => ({ arquivos: [{ caminho: "~/a", desfecho: "voltou" as const }] }));
    const d = iniciarDesfazeres({ ponte: ponte as never, pessoaId: P, machineId: M, home: "/tmp/nada", intervaloMs: 60_000, desfazer: desfazer as never });
    await vi.waitFor(() => expect(relatos).toHaveLength(1));
    await d.passada();
    expect(desfazer).toHaveBeenCalledTimes(1);
    expect(relatos).toHaveLength(2);
    aceita = true;
    await d.passada();
    d.parar();
    expect(relatos).toHaveLength(3);
    expect(desfazer).toHaveBeenCalledTimes(1);
  });

  it("acima do teto vão os que pedem atenção primeiro", async () => {
    const { ponte, relatos } = ponteFalsa([{ turnoId: T, pastaDoBot: "Bot", forcar: [], tentativa: 1 }]);
    const arquivos = [...Array.from({ length: TETO_RELATO + 5 }, (_, i) => ({ caminho: `~/v${i}`, desfecho: "voltou" as const })), { caminho: "~/c", desfecho: "conflito" as const }];
    const d = iniciarDesfazeres({ ponte: ponte as never, pessoaId: P, machineId: M, home: "/tmp/nada", intervaloMs: 60_000, desfazer: (async () => ({ arquivos })) as never });
    await vi.waitFor(() => expect(relatos).toHaveLength(1));
    d.parar();
    expect(relatos[0]!.resultado!.arquivos).toHaveLength(TETO_RELATO);
    expect(relatos[0]!.resultado!.arquivos[0]).toEqual({ caminho: "~/c", desfecho: "conflito" });
  });

  it("ocupado (um turno aberto na pasta): só o sinal de vida, no máximo um por minuto; roda na passada seguinte (revisão A1, revisão 3 M2)", async () => {
    const pedido = { turnoId: T, pastaDoBot: "Bot", forcar: [], tentativa: 1 };
    const { ponte, relatos } = ponteFalsa([]);
    ponte.desfazeres = vi.fn(async () => [pedido]);
    let ocupado = true;
    let relogio = 1_000_000;
    const desfazer = vi.fn(async () => (ocupado ? "ocupado" as const : { arquivos: [{ caminho: "~/a", desfecho: "voltou" as const }] }));
    const d = iniciarDesfazeres({ ponte: ponte as never, pessoaId: P, machineId: M, home: "/tmp/nada", intervaloMs: 60_000, desfazer: desfazer as never, agora: () => relogio });
    await vi.waitFor(() => expect(desfazer).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(relatos).toHaveLength(1));
    expect(relatos[0]).toEqual({ turnoId: T, tentativa: 1, feitos: 0, total: 0 });
    relogio += SINAL_A_CADA_MS - 1;
    await d.passada();
    expect(relatos).toHaveLength(1);
    relogio += 1;
    await d.passada();
    expect(relatos).toHaveLength(2);
    relatos.length = 0;
    ocupado = false;
    await d.passada();
    d.parar();
    expect(relatos).toHaveLength(1);
    expect(relatos[0]).toMatchObject({ turnoId: T, tentativa: 1, resultado: { arquivos: [{ caminho: "~/a", desfecho: "voltou" }] } });
  });

  it("o pendente de uma tentativa velha não segura a nova (revisão A3)", async () => {
    let aceita = false;
    let tentativa = 1;
    const { ponte, relatos } = ponteFalsa([], () => aceita);
    ponte.desfazeres = vi.fn(async () => [{ turnoId: T, pastaDoBot: "Bot", forcar: [], tentativa }]);
    const desfazer = vi.fn(async () => ({ arquivos: [{ caminho: "~/a", desfecho: "voltou" as const }] }));
    const d = iniciarDesfazeres({ ponte: ponte as never, pessoaId: P, machineId: M, home: "/tmp/nada", intervaloMs: 60_000, desfazer: desfazer as never });
    await vi.waitFor(() => expect(desfazer).toHaveBeenCalledTimes(1));
    tentativa = 2;
    aceita = true;
    await d.passada();
    d.parar();
    expect(desfazer).toHaveBeenCalledTimes(2);
    expect(relatos.at(-1)).toMatchObject({ tentativa: 2 });
  });

  it("caminho que o servidor recusaria vai como marcador: o relato não fica preso (revisão M1)", async () => {
    const { ponte, relatos } = ponteFalsa([{ turnoId: T, pastaDoBot: "Bot", forcar: [], tentativa: 1 }]);
    const d = iniciarDesfazeres({ ponte: ponte as never, pessoaId: P, machineId: M, home: "/tmp/nada", intervaloMs: 60_000, desfazer: (async () => ({ arquivos: [{ caminho: "~/nod/Bot/a\u0007b", desfecho: "voltou" as const }, { caminho: "~/ok", desfecho: "voltou" as const }] })) as never });
    await vi.waitFor(() => expect(relatos).toHaveLength(1));
    d.parar();
    expect(relatos[0]!.resultado!.arquivos.map((a) => a.caminho)).toEqual([CAMINHO_ILEGIVEL, "~/ok"]);
  });

  it("ponte sem desfazeres (servidor antigo): nada roda", async () => {
    const desfazer = vi.fn();
    const d = iniciarDesfazeres({ ponte: {} as never, pessoaId: P, machineId: M, home: "/tmp/nada", intervaloMs: 60_000, desfazer: desfazer as never });
    await d.passada();
    d.parar();
    expect(desfazer).not.toHaveBeenCalled();
  });
});
