import { describe, expect, it } from "vitest";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { escNoEspaco, focoAoAbrirEspaco, voltarParaLista } from "../../../web/lib/navegacao-config.ts";

/** NOD-383 (critério 3): o ‹, o Esc e o foco das Configurações no celular, sem DOM. */
const abre = (secao: "conta" | "geral" | "feedback", lista = false): Estado => reduzir(estadoInicial, { tipo: "espaco", secao, ...(lista ? { lista } : {}) });

describe("NOD-383: navegação das Configurações no celular", () => {
  it("o foco: no celular a seção foca o ‹; a lista e o desktop seguem como eram; Ajuda vai ao bloco", () => {
    const base = { pedido: "conta" as const, secao: "conta" as const, jaAberto: true };
    expect(focoAoAbrirEspaco({ ...base, celular: true, lista: false })).toBe("#espaco [data-act=cfg-lista]");
    expect(focoAoAbrirEspaco({ ...base, celular: true, lista: true })).toBe('#espaco [data-secao="conta"]');
    expect(focoAoAbrirEspaco({ ...base, celular: false, lista: false })).toBe('#espaco [data-secao="conta"]');
    expect(focoAoAbrirEspaco({ ...base, celular: false, lista: false, jaAberto: false })).toBe("#espaco .espaco-voltar");
    expect(focoAoAbrirEspaco({ ...base, pedido: "ajuda", secao: "geral" as never, celular: true, lista: false })).toBe("#espaco #ajuda");
  });

  it("o Esc: numa seção do celular volta para a lista; na lista e no desktop fecha", () => {
    expect(escNoEspaco(true, abre("geral"))).toBe("lista");
    expect(escNoEspaco(true, abre("geral", true))).toBe("fechar");
    expect(escNoEspaco(false, abre("geral"))).toBe("fechar");
  });

  it("o ‹: volta para a lista da seção aberta, fecha a Minha conta só na Conta e foca o item", () => {
    expect(voltarParaLista(abre("conta"), true)).toEqual({ secao: "conta", fecharMinhaConta: true, foco: '#espaco [data-secao="conta"]' });
    expect(voltarParaLista(abre("conta"), false)!.fecharMinhaConta).toBe(false);
    expect(voltarParaLista(abre("geral"), true)!.fecharMinhaConta).toBe(false);
    expect(voltarParaLista(abre("geral", true), true)).toBeNull();
    expect(voltarParaLista(estadoInicial, true)).toBeNull();
  });

  it("Feedback → ‹ → lista → Feedback relê os envios (revisão 2, L1)", () => {
    const comEnvios = { ...abre("feedback"), relatos: [] as never, relatosErro: true };
    const naLista = reduzir(comEnvios, { tipo: "espaco", secao: "feedback", lista: true });
    expect(naLista.relatos).toEqual([]);
    const deNovo = reduzir(naLista, { tipo: "espaco", secao: "feedback" });
    expect(deNovo.relatos).toBeNull();
    expect(deNovo.relatosErro).toBe(false);
  });
});
