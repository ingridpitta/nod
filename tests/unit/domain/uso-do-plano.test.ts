import { describe, expect, it } from "vitest";
import type { EventoStream } from "../../../src/contracts/turno.ts";
import type { UsoDoPlano } from "../../../src/contracts/uso-do-plano.ts";
import { estadoDoMedidor, LIMIAR_ALERTA, ultimoUsoDoPlano, usoDoPlanoValido } from "../../../src/domain/uso-do-plano.ts";

const AGORA = Date.UTC(2026, 9, 6, 12, 0); // 06/10/2026 12:00 UTC
const HORA = 3_600_000;

function rl(status: string, cinco: number | null, sete: number | null, renova: number | null = AGORA + 2 * HORA): EventoStream {
  return { tipo: "rate_limit", status, utilizacaoCincoHoras: cinco, utilizacaoSeteDias: sete, renovaCincoHorasEm: renova, renovaSeteDiasEm: renova };
}

function uso(utilizacao: number, renovaEm: number | null = AGORA + 2 * HORA): UsoDoPlano {
  return { harness: "claude-cli", situacao: "normal", cincoHoras: { utilizacao, renovaEm }, semana: null, medidoEm: AGORA - 1000 };
}

describe("ultimoUsoDoPlano", () => {
  it("vale o último de três eventos, com o instante dele", () => {
    const eventos: EventoStream[] = [rl("allowed", 0.1, 0.01), { tipo: "delta", texto: "oi" }, rl("allowed", 0.2, 0.02), rl("allowed_warning", 0.85, 0.3), { tipo: "delta", texto: "fim" }];
    const u = ultimoUsoDoPlano(eventos, "claude-cli", (i) => 1000 + i);
    expect(u).toEqual({
      harness: "claude-cli",
      situacao: "perto",
      cincoHoras: { utilizacao: 0.85, renovaEm: AGORA + 2 * HORA },
      semana: { utilizacao: 0.3, renovaEm: AGORA + 2 * HORA },
      medidoEm: 1003,
    });
  });

  it("sem rate_limit não há uso; status desconhecido e janela sem número viram desconhecida e null", () => {
    expect(ultimoUsoDoPlano([{ tipo: "delta", texto: "x" }], "claude-cli", () => 1)).toBeUndefined();
    expect(ultimoUsoDoPlano([rl("algo_novo", null, 0.5)], "claude-cli", () => 1)).toMatchObject({ situacao: "desconhecida", cincoHoras: null, semana: { utilizacao: 0.5 } });
    expect(ultimoUsoDoPlano([rl("rejected", 1, 0.4)], "claude-cli", () => 1)?.situacao).toBe("esgotado");
  });

  it("status com nome de propriedade do Object vira desconhecida e a leitura continua válida (QA NOD-179)", () => {
    for (const status of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      const u = ultimoUsoDoPlano([rl(status, 0.5, 0.2)], "claude-cli", () => AGORA);
      expect(u?.situacao).toBe("desconhecida");
      // Ida e volta pelo JSON da ponte: antes a situação virava função/objeto e o servidor descartava a leitura inteira.
      expect(usoDoPlanoValido(JSON.parse(JSON.stringify(u)), AGORA)).toMatchObject({ situacao: "desconhecida", cincoHoras: { utilizacao: 0.5 } });
    }
  });
});

