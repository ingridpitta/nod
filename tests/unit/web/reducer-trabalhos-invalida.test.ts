import { describe, expect, it } from "vitest";
import type { FrameSse, TipoFrame } from "../../../src/contracts/frame.ts";
import { aplicarFrame, estadoInicial, reduzir } from "../../../web/estado/reducer.ts";
import { criarReleituraAdiada } from "../../../web/lib/releitura-adiada.ts";

/**
 * NOD-260 (definido em 2026-10-15, J1): os frames de turno relêem Trabalhos — antes só `trabalho.mudou` relia, e a tela
 * dizia "trabalhando" de um turno que já tinha acabado. Um lote de frames num segundo vira UMA releitura (a janela de 1 s
 * de web/main.ts); abrir Trabalhos sempre relê.
 */
const C = "11111111-1111-4111-8111-111111111111";
const AGORA = 1_700_000_000_000;
const frame = (tipo: TipoFrame, dados: Record<string, unknown>, seq = 1): FrameSse => ({ streamId: "s", seq, pessoaId: "p", tipo, dados });

describe("J1: frames de turno invalidam trabalhos", () => {
  it("turno.iniciado, turno.encerrado e turno.interrompido marcam 'trabalhos'", () => {
    expect(aplicarFrame(estadoInicial, frame("turno.iniciado", { conversaId: C, turnoId: "t1", kind: "turno_criado" }), AGORA).invalidacoes).toContain("trabalhos");
    expect(aplicarFrame(estadoInicial, frame("turno.encerrado", { conversaId: C, turnoId: "t1" }), AGORA).invalidacoes).toContain("trabalhos");
    expect(aplicarFrame(estadoInicial, frame("turno.interrompido", { conversaId: C, turnoId: "t1", motivo: "parado_pela_pessoa" }), AGORA).invalidacoes).toContain("trabalhos");
  });

  it("o turno da ligação não é trabalho do bot: não relê Trabalhos", () => {
    expect(aplicarFrame(estadoInicial, frame("turno.encerrado", { conversaId: C, turnoId: "t1", modo: "ligacao" }), AGORA).invalidacoes).not.toContain("trabalhos");
    expect(aplicarFrame(estadoInicial, frame("turno.iniciado", { conversaId: C, turnoId: "t1", origem: "ligacao" }), AGORA).invalidacoes).not.toContain("trabalhos");
  });

  it("abrir Trabalhos relê sempre; navegar dentro dela não", () => {
    const aberto = reduzir(estadoInicial, { tipo: "navegar", tela: { tipo: "trabalhos" } });
    expect(aberto.invalidacoes).toContain("trabalhos");
    const lido = { ...aberto, invalidacoes: [] };
    expect(reduzir(lido, { tipo: "navegar", tela: { tipo: "trabalhos" } }).invalidacoes).not.toContain("trabalhos");
  });
});

describe("J1: a releitura adiada (debounce de 1 s)", () => {
  /** Timer falso: guarda as funções agendadas e dispara as vencidas ao andar o relógio. */
  function relogio() {
    let agora = 0;
    const agendadas: { em: number; fn: () => void; viva: boolean }[] = [];
    return {
      agendar: (fn: () => void, ms: number) => {
        const a = { em: agora + ms, fn, viva: true };
        agendadas.push(a);
        return () => {
          a.viva = false;
        };
      },
      andar(ms: number) {
        agora += ms;
        for (const a of agendadas) if (a.viva && a.em <= agora) {
          a.viva = false;
          a.fn();
        }
      },
    };
  }

  it("5 frames em 1 s viram 1 releitura, no fim da janela", () => {
    const r = relogio();
    let releu = 0;
    const adiada = criarReleituraAdiada(1000, r.agendar, () => releu++);
    for (let i = 0; i < 5; i++) {
      adiada.pedir();
      r.andar(150);
    }
    expect(releu).toBe(0);
    expect(adiada.pendente()).toBe(true);
    r.andar(1000);
    expect(releu).toBe(1);
    expect(adiada.pendente()).toBe(false);
  });

  it("frames sem parar ainda relêem uma vez por janela (a janela não recomeça a cada pedido)", () => {
    const r = relogio();
    let releu = 0;
    const adiada = criarReleituraAdiada(1000, r.agendar, () => releu++);
    for (let i = 0; i < 30; i++) {
      adiada.pedir();
      r.andar(100);
    }
    expect(releu).toBe(3);
  });

  it("cancelar fecha a janela sem reler", () => {
    const r = relogio();
    let releu = 0;
    const adiada = criarReleituraAdiada(1000, r.agendar, () => releu++);
    adiada.pedir();
    adiada.cancelar();
    r.andar(5000);
    expect(releu).toBe(0);
  });
});
