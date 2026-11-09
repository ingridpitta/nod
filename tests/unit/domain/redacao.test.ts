import { describe, expect, it } from "vitest";
import { MOTIVOS_FALHA, MOTIVOS_INTERRUPCAO } from "../../../src/contracts/motivos.ts";
import { motivoEmPortugues, redigir } from "../../../src/domain/redacao.ts";

describe("redacao", () => {
  it("rotina sem resposta NÃO envia — caso adversarial", () => {
    const t = redigir("rotina-sem-resposta", 0);
    expect(t).toMatch(/nada foi enviado/i);
    expect(t).not.toMatch(/tent(e|ar) de novo/i);
  });

  it("chaves novas com parâmetros; placeholder sem valor fica visível (nunca some em silêncio)", () => {
    expect(redigir("handoff", 0, { de: "Vera", para: "Tuca", motivo: "ele conhece o PR" })).toBe("Vera passou para Tuca: ele conhece o PR.");
    expect(redigir("sem-acessos-nunca-executou", 0)).toBe("sem acessos · nunca executou");
    expect(redigir("turno-interrompido", 0)).toContain("{motivo}");
    expect(redigir("parada-nada-rodando", 0)).toMatch(/nada estava rodando/i);
    expect(redigir("memoria-nao-e-fonte", 0)).toMatch(/não substitui fonte autoritativa/i);
  });

  it("ADR-045: a queda é do Mac da pessoa, com as três causas — nunca 'o computador' (lido como o computador do bot)", () => {
    const t = motivoEmPortugues("maquina_sem_contato");
    expect(t).toBe("seu Mac parou de responder (repouso, sem rede ou nod fechado)");
    expect(t).not.toMatch(/computador/i);
    expect(redigir("turno-interrompido", 0, { motivo: t })).toContain("Turno interrompido: seu Mac parou de responder");
    expect(motivoEmPortugues("reinicio_servidor")).toBe("o servidor reiniciou");
  });

  it("pedido vencido em palavras (definido em 2026-09-24): o desfecho vem traduzido, nunca o enum", () => {
    const t = redigir("decisao-vencida", 0, { quando: "24/09/2026, 15:00 UTC", desfecho: "alguém viu, mas ninguém respondeu" });
    expect(t).toBe("Este pedido venceu em 24/09/2026, 15:00 UTC sem resposta — alguém viu, mas ninguém respondeu. Você pode reabrir.");
    expect(t).not.toMatch(/expirou|_/);
  });

  it("NOD-174: todo motivo de falha e de interrupção tem frase em pt-BR, nunca o código cru", () => {
    for (const m of [...MOTIVOS_FALHA, ...MOTIVOS_INTERRUPCAO]) {
      const t = motivoEmPortugues(m);
      expect(t, m).not.toBe(m);
      expect(t, m).not.toMatch(/_/);
    }
    expect(motivoEmPortugues("erro_execucao")).toBe("a IA parou por um erro; tente de novo e, se repetir, relate o problema nesta mensagem");
  });

  it("motivo legado fora do enum sai como está, sem quebrar; chave de Object.prototype não vira frase", () => {
    expect(motivoEmPortugues("motivo_de_2025")).toBe("motivo_de_2025");
    expect(motivoEmPortugues("toString")).toBe("toString");
  });
});
