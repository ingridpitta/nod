import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { definirDestinoDoLog } from "../../../src/obs/log.ts";
import { criarBatimentos, criarRotaSaude, criarRotaSaudeLb, criarVerificacaoSaude, LACO_PARADO_MINIMO_MS, PRAZO_SAUDE_BANCO_MS, type VerificacaoSaude } from "../../../src/adapters/http/rotas/saude.ts";
import type { CtxPublico } from "../../../src/adapters/http/roteador.ts";

/** NOD-267, critério 1: a saúde olha o banco (com prazo) e o batimento dos laços; o motivo vai só para o log. */

let logs: { evento: string; motivo?: string }[];
beforeEach(() => {
  logs = [];
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  definirDestinoDoLog((linha) => logs.push(JSON.parse(linha) as { evento: string; motivo?: string }));
});
afterEach(() => {
  definirDestinoDoLog(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function pedirSaude(verificar: VerificacaoSaude): Promise<{ status: number; corpo: unknown }> {
  const rota = criarRotaSaude(verificar);
  let saida = { status: 0, corpo: undefined as unknown };
  const ctx: Pick<CtxPublico, "json"> = { json: (status, corpo) => { saida = { status, corpo }; } };
  await (rota.handler as (c: Pick<CtxPublico, "json">) => Promise<void>)(ctx);
  return saida;
}

describe("NOD-267: /api/saude com batimento dos laços", () => {
  it("tudo em dia (banco responde, laços batendo) → 200", async () => {
    let agora = 1_000_000;
    const batimentos = criarBatimentos({ agora: () => agora });
    const baterAgendador = batimentos.registrar("agendador", 30_000);
    const baterVarredor = batimentos.registrar("varredor_lease", 15_000);
    for (let i = 0; i < 10; i++) {
      agora += 15_000;
      baterVarredor();
      if (i % 2) baterAgendador();
    }
    const r = await pedirSaude(criarVerificacaoSaude({ verificarBanco: async () => 1, batimentos }));
    expect(r).toEqual({ status: 200, corpo: { ok: true } });
  });

  it("batimento do agendador velho (> 3 intervalos) → 503 {ok:false}, sem motivo no corpo e sem tocar no banco", async () => {
    let agora = 1_000_000;
    const batimentos = criarBatimentos({ agora: () => agora });
    batimentos.registrar("agendador", 30_000);
    const verificarBanco = vi.fn(async () => 1);
    const verificar = criarVerificacaoSaude({ verificarBanco, batimentos });

    agora += 90_000; // exatamente 3 intervalos: ainda vivo
    expect((await pedirSaude(verificar)).status).toBe(200);

    agora += 1;
    const r = await pedirSaude(verificar);
    expect(r).toEqual({ status: 503, corpo: { ok: false } });
    expect(JSON.stringify(r.corpo)).not.toContain("laco");
    expect(logs).toContainEqual(expect.objectContaining({ evento: "saude_falhou", motivo: "laco_parado:agendador" }));
    expect(verificarBanco).toHaveBeenCalledTimes(1); // só na primeira, a saudável
  });

  it("`select 1` acima de 2 s → 503 no prazo", async () => {
    vi.useFakeTimers();
    const verificar = criarVerificacaoSaude({ verificarBanco: () => new Promise(() => undefined) });
    const pedido = pedirSaude(verificar);
    await vi.advanceTimersByTimeAsync(PRAZO_SAUDE_BANCO_MS - 1);
    let pronto = false;
    void pedido.then(() => { pronto = true; });
    await Promise.resolve();
    expect(pronto).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pedido).toEqual({ status: 503, corpo: { ok: false } });
    expect(logs).toContainEqual(expect.objectContaining({ evento: "saude_falhou", motivo: "prazo" }));
  });

  it("banco com erro → 503; o batimento que volta a bater devolve o 200", async () => {
    let agora = 0;
    const batimentos = criarBatimentos({ agora: () => agora });
    const bater = batimentos.registrar("varredor_lease", 15_000);
    let bancoOk = false;
    const verificar = criarVerificacaoSaude({ verificarBanco: async () => { if (!bancoOk) throw new Error("senha: segredo"); }, batimentos });
    expect((await pedirSaude(verificar)).status).toBe(503);
    expect(logs.at(-1)).toEqual(expect.objectContaining({ evento: "saude_falhou", motivo: "erro" }));
    bancoOk = true;
    agora = LACO_PARADO_MINIMO_MS + 1; // 4 intervalos de 15 s, acima do piso de 60 s
    expect((await pedirSaude(verificar)).status).toBe(503);
    bater();
    expect((await pedirSaude(verificar)).status).toBe(200);
  });

  it("sem batimentos (modo local) o laço não entra na conta: só o banco", async () => {
    // O boot só passa `batimentos` no compartilhado; aqui a verificação do modo local, com o banco em dia.
    const verificar = criarVerificacaoSaude({ verificarBanco: async () => 1 });
    expect((await pedirSaude(verificar)).status).toBe(200);
  });

  it("piso de laço parado: laço de 15 s só é dado como parado depois de 60 s, não de 45 s", async () => {
    expect(LACO_PARADO_MINIMO_MS).toBe(60_000);
    let agora = 0;
    const batimentos = criarBatimentos({ agora: () => agora });
    batimentos.registrar("varredor_lease", 15_000);
    agora = 45_001;
    expect(batimentos.parado()).toBeNull();
    agora = 60_000;
    expect(batimentos.parado()).toBeNull();
    agora = 60_001;
    expect(batimentos.parado()).toBe("varredor_lease");
  });

  it("soltar tira o laço da conta (o batimento do boot, quando o boot termina)", () => {
    let agora = 0;
    const batimentos = criarBatimentos({ agora: () => agora, minimoMs: 0 });
    batimentos.registrar("boot", 1_000);
    agora = 3_001;
    expect(batimentos.parado()).toBe("boot");
    batimentos.soltar("boot");
    expect(batimentos.parado()).toBeNull();
  });

  it("`select 1` que estourou o prazo não empilha outro: a próxima verificação espera o mesmo, e ele de volta → 200", async () => {
    vi.useFakeTimers();
    let soltar: () => void = () => undefined;
    const verificarBanco = vi.fn(() => new Promise<void>((r) => { soltar = r; }));
    const verificar = criarVerificacaoSaude({ verificarBanco });
    for (let i = 0; i < 3; i++) {
      const v = verificar();
      await vi.advanceTimersByTimeAsync(PRAZO_SAUDE_BANCO_MS);
      expect(await v).toBe("prazo");
    }
    expect(verificarBanco).toHaveBeenCalledTimes(1);
    const v = verificar();
    soltar();
    expect(await v).toBeNull();
    const depois = verificar();
    await vi.advanceTimersByTimeAsync(0);
    expect(verificarBanco).toHaveBeenCalledTimes(2); // voltou: a seguinte abre outro
    soltar();
    expect(await depois).toBeNull();
  });

  it("chamadas simultâneas (rota + watchdog) compartilham o `select 1` em voo", async () => {
    let soltar: () => void = () => undefined;
    const verificarBanco = vi.fn(() => new Promise<void>((r) => { soltar = r; }));
    const verificar = criarVerificacaoSaude({ verificarBanco });
    const a = verificar();
    const b = verificar();
    await Promise.resolve();
    soltar();
    expect(await Promise.all([a, b])).toEqual([null, null]);
    expect(verificarBanco).toHaveBeenCalledTimes(1);
  });
});

describe("NOD-218: /api/saude e /api/saude/lb com o estado do processo (azul/verde)", () => {
  type Estado = { pronto: boolean; ativa: boolean; drenando: boolean };
  function estadoDe(e: Estado, cor: string | null = "azul") {
    return { pronto: () => e.pronto, ativa: () => e.ativa, drenando: () => e.drenando, cor };
  }
  async function chamar(rota: ReturnType<typeof criarRotaSaude>): Promise<{ status: number; corpo: unknown }> {
    let saida = { status: 0, corpo: undefined as unknown };
    const ctx: Pick<CtxPublico, "json"> = { json: (status, corpo) => { saida = { status, corpo }; } };
    await (rota.handler as (c: Pick<CtxPublico, "json">) => Promise<void>)(ctx);
    return saida;
  }

  it("lb: 200 {ok,cor} só com pronto && ativa && !drenando && banco ok", async () => {
    const e = { pronto: true, ativa: true, drenando: false };
    const verificar = vi.fn<VerificacaoSaude>(async () => null);
    const lb = criarRotaSaudeLb(verificar, estadoDe(e));
    expect(lb.padrao.test("/saude/lb")).toBe(true);
    expect(await chamar(lb)).toEqual({ status: 200, corpo: { ok: true, cor: "azul" } });
  });

  it("lb: boot, drenando e inativa → 503 com o motivo no corpo, sem chamar o banco", async () => {
    const verificar = vi.fn<VerificacaoSaude>(async () => null);
    const casos: Array<[Estado, string]> = [
      [{ pronto: false, ativa: true, drenando: false }, "boot"],
      [{ pronto: true, ativa: true, drenando: true }, "drenando"],
      [{ pronto: true, ativa: false, drenando: false }, "inativa"],
    ];
    for (const [e, motivo] of casos) {
      expect(await chamar(criarRotaSaudeLb(verificar, estadoDe(e, "verde")))).toEqual({ status: 503, corpo: { ok: false, cor: "verde", motivo } });
    }
    expect(verificar).not.toHaveBeenCalled();
  });

  it("lb: banco fora → 503 motivo indisponivel (sem detalhe do banco no corpo)", async () => {
    const lb = criarRotaSaudeLb(async () => "prazo", estadoDe({ pronto: true, ativa: true, drenando: false }));
    expect(await chamar(lb)).toEqual({ status: 503, corpo: { ok: false, cor: "azul", motivo: "indisponivel" } });
    expect(logs).toContainEqual(expect.objectContaining({ evento: "saude_falhou", motivo: "prazo" }));
  });

  it("/api/saude: 503 no boot e na drenagem, mas a cor passiva (inativa) é saudável", async () => {
    const e = { pronto: false, ativa: false, drenando: false };
    const rota = criarRotaSaude(async () => null, estadoDe(e));
    expect(await chamar(rota)).toEqual({ status: 503, corpo: { ok: false } });
    e.pronto = true;
    expect(await chamar(rota)).toEqual({ status: 200, corpo: { ok: true } });
    e.drenando = true;
    expect(await chamar(rota)).toEqual({ status: 503, corpo: { ok: false } });
  });

  it("saude_falhou por estado sai uma vez por mudança (o Caddy bate a cada 1 s)", async () => {
    const e = { pronto: true, ativa: false, drenando: false };
    const lb = criarRotaSaudeLb(async () => null, estadoDe(e));
    for (let i = 0; i < 5; i++) await chamar(lb);
    expect(logs.filter((l) => l.evento === "saude_falhou")).toEqual([expect.objectContaining({ motivo: "inativa" })]);
    e.ativa = true;
    await chamar(lb);
    e.drenando = true;
    await chamar(lb);
    await chamar(lb);
    expect(logs.filter((l) => l.evento === "saude_falhou").map((l) => l.motivo)).toEqual(["inativa", "drenando"]);
  });
});