describe("estadoDoMedidor", () => {
  it("faixas: 0.79 normal, 0.80 perto, 0.90 alerta (NOD-12), 1.2 limite atingido (nunca percentual negativo)", () => {
    expect(LIMIAR_ALERTA).toBe(0.9);
    expect(estadoDoMedidor(uso(0.79), AGORA).cincoHoras).toMatchObject({ faixa: "normal", restamPct: 21 });
    expect(estadoDoMedidor(uso(0.8), AGORA).cincoHoras).toMatchObject({ faixa: "perto", restamPct: 20 });
    expect(estadoDoMedidor(uso(0.89), AGORA).cincoHoras).toMatchObject({ faixa: "perto", restamPct: 11 });
    expect(estadoDoMedidor(uso(0.9), AGORA).cincoHoras).toMatchObject({ faixa: "alerta", restamPct: 10 });
    expect(estadoDoMedidor(uso(0.95), AGORA).cincoHoras).toMatchObject({ faixa: "alerta", restamPct: 5 });
    const limite = estadoDoMedidor(uso(1.2), AGORA).cincoHoras;
    expect(limite).toMatchObject({ faixa: "limite", restamPct: 0 });
    expect(limite?.texto).toMatch(/^Limite atingido/);
    expect(limite?.texto).not.toMatch(/-\d/);
  });

  it("depois do renovaEm: 'Renovou às HH:MM' sem percentual", () => {
    const e = estadoDoMedidor(uso(0.9, AGORA - HORA), AGORA, "UTC").cincoHoras;
    expect(e).toEqual({ faixa: "renovado", restamPct: null, renovaEm: AGORA - HORA, texto: "Renovou às 11:00; o número volta no próximo trabalho" });
    expect(e?.texto).not.toMatch(/%/);
  });

  it("aplica o fuso da pessoa na hora e no dia", () => {
    expect(estadoDoMedidor(uso(0.5), AGORA, "UTC").cincoHoras?.texto).toBe("Restam 50% · renova às 14:00");
    expect(estadoDoMedidor(uso(0.5), AGORA, "America/Sao_Paulo").cincoHoras?.texto).toBe("Restam 50% · renova às 11:00");
    expect(estadoDoMedidor(uso(0.5, AGORA + 3 * 24 * HORA), AGORA, "America/Sao_Paulo").cincoHoras?.texto).toBe("Restam 50% · renova em 09/10 às 09:00");
    expect(estadoDoMedidor(uso(0.5, null), AGORA).cincoHoras?.texto).toBe("Restam 50%");
  });

  it("janela não informada fica null e nenhum texto vaza rate_limit, allowed ou rejected", () => {
    const textos: string[] = [];
    for (const u of [0, 0.5, 0.79, 0.8, 0.95, 1, 1.2, 1.5]) {
      for (const renova of [AGORA - HORA, AGORA + HORA, AGORA + 5 * 24 * HORA, null]) {
        const e = estadoDoMedidor(uso(u, renova), AGORA, "America/Sao_Paulo");
        expect(e.semana).toBeNull();
        textos.push(e.cincoHoras!.texto);
      }
    }
    for (const t of textos) expect(t).not.toMatch(/rate_limit|allowed|rejected|NaN|undefined/i);
  });
});

describe("usoDoPlanoValido", () => {
  const bom = { harness: "claude-cli", situacao: "normal", cincoHoras: { utilizacao: 0.1, renovaEm: AGORA + HORA }, semana: { utilizacao: 0.03, renovaEm: AGORA + 3 * 24 * HORA }, medidoEm: AGORA - 5000 };

  it("aceita o formato bom e janelas nulas", () => {
    expect(usoDoPlanoValido(bom, AGORA)).toEqual(bom);
    expect(usoDoPlanoValido({ ...bom, cincoHoras: null, semana: { utilizacao: 0.2, renovaEm: null } }, AGORA)).toMatchObject({ cincoHoras: null, semana: { renovaEm: null } });
  });

  it("utilização NaN, −1 ou 5 é descartada", () => {
    for (const utilizacao of [Number.NaN, -1, 5, Number.POSITIVE_INFINITY, "0.5"]) {
      expect(usoDoPlanoValido({ ...bom, cincoHoras: { utilizacao, renovaEm: null } }, AGORA)).toBeUndefined();
    }
  });

  it("datas absurdas, harness e situação fora da lista e formato errado são descartados", () => {
    expect(usoDoPlanoValido({ ...bom, medidoEm: AGORA - 8 * 24 * HORA }, AGORA)).toBeUndefined();
    expect(usoDoPlanoValido({ ...bom, medidoEm: AGORA + HORA }, AGORA)).toBeUndefined();
    expect(usoDoPlanoValido({ ...bom, cincoHoras: { utilizacao: 0.1, renovaEm: AGORA + 30 * 24 * HORA } }, AGORA)).toBeUndefined();
    expect(usoDoPlanoValido({ ...bom, cincoHoras: { utilizacao: 0.1, renovaEm: 1789537800 } }, AGORA)).toBeUndefined(); // em segundos
    expect(usoDoPlanoValido({ ...bom, harness: "gemini" }, AGORA)).toBeUndefined();
    expect(usoDoPlanoValido({ ...bom, situacao: "allowed" }, AGORA)).toBeUndefined();
    expect(usoDoPlanoValido({ ...bom, semana: [] }, AGORA)).toBeUndefined();
    expect(usoDoPlanoValido(null, AGORA)).toBeUndefined();
    expect(usoDoPlanoValido("x", AGORA)).toBeUndefined();
  });

  it("relógio do Mac um pouco adiantado: aceito e limitado ao agora do servidor", () => {
    expect(usoDoPlanoValido({ ...bom, medidoEm: AGORA + 5 * 60_000 }, AGORA)?.medidoEm).toBe(AGORA);
  });
});
