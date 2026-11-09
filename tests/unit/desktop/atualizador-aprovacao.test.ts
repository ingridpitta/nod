import { afterEach, describe, expect, it } from "vitest";
import { compararVersoes } from "../../../src/adapters/executor/flag-floors.ts";
import type { AtualizacaoDaIa } from "../../../src/contracts/estado-ia.ts";
import { criarAtualizadorDeIas, diaLocal, MAX_RECUSAS_DIA, type DiscoAtualizacoes, type FimDoPasso, type PassoAtualizar } from "../../../desktop/atualizador-ias.ts";
import { cabeAprovacao } from "../../../desktop/elevar-mac.ts";

/**
 * O orquestrador com os três passos do clique, montados como no desktop/main.ts (NOD-9 PR3): oficial, reserva e a
 * janela de senha, que só cabe depois de oficial=sem_permissao e reserva=sem_permissao|sem_npm, com a janela em foco.
 */
const T0 = 1_800_000_000_000;
const fim = (resultado: FimDoPasso["resultado"], depois = "2.1.200"): FimDoPasso => ({ resultado, antes: "2.1.200", depois, atende: compararVersoes(depois, "2.1.300") >= 0 });

function mac(o: { oficial?: FimDoPasso; reserva?: FimDoPasso; aprovacao?: FimDoPasso; foco?: boolean; disco?: unknown } = {}) {
  const s = {
    versao: "2.1.200",
    foco: o.foco ?? true,
    chamadas: [] as string[],
    elevados: [] as string[],
    fases: [] as (AtualizacaoDaIa["fase"] | null)[],
    gravados: [] as DiscoAtualizacoes[],
    agora: T0,
  };
  const passo = (tipo: PassoAtualizar["tipo"], r: FimDoPasso): PassoAtualizar => ({
    tipo,
    rodar: async () => {
      s.chamadas.push(tipo);
      if (tipo === "aprovacao") s.elevados.push("/usr/local/bin/claude update");
      if (r.atende && r.depois) s.versao = r.depois;
      return r;
    },
  });
  const a = criarAtualizadorDeIas({
    binario: async (ia) => (ia === "claude-cli" ? { versao: s.versao, origem: "path" } : { versao: null, origem: null }),
    piso: () => "2.1.300",
    comparar: compararVersoes,
    turnos: () => 0,
    emLigacao: () => false,
    passos: (_ia, gatilho) => {
      const base = [passo("oficial", o.oficial ?? fim("sem_permissao")), passo("reserva", o.reserva ?? fim("sem_permissao"))];
      if (gatilho !== "clique") return base;
      return [...base, { ...passo("aprovacao", o.aprovacao ?? fim("ok", "2.1.310")), cabe: (ant) => cabeAprovacao(ant) && s.foco }];
    },
    depois: () => undefined,
    aoMudar: (ia, x) => { if (ia === "claude-cli") s.fases.push(x?.fase ?? null); },
    ler: async () => o.disco,
    gravar: async (d) => { s.gravados.push(d); },
    agora: () => s.agora,
    hoje: diaLocal,
    agendar: () => ({ cancelar: () => undefined }),
    registrar: () => undefined,
  });
  return { s, a };
}

