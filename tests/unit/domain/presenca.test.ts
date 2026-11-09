import { describe, expect, it } from "vitest";
import { OFFLINE_MS } from "../../../src/shared/constantes.ts";
import { ESPERA_APOS_ACORDAR_MS, INTERVALOS_PARA_ACORDAR, passoDoAgendador, presencaMaquina, processoAcordou } from "../../../src/domain/presenca.ts";

describe("presencaMaquina (derivada do poll, sem heartbeat)", () => {
  it("online dentro da janela, offline depois, nunca_vista sem poll", () => {
    expect(presencaMaquina(1_000, 1_000 + OFFLINE_MS)).toBe("online");
    expect(presencaMaquina(1_000, 1_001 + OFFLINE_MS)).toBe("offline");
    expect(presencaMaquina(null, 5)).toBe("nunca_vista");
  });
});

describe("o agendador depois de o Mac acordar (ADR-045)", () => {
  const INTERVALO = 30_000;

  it("mais de 3 intervalos sem tick é o processo que ficou suspenso; um tick atrasado não é", () => {
    expect(processoAcordou(null, 1_000_000, INTERVALO)).toBe(false);
    expect(processoAcordou(1_000_000, 1_000_000 + INTERVALOS_PARA_ACORDAR * INTERVALO, INTERVALO)).toBe(false);
    expect(processoAcordou(1_000_000, 1_000_001 + INTERVALOS_PARA_ACORDAR * INTERVALO, INTERVALO)).toBe(true);
  });

  it("acordou → não dispara por 3 min, e o relógio anda a cada tick; depois da espera, dispara", () => {
    const t0 = 1_000_000;
    const primeiro = passoDoAgendador({ ultimoTick: null, esperarAte: 0 }, t0, INTERVALO);
    expect(primeiro).toEqual({ estado: { ultimoTick: t0, esperarAte: 0 }, disparar: true, paradoMs: null });
    // O Mac dormiu 2 h: o tick que acorda NÃO dispara e diz quanto ficou parado.
    const acordou = passoDoAgendador(primeiro.estado, t0 + 2 * 3_600_000, INTERVALO);
    expect(acordou).toEqual({ estado: { ultimoTick: t0 + 2 * 3_600_000, esperarAte: t0 + 2 * 3_600_000 + ESPERA_APOS_ACORDAR_MS }, disparar: false, paradoMs: 2 * 3_600_000 });
    // Ticks normais durante a espera continuam sem disparar e não renovam a espera.
    const durante = passoDoAgendador(acordou.estado, t0 + 2 * 3_600_000 + INTERVALO, INTERVALO);
    expect(durante.disparar).toBe(false);
    expect(durante.paradoMs).toBeNull();
    expect(durante.estado.esperarAte).toBe(acordou.estado.esperarAte);
    // Com os ticks normais de 30 s, a espera acaba em 3 min e o agendador volta a disparar.
    let estado = durante.estado;
    let t = t0 + 2 * 3_600_000 + INTERVALO;
    const disparos: boolean[] = [];
    while (t < acordou.estado.esperarAte + INTERVALO) {
      t += INTERVALO;
      const passo = passoDoAgendador(estado, t, INTERVALO);
      estado = passo.estado;
      disparos.push(passo.disparar);
    }
    expect(disparos).toEqual([false, false, false, false, true, true]);
  });
});
