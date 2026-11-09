import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { definirDestinoDoLog } from "../../../src/obs/log.ts";
import { iniciarScheduler, type OpcoesTick } from "../../../src/adapters/fundo/scheduler-rotina.ts";
import { iniciarVarredorLease } from "../../../src/adapters/fundo/varredor-lease.ts";
import { criarBatimentos, criarRotaSaude, criarVerificacaoSaude } from "../../../src/adapters/http/rotas/saude.ts";
import type { CtxPublico } from "../../../src/adapters/http/roteador.ts";
import { iniciarWatchdog, INTERVALO_WATCHDOG_MS } from "../../../src/adapters/http/watchdog.ts";
import type { Db } from "../../../src/shared/types.ts";

/**
 * NOD-267, critério 2 e o "tick travado" pedido no lugar do `kill -STOP`: o tick pendurado (aqui, `listarPessoas` que
 * nunca resolve — é o que o pool esgotado faz com o laço) não bate; a saúde vira 503 e o watchdog sai com 1. E o erro
 * solto do varredor de lease: um tick que lança bate, loga e não vira unhandledRejection.
 */

const SEM_BANCO = {} as Db;
const nunca = () => new Promise<never>(() => undefined);
// executor, services e useCases não são tocados: as pessoas nunca chegam (ou chegam vazias).
const opcoesTick = (intervaloMs: number, aoBater: () => void): OpcoesTick & { intervaloMs: number; aoBater: () => void } => ({
  machineId: "m",
  agora: () => Date.now(),
  intervaloMs,
  aoBater,
  executor: {} as OpcoesTick["executor"],
  services: {} as OpcoesTick["services"],
  useCases: {} as OpcoesTick["useCases"],
});

