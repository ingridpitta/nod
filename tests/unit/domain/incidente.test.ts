import { describe, expect, it } from "vitest";
import { destinoDaQueda, INCIDENTE_VISIVEL_MS, incidenteVisivel, JANELA_MESCLA_INCIDENTE_MS, juntarQuedas, maquinaVoltou, motivoDaQueda, ultimoSinalDoTurno, type QuedaDeMaquina } from "../../../src/domain/incidente.ts";
import { LEASE_MS, OFFLINE_MS } from "../../../src/shared/constantes.ts";

const H = 3_600_000;
const queda = (extra: Partial<QuedaDeMaquina> = {}): QuedaDeMaquina => ({ perdidoDesde: 10 * H, notadoEm: 11 * H, machineId: "m1", agenteId: "taga", rotina: true, maquinaPresente: true, ...extra });

describe("queda da máquina (ADR-045)", () => {
  it("o último sinal do turno é a última renovação do lease; sem lease, o próprio instante", () => {
    expect(ultimoSinalDoTurno({ leaseAte: 10 * H }, 11 * H)).toBe(10 * H - LEASE_MS);
    expect(ultimoSinalDoTurno({ leaseAte: null }, 11 * H)).toBe(11 * H);
    // Nunca depois de agora (lease no futuro não é queda, mas a conta não pode inventar o futuro).
    expect(ultimoSinalDoTurno({ leaseAte: 12 * H }, 11 * H)).toBe(11 * H);
  });

  it("modo compartilhado: sem sinal desde antes do boot → o SERVIDOR reiniciou; no modo local tudo é o Mac", () => {
    const boot = 10 * H;
    expect(motivoDaQueda({ leaseAte: boot - 1 + LEASE_MS }, 11 * H, boot)).toBe("reinicio_servidor");
    expect(motivoDaQueda({ leaseAte: boot + LEASE_MS }, 11 * H, boot)).toBe("maquina_sem_contato");
    expect(motivoDaQueda({ leaseAte: boot - 1 + LEASE_MS }, 11 * H, null)).toBe("maquina_sem_contato");
  });

  it("a máquina voltou quando puxou há menos que OFFLINE_MS (a régua da presença)", () => {
    expect(maquinaVoltou(1_000, 1_000 + OFFLINE_MS)).toBe(true);
    expect(maquinaVoltou(1_000, 1_001 + OFFLINE_MS)).toBe(false);
    expect(maquinaVoltou(null, 5)).toBe(false);
  });

  it("destino: nada antes → abre; em curso → mescla (mesmo dispensado); fechado até 3 h → mescla; depois → abre", () => {
    expect(destinoDaQueda(null, queda())).toBe("abrir");
    expect(destinoDaQueda({ voltouEm: null, dispensadoEm: null }, queda())).toBe("mesclar");
    expect(destinoDaQueda({ voltouEm: null, dispensadoEm: 1 }, queda())).toBe("mesclar");
    expect(destinoDaQueda({ voltouEm: 10 * H - JANELA_MESCLA_INCIDENTE_MS, dispensadoEm: null }, queda())).toBe("mesclar");
    expect(destinoDaQueda({ voltouEm: 10 * H - JANELA_MESCLA_INCIDENTE_MS - 1, dispensadoEm: null }, queda())).toBe("abrir");
    // Queda que começou ANTES de o aviso fechar (sobreposição) é a mesma ausência.
    expect(destinoDaQueda({ voltouEm: 12 * H, dispensadoEm: null }, queda())).toBe("mesclar");
  });

  it("fechado E dispensado não recebe queda nova: a pessoa já disse 'Entendi' àquele aviso", () => {
    expect(destinoDaQueda({ voltouEm: 10 * H - 60_000, dispensadoEm: 10 * H }, queda())).toBe("abrir");
  });

  it("visível: em curso sempre; fechado até 12 h depois de voltar; dispensado nunca", () => {
    expect(incidenteVisivel({ voltouEm: null, dispensadoEm: null }, 100 * H)).toBe(true);
    expect(incidenteVisivel({ voltouEm: 10 * H, dispensadoEm: null }, 10 * H + INCIDENTE_VISIVEL_MS - 1)).toBe(true);
    expect(incidenteVisivel({ voltouEm: 10 * H, dispensadoEm: null }, 10 * H + INCIDENTE_VISIVEL_MS)).toBe(false);
    expect(incidenteVisivel({ voltouEm: null, dispensadoEm: 5 }, 10 * H)).toBe(false);
  });

  it("juntar quedas de uma varredura: o intervalo que cobre todas, contadores por tipo, agentes sem repetir; voltou só se TODAS as máquinas voltaram", () => {
    expect(juntarQuedas([])).toBeNull();
    const junta = juntarQuedas([queda({ perdidoDesde: 9 * H }), queda({ agenteId: "ada" }), queda({ rotina: false, notadoEm: 12 * H })]);
    expect(junta).toEqual({ perdidoDesde: 9 * H, voltouEm: 12 * H, machineId: "m1", rotinas: 2, conversas: 1, agentes: ["taga", "ada"] });
    expect(juntarQuedas([queda(), queda({ maquinaPresente: false })])?.voltouEm).toBeNull();
  });
});
