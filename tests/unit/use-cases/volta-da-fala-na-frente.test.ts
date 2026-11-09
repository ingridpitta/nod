import { describe, expect, it } from "vitest";
import type { Turno } from "../../../src/contracts/turno.ts";
import { ENTRADA_DA_VOLTA_DA_COTA, entradaLevadaComPedido, MARCA_DA_FALA_NA_FRENTE, MARCA_DO_PEDIDO_ORIGINAL } from "../../../src/domain/cota-da-ia.ts";
import { FALA_DEPOIS_DO_FIM } from "../../../src/domain/fala-na-frente.ts";
import { molduraFalaNaFrente } from "../../../src/domain/mensagem-no-meio.ts";
import { entradaDaVoltaDoFundo } from "../../../src/use-cases/volta-do-fundo.ts";

/** NOD-376: o turno da fala da pessoa na frente cortado (cota, erro transitório, máquina) volta com a fala, rotulada como fala. */
const turno = (entradaTexto: string, extra: Partial<Turno> = {}): Turno => ({ id: "t", origem: "conversa", entradaTexto, decididoPor: "regra:teste", ...extra }) as Turno;
const raiz = turno("Implemente a NOD-370");
// O turno da fala nasce como retomada do último turno da frente: a raiz da cadeia é o pedido da frente.
const acabou = turno(molduraFalaNaFrente("E o deploy?", { frenteAcabou: true }), { origem: "retomada", retomaTurnoId: "r", decididoPor: FALA_DEPOIS_DO_FIM });
const segue = turno(molduraFalaNaFrente("E o deploy?", { frenteAcabou: false }), { origem: "retomada", retomaTurnoId: "r" });
const base = `${ENTRADA_DA_VOLTA_DA_COTA} volte`;

describe("entradaDaVoltaDoFundo com a fala na frente", () => {
  // `falas` = as falas ainda sem resposta (falasSemResposta): a volta as leva num bloco, por último, com rótulo de fala.
  for (const sessaoRetomavel of [true, false]) {
    it(`frente terminada: leva só a fala, rotulada como fala (sessão retomável: ${sessaoRetomavel})`, () => {
      const e = entradaDaVoltaDoFundo({ turno: acabou, raiz, base, sessaoRetomavel, falas: [acabou.entradaTexto] });
      expect(e).toBe(`${base}${MARCA_DA_FALA_NA_FRENTE}${acabou.entradaTexto}`);
      expect(e).not.toContain("Implemente a NOD-370");
      expect(e).not.toContain(MARCA_DO_PEDIDO_ORIGINAL);
    });
  }

  it("frente que segue: a sessão nova ganha o pedido da frente e a fala; a retomável, só a fala", () => {
    expect(entradaDaVoltaDoFundo({ turno: segue, raiz, base, sessaoRetomavel: false, falas: [segue.entradaTexto] })).toBe(`${base}${MARCA_DO_PEDIDO_ORIGINAL}Implemente a NOD-370${MARCA_DA_FALA_NA_FRENTE}${segue.entradaTexto}`);
    expect(entradaDaVoltaDoFundo({ turno: segue, raiz, base, sessaoRetomavel: true, falas: [segue.entradaTexto] })).toBe(`${base}${MARCA_DA_FALA_NA_FRENTE}${segue.entradaTexto}`);
  });

  it("revisão 8: a fala já respondida (sem `falas`) não volta; a frente que segue continua com o pedido na sessão nova", () => {
    expect(entradaDaVoltaDoFundo({ turno: segue, raiz, base, sessaoRetomavel: true, falas: [] })).toBe(base);
    expect(entradaDaVoltaDoFundo({ turno: segue, raiz, base, sessaoRetomavel: false })).toBe(`${base}${MARCA_DO_PEDIDO_ORIGINAL}Implemente a NOD-370`);
  });

  it("a volta da volta (cortada de novo): o bloco antigo sai, as falas vêm de `falas`; o pedido só com a sessão nova", () => {
    const volta = turno(`${base}${MARCA_DO_PEDIDO_ORIGINAL}Implemente a NOD-370${MARCA_DA_FALA_NA_FRENTE}${segue.entradaTexto}`, { origem: "retomada" });
    expect(entradaDaVoltaDoFundo({ turno: volta, raiz, base, sessaoRetomavel: true, falas: [segue.entradaTexto] })).toBe(`${base}${MARCA_DA_FALA_NA_FRENTE}${segue.entradaTexto}`);
    expect(entradaDaVoltaDoFundo({ turno: volta, raiz, base, sessaoRetomavel: false, falas: [segue.entradaTexto] })).toBe(volta.entradaTexto);
    expect(entradaDaVoltaDoFundo({ turno: volta, raiz, base, sessaoRetomavel: false })).toBe(`${base}${MARCA_DO_PEDIDO_ORIGINAL}Implemente a NOD-370`);
  });

  it("revisão 9: o comando cru da conversa depois do fim, cortado sem sessão, não leva o pedido da frente", () => {
    const cmd = turno("/review 420", { origem: "retomada", retomaTurnoId: "r", decididoPor: FALA_DEPOIS_DO_FIM });
    expect(entradaDaVoltaDoFundo({ turno: cmd, raiz, base, sessaoRetomavel: false })).toBe(base);
  });

  it("revisão 7: várias falas vão no mesmo bloco, na ordem", () => {
    const f2 = molduraFalaNaFrente("E a CI?");
    expect(entradaDaVoltaDoFundo({ turno: raiz, raiz, base, sessaoRetomavel: true, falas: [segue.entradaTexto, f2] })).toBe(`${base}${MARCA_DA_FALA_NA_FRENTE}${segue.entradaTexto}\n\n${f2}`);
  });

  it("a task levada (NOD-310) guarda a fala mesmo sem pedido", () => {
    expect(entradaLevadaComPedido(`${base}${MARCA_DA_FALA_NA_FRENTE}x`, "nova")).toBe(`nova${MARCA_DA_FALA_NA_FRENTE}x`);
    expect(entradaLevadaComPedido(`${base}${MARCA_DO_PEDIDO_ORIGINAL}p${MARCA_DA_FALA_NA_FRENTE}x`, "nova")).toBe(`nova${MARCA_DO_PEDIDO_ORIGINAL}p${MARCA_DA_FALA_NA_FRENTE}x`);
  });

  it("o pedido comum com a sessão retomável segue só com a base (como antes)", () => {
    expect(entradaDaVoltaDoFundo({ turno: raiz, raiz, base, sessaoRetomavel: true })).toBe(base);
    const volta = turno(`${base}${MARCA_DO_PEDIDO_ORIGINAL}Implemente a NOD-370`, { origem: "retomada" });
    expect(entradaDaVoltaDoFundo({ turno: volta, raiz, base, sessaoRetomavel: true })).toBe(base);
  });
});
