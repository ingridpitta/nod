import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { listaVaziaDaBarra } from "../../../web/lib/lista-vazia-da-barra.ts";

describe("NOD-119 (C5, revisão 8): a barra sem bots próprios", () => {
  const S = "<silhuetas/>";
  it("frota que falhou: o aviso com Tentar de novo, mesmo com bots da equipe", () => {
    const html = listaVaziaDaBarra({ falhou: true, temFrota: false, botsDaEquipe: 2 }, S);
    expect(html).toContain('class="mudo falha-frota"');
    expect(html).toContain('data-act="tentar-frota"');
  });
  it("frota carregando: as silhuetas", () => {
    expect(listaVaziaDaBarra({ falhou: false, temFrota: false, botsDaEquipe: 0 }, S)).toBe(S);
  });
  it("só bots da equipe: nada de \"Nenhum agente visível\"", () => {
    expect(listaVaziaDaBarra({ falhou: false, temFrota: true, botsDaEquipe: 3 }, S)).toBe("");
  });
  it("sem bot nenhum: Nenhum agente visível", () => {
    expect(listaVaziaDaBarra({ falhou: false, temFrota: true, botsDaEquipe: 0 }, S)).toContain("Nenhum agente visível");
  });
  it("na recolhida, a regra que esconde os .mudo poupa a falha da frota", () => {
    const css = readFileSync(new URL("../../../web/densidade.css", import.meta.url), "utf8");
    expect(css).not.toMatch(/\.list > \.mudo \{|\.list > \.mudo,/);
    expect(css).toContain(".list > .mudo:not(.falha-frota) { display: none; }");
    expect(css).toContain(".list > .falha-frota button::before");
  });
});

describe("NOD-119 (revisão 8): todo canal da barra no processo principal valida o remetente", () => {
  it("cada ipcMain de CANAIS_DESKTOP.*Barra* chama validarRemetenteWeb", () => {
    const main = readFileSync(new URL("../../../desktop/main.ts", import.meta.url), "utf8");
    const blocos = main.split(/(?=ipcMain\.(?:on|handle)\()/).filter((b) => /^ipcMain\.(?:on|handle)\(CANAIS_DESKTOP\.\w*barra\w*/i.test(b));
    expect(blocos.length).toBe(4);
    for (const b of blocos) expect(b.split("});")[0], b.slice(0, 60)).toContain("validarRemetenteWeb(e)");
  });
});