describe("atualizador + janela de senha (NOD-9 PR3)", () => {
  it("no automático a janela de senha nunca abre", async () => {
    const { s, a } = mac();
    await a.verificar();
    expect(s.chamadas).toEqual(["oficial", "reserva"]);
    expect(s.elevados).toEqual([]);
    expect(a.estado("claude-cli")).toMatchObject({ fase: "falhou", motivo: "sem_permissao" });
  });

  it("clique com oficial e reserva sem permissão: pede a senha e termina em sucesso pelo caminho aprovacao", async () => {
    const { s, a } = mac();
    await a.atualizar("claude-cli");
    expect(s.chamadas).toEqual(["oficial", "reserva", "aprovacao"]);
    expect(s.fases).toContain("pedindo_aprovacao");
    expect(a.estado("claude-cli")).toMatchObject({ fase: "sucesso", caminho: "aprovacao", depois: "2.1.310" });
  });

  it("a reserva sem npm também leva à janela de senha", async () => {
    const { s, a } = mac({ reserva: fim("sem_npm") });
    await a.atualizar("claude-cli");
    expect(s.chamadas).toEqual(["oficial", "reserva", "aprovacao"]);
  });

  it("a reserva resolveu: não pede senha", async () => {
    const { s, a } = mac({ reserva: fim("ok", "2.1.305") });
    await a.atualizar("claude-cli");
    expect(s.chamadas).toEqual(["oficial", "reserva"]);
    expect(a.estado("claude-cli")).toMatchObject({ fase: "sucesso", caminho: "reserva" });
  });

  it("a reserva sem internet: não pede senha e cai em falhou", async () => {
    const { s, a } = mac({ reserva: fim("sem_internet") });
    await a.atualizar("claude-cli");
    expect(s.elevados).toEqual([]);
    expect(a.estado("claude-cli")).toMatchObject({ fase: "falhou", motivo: "sem_internet" });
  });

  it("sem a janela do nod em foco: não pede senha", async () => {
    const { s, a } = mac({ foco: false });
    await a.atualizar("claude-cli");
    expect(s.elevados).toEqual([]);
    expect(a.estado("claude-cli")).toMatchObject({ fase: "falhou", motivo: "sem_permissao" });
  });

  it("recusou: fica em recusou, sem 2ª tentativa; com 2 recusas no dia a janela some até amanhã", async () => {
    const { s, a } = mac({ aprovacao: fim("recusou") });
    await a.atualizar("claude-cli");
    expect(s.chamadas.filter((c) => c === "aprovacao")).toHaveLength(1);
    expect(a.estado("claude-cli")).toMatchObject({ fase: "falhou", motivo: "recusou", caminho: "aprovacao" });
    await a.atualizar("claude-cli");
    expect(s.elevados).toHaveLength(MAX_RECUSAS_DIA);
    expect(s.gravados.at(-1)?.ias["claude-cli"]?.recusas).toEqual({ dia: diaLocal(T0), n: 2 });
    await a.atualizar("claude-cli");
    expect(s.elevados).toHaveLength(MAX_RECUSAS_DIA);
    expect(a.estado("claude-cli")).toMatchObject({ fase: "falhou", motivo: "sem_permissao", caminho: "reserva" });
    // no dia seguinte, volta a caber.
    s.agora += 24 * 60 * 60 * 1000;
    await a.atualizar("claude-cli");
    expect(s.elevados).toHaveLength(MAX_RECUSAS_DIA + 1);
  });

  it("as recusas do dia sobrevivem ao reinício (vêm do disco)", async () => {
    const dia = diaLocal(T0);
    const { s, a } = mac({ disco: { v: 1, ias: { "claude-cli": { registro: null, precisaDesde: null, ultimo: null, recusas: { dia, n: 2 } } } } });
    await a.carregar();
    await a.atualizar("claude-cli");
    expect(s.elevados).toEqual([]);
  });

  describe("o dia é o da pessoa (fuso local), não o do UTC", () => {
    const tz = process.env.TZ;
    afterEach(() => { if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz; });

    it("diaLocal segue o fuso: 22:00 em São Paulo ainda é hoje, mesmo já sendo amanhã em UTC", () => {
      process.env.TZ = "America/Sao_Paulo";
      expect(diaLocal(Date.parse("2026-10-22T22:00:00-03:00"))).toBe("2026-10-22");
      expect(new Date(Date.parse("2026-10-22T22:00:00-03:00")).toISOString().slice(0, 10)).toBe("2026-10-23");
    });

    it("recusas às 20:00 e às 22:00 de São Paulo (dias UTC diferentes) somam 2 e a 3ª janela não abre", async () => {
      process.env.TZ = "America/Sao_Paulo";
      const { s, a } = mac({ aprovacao: fim("recusou") });
      s.agora = Date.parse("2026-10-22T20:00:00-03:00");
      await a.atualizar("claude-cli");
      s.agora = Date.parse("2026-10-22T22:00:00-03:00");
      await a.atualizar("claude-cli");
      expect(s.elevados).toHaveLength(MAX_RECUSAS_DIA);
      expect(s.gravados.at(-1)?.ias["claude-cli"]?.recusas).toEqual({ dia: "2026-10-22", n: 2 });
      s.agora = Date.parse("2026-10-22T23:30:00-03:00");
      await a.atualizar("claude-cli");
      expect(s.elevados).toHaveLength(MAX_RECUSAS_DIA);
      // meia-noite local: volta a caber.
      s.agora = Date.parse("2026-10-23T00:05:00-03:00");
      await a.atualizar("claude-cli");
      expect(s.elevados).toHaveLength(MAX_RECUSAS_DIA + 1);
    });
  });
});