let logs: { evento: string; laco?: string; motivo?: string }[];
let paradas: (() => void)[];
beforeEach(() => {
  vi.useFakeTimers();
  logs = [];
  paradas = [];
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  definirDestinoDoLog((linha) => logs.push(JSON.parse(linha) as { evento: string }));
});
afterEach(() => {
  for (const p of paradas) p();
  definirDestinoDoLog(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function status(verificar: ReturnType<typeof criarVerificacaoSaude>): Promise<number> {
  let s = 0;
  const ctx: Pick<CtxPublico, "json"> = { json: (st) => { s = st; } };
  await (criarRotaSaude(verificar).handler as (c: Pick<CtxPublico, "json">) => Promise<void>)(ctx);
  return s;
}

describe("NOD-267: batimento dos laços", () => {
  it("agendador com o tick pendurado → batimento não avança → saúde 503 e o watchdog sai com 1", async () => {
    const batimentos = criarBatimentos({ agora: () => Date.now() });
    const verificar = criarVerificacaoSaude({ verificarBanco: async () => 1, batimentos });
    const s = iniciarScheduler(SEM_BANCO, opcoesTick(30_000, batimentos.registrar("agendador", 30_000)), { listarPessoas: nunca });
    paradas.push(() => s.parar());
    const sair = vi.fn();
    const w = iniciarWatchdog({ verificar, sair, agora: () => Date.now(), carenciaAte: 0 });
    paradas.push(() => w.parar());

    await vi.advanceTimersByTimeAsync(90_000); // 1º tick pendurado aos 30 s; os seguintes pulados por `rodando`
    expect(await status(verificar)).toBe(200);
    await vi.advanceTimersByTimeAsync(1);
    expect(await status(verificar)).toBe(503);
    expect(logs).toContainEqual(expect.objectContaining({ evento: "saude_falhou", motivo: "laco_parado:agendador" }));
    expect(sair).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4 * INTERVALO_WATCHDOG_MS);
    expect(sair).toHaveBeenCalledWith(1);
  });

  it("agendador em dia (tick termina) → batimento avança → 200 por muito tempo", async () => {
    const batimentos = criarBatimentos({ agora: () => Date.now() });
    const verificar = criarVerificacaoSaude({ verificarBanco: async () => 1, batimentos });
    const s = iniciarScheduler(SEM_BANCO, opcoesTick(30_000, batimentos.registrar("agendador", 30_000)), { listarPessoas: async () => [] });
    paradas.push(() => s.parar());
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(await status(verificar)).toBe(200);
  });

  it("varredor de lease com o tick pendurado → saúde 503 por laco_parado:varredor_lease, só depois do piso de 60 s", async () => {
    const batimentos = criarBatimentos({ agora: () => Date.now() });
    const verificar = criarVerificacaoSaude({ verificarBanco: async () => 1, batimentos });
    const v = iniciarVarredorLease({ db: SEM_BANCO, intervaloMs: 15_000, opcoes: { listarPessoas: nunca }, aoBater: batimentos.registrar("varredor_lease", 15_000) });
    paradas.push(() => v.parar());
    await vi.advanceTimersByTimeAsync(45_001); // 3 intervalos de 15 s já passaram, mas o piso segura (um tick lento legítimo)
    expect(await status(verificar)).toBe(200);
    await vi.advanceTimersByTimeAsync(60_000 - 45_001);
    expect(await status(verificar)).toBe(200);
    await vi.advanceTimersByTimeAsync(1);
    expect(await status(verificar)).toBe(503);
    expect(logs).toContainEqual(expect.objectContaining({ evento: "saude_falhou", motivo: "laco_parado:varredor_lease" }));
  });

  it("varredor de lease com tick que lança → bate, loga varredor_lease_tick_falhou e não vira unhandledRejection", async () => {
    const soltas: unknown[] = [];
    const aoSoltar = (e: unknown) => soltas.push(e);
    process.on("unhandledRejection", aoSoltar);
    try {
      const batimentos = criarBatimentos({ agora: () => Date.now() });
      const verificar = criarVerificacaoSaude({ verificarBanco: async () => 1, batimentos });
      const v = iniciarVarredorLease({
        db: SEM_BANCO,
        intervaloMs: 15_000,
        opcoes: { listarPessoas: () => Promise.reject(new Error("pool esgotado")) },
        aoBater: batimentos.registrar("varredor_lease", 15_000),
      });
      paradas.push(() => v.parar());
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(await status(verificar)).toBe(200); // o tick que falha também bate: o laço está vivo
      expect(logs.filter((l) => l.evento === "varredor_lease_tick_falhou").length).toBeGreaterThanOrEqual(19);
      // O unhandledRejection sai depois das microtasks: dá voltas REAIS ao event loop antes de conferir.
      v.parar();
      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 20));
      expect(soltas).toEqual([]);
    } finally {
      process.off("unhandledRejection", aoSoltar);
    }
  });

  it("o timer do varredor de lease não segura o processo (unref, como os outros laços)", () => {
    const real = globalThis.setInterval;
    let timer: ReturnType<typeof setInterval> | undefined;
    vi.spyOn(globalThis, "setInterval").mockImplementation(((fn: () => void, ms?: number) => (timer = real(fn, ms))) as typeof setInterval);
    const v = iniciarVarredorLease({ db: SEM_BANCO, intervaloMs: 15_000, opcoes: { listarPessoas: async () => [] } });
    paradas.push(() => v.parar());
    expect(timer?.hasRef()).toBe(false);
  });

  it("tick mais longo que o intervalo → laco_tick_lento no log", async () => {
    let soltar: (v: { tenantId: string; id: string }[]) => void = () => undefined;
    const s = iniciarScheduler(SEM_BANCO, opcoesTick(30_000, () => undefined), { listarPessoas: () => new Promise((r) => { soltar = r; }) });
    paradas.push(() => s.parar());
    await vi.advanceTimersByTimeAsync(30_000 + 45_000);
    soltar([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(logs).toContainEqual(expect.objectContaining({ evento: "laco_tick_lento", laco: "agendador" }));
  });

  it("NOD-218: parar() do agendador e do varredor de lease espera o tick em voo terminar", async () => {
    let soltarS: (v: { tenantId: string; id: string }[]) => void = () => undefined;
    let soltarV: (v: { tenantId: string; id: string }[]) => void = () => undefined;
    const s = iniciarScheduler(SEM_BANCO, opcoesTick(30_000, () => undefined), { listarPessoas: () => new Promise((r) => { soltarS = r; }) });
    const v = iniciarVarredorLease({ db: SEM_BANCO, intervaloMs: 15_000, opcoes: { listarPessoas: () => new Promise((r) => { soltarV = r; }) } });
    await vi.advanceTimersByTimeAsync(30_000);
    let parados = 0;
    void s.parar().then(() => parados++);
    void v.parar().then(() => parados++);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(parados).toBe(0);
    soltarS([]);
    soltarV([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(parados).toBe(2);
  });
});
