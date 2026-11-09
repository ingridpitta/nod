import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRAZO_CLIQUE_NA_CONFIRMACAO_MS, reagirMenuModo } from "../../../web/telas/aprovacoes.ts";

// Regressão: achados do /qa do PR #401 (2026-10-18), no botão e no menu do modo de aprovação.

describe("o duplo clique no terceiro item deixa o aviso aberto", () => {
  // No celular os botões da confirmação ficam empilhados: o segundo clique caía no "Agora não" e o aviso abria e fechava
  // sem a pessoa ler.
  it("o clique apressado no Agora não não fecha a confirmação", () => {
    expect(reagirMenuModo("automatico", true, { tipo: "agora-nao", cliques: 2, msDesdeAConfirmacao: 180 })).toEqual({ tipo: "ignorar" });
    expect(reagirMenuModo("automatico", true, { tipo: "agora-nao", cliques: 1, msDesdeAConfirmacao: PRAZO_CLIQUE_NA_CONFIRMACAO_MS - 1 })).toEqual({ tipo: "ignorar" });
  });

  it("o Agora não de quem leu, e o do teclado, fecham só a confirmação", () => {
    expect(reagirMenuModo("automatico", true, { tipo: "agora-nao", cliques: 1, msDesdeAConfirmacao: PRAZO_CLIQUE_NA_CONFIRMACAO_MS })).toEqual({ tipo: "fechar-confirmacao" });
    expect(reagirMenuModo("manual", true, { tipo: "agora-nao", cliques: 0, msDesdeAConfirmacao: 2_000 })).toEqual({ tipo: "fechar-confirmacao" });
    expect(reagirMenuModo("manual", true, { tipo: "agora-nao" })).toEqual({ tipo: "fechar-confirmacao" });
  });
});

describe("o botão do modo no celular", () => {
  // Com 44 px de largura ele comia o "Mensagem" do campo a 390 px ("Mensage"). Ocupa 36 px e o toque de 44 vem do ::after.
  const mobile = readFileSync(new URL("../../../web/mobile.css", import.meta.url), "utf8");
  it("ocupa 36 px no campo e estica o toque 4 px para cada lado", () => {
    expect(mobile).toMatch(/\.composer \.modo-chip \{ width: 36px; height: 44px; \}/);
    expect(mobile).toMatch(/\.composer \.modo-chip::after \{ content: ""; position: absolute; inset: 0 -4px; \}/);
  });
});
