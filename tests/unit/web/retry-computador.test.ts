import { describe, expect, it, vi } from "vitest";
import { mascararDormindo, RetryDoAcordar, SEM_SERVIDOR, type PassosDoRetry } from "../../../web/lib/retry-computador.ts";
import { ErroApi } from "../../../web/lib/erro-api.ts";

/** NOD-407 (critério 3): ocupado/atualizando repete sozinho com 2, 4, 8, 16 s; clique novo mata a cadeia; o fim vira recusa sutil. */
type Agendado = { f: () => void; ms: number; id: number };
function relogio() {
  const fila: Agendado[] = [];
  let n = 0;
  return {
    fila,
    setTimeout: (f: () => void, ms: number) => { fila.push({ f, ms, id: ++n }); return n; },
    clearTimeout: (id: number) => { const i = fila.findIndex((a) => a.id === id); if (i >= 0) fila.splice(i, 1); },
    async disparar() { const a = fila.shift()!; a.f(); await new Promise((r) => setTimeout(r, 0)); return a.ms; },
  };
}
const erro = (status: number, mensagem: string, motivo: string) => Object.assign(new ErroApi(status, "estado_invalido", mensagem), { motivo });
const ocupado = () => erro(409, "Uma ação anterior ainda está terminando.", "ocupado");
const passos = (tentar: () => Promise<unknown>) => {
  const p = { tentar: vi.fn(tentar), ler: vi.fn(async () => undefined), recusar: vi.fn((_t: string) => undefined) };
  return p satisfies PassosDoRetry;
};

describe("RetryDoAcordar", () => {
  it("repete enquanto é transitório, com espera crescente, e para no teto com a recusa sutil (nunca o banner)", async () => {
    const r = relogio();
    const retry = new RetryDoAcordar(r);
    const p = passos(async () => { throw ocupado(); });
    const cadeia = retry.cancelar();
    expect(retry.esperaPara(ocupado(), 0)).toBeGreaterThanOrEqual(2000);
    retry.agendar(cadeia, 1, 2000, p);
    expect(retry.emCurso).toBe(true);
    const esperas = [r.fila[0]!.ms];
    for (let i = 0; i < 3; i++) { await r.disparar(); esperas.push(r.fila[0]!.ms); }
    expect(esperas[0]).toBe(2000);
    expect(esperas[1]).toBeGreaterThanOrEqual(4000);
    expect(esperas[2]).toBeGreaterThanOrEqual(8000);
    expect(esperas[3]).toBeGreaterThanOrEqual(16000);
    await r.disparar();
    expect(r.fila).toHaveLength(0);
    expect(retry.emCurso).toBe(false);
    expect(p.recusar).toHaveBeenCalledTimes(1);
    expect(p.recusar.mock.calls[0]![0]).toBe("Uma ação anterior ainda está terminando.");
    expect(p.tentar).toHaveBeenCalledTimes(4);
  });

  it("deu certo: para de repetir, sem recusa", async () => {
    const r = relogio();
    const retry = new RetryDoAcordar(r);
    const p = passos(async () => ({ ok: true }));
    retry.agendar(retry.cancelar(), 1, 2000, p);
    await r.disparar();
    expect(r.fila).toHaveLength(0);
    expect(retry.emCurso).toBe(false);
    expect(p.recusar).not.toHaveBeenCalled();
    expect(p.ler).toHaveBeenCalledTimes(1);
  });

  it("erro permanente ou rede: recusa na hora, sem repetir", async () => {
    const r = relogio();
    const retry = new RetryDoAcordar(r);
    const p = passos(async () => { throw new TypeError("rede"); });
    retry.agendar(retry.cancelar(), 1, 2000, p);
    await r.disparar();
    expect(r.fila).toHaveLength(0);
    expect(p.recusar).toHaveBeenCalledWith(SEM_SERVIDOR);
    expect(retry.esperaPara(erro(409, "x", "maquina_sem_contato"), 0)).toBeNull();
    expect(retry.esperaPara(erro(500, "x", "ocupado"), 0)).toBeNull();
  });

  it("clique novo mata a cadeia: o timer cai e a resposta em voo da cadeia velha não mostra nada", async () => {
    const r = relogio();
    const retry = new RetryDoAcordar(r);
    let soltar: (e: unknown) => void = () => undefined;
    const p = passos(() => new Promise((_, rej) => { soltar = rej; }));
    const velha = retry.cancelar();
    retry.agendar(velha, 1, 2000, p);
    r.fila[0]!.f(); // a tentativa sai e fica em voo
    retry.cancelar(); // a pessoa clicou de novo
    expect(retry.emCurso).toBe(false);
    soltar(erro(409, "permanente", "fora_do_ar"));
    await new Promise((res) => setTimeout(res, 0));
    expect(p.recusar).not.toHaveBeenCalled();
    expect(p.ler).not.toHaveBeenCalled();
    expect(r.fila).toHaveLength(0);
    retry.agendar(velha, 2, 4000, p);
    expect(r.fila).toHaveLength(0);
  });
});

describe("mascararDormindo (a aba segue em Acordando… durante o retry)", () => {
  const dormindo = { estado: "dormindo", falha: { motivo: "sem_resposta" } };
  it("com retry em curso, dormindo vira ligando sem falha; sem retry, ou com app desatualizado, fica como veio", () => {
    expect(mascararDormindo(dormindo, true)).toEqual({ estado: "ligando", falha: null });
    expect(mascararDormindo(dormindo, false)).toBe(dormindo);
    const app = { ...dormindo, appDesatualizado: { atual: "1", minima: "2" } };
    expect(mascararDormindo(app, true)).toBe(app);
    const fora = { estado: "fora_do_ar", falha: null };
    expect(mascararDormindo(fora, true)).toBe(fora);
    expect(mascararDormindo(null, true)).toBeNull();
  });
});
